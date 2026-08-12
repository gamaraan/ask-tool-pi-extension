/**
 * Tool-level tests: registration, dispatch paths, flag/env config, and the
 * served description contract (plan §9.2: ≥7 cases + T2 description pins).
 */

import { rmSync } from "node:fs";
// pi-lens-ignore: typescript:2307
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
// pi-lens-ignore: typescript:2307
import { beforeEach, describe, expect, it, vi } from "vitest";
// pi-lens-ignore: typescript:2307
import {
	readAskConfig,
	supportsTerminalNotifications,
	writeAskConfig,
} from "../../src/config.ts";
// pi-lens-ignore: typescript:2307
import { OTHER_OPTION } from "../../src/constants.ts";
// pi-lens-ignore: typescript:2307
import { ASK_TOOL_DESCRIPTION } from "../../src/description.ts";
// pi-lens-ignore: typescript:2307
import askToolExtension from "../../src/index.ts";
import {
	fakeTheme,
	fakeTui,
	focusTrackingTui,
	setupHarness,
	singleQuestionParams,
} from "./test-helpers.ts";

describe("ask tool extension", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		vi.stubEnv("PI_CODING_AGENT_DIR", "/tmp/ask-tool-tests-agent");
		rmSync("/tmp/ask-tool-tests-agent/ask-tool.json", { force: true });
	});

	it("registers the tool and ask-configure command", () => {
		const { tool, api, flags, commands } = setupHarness({
			register: (pi) => askToolExtension(pi),
		});
		expect(api.registerTool).toHaveBeenCalledOnce();
		expect(tool.executionMode).toBe("sequential");
		expect(tool.name).toBe("ask");
		expect(flags.has("ask-timeout")).toBe(true);
		expect(flags.has("ask-notify")).toBe(true);
		expect(commands.has("ask-configure")).toBe(true);
	});

	it("persists and reloads static ask configuration", () => {
		const path = "/tmp/ask-tool-test-config.json";
		writeAskConfig({ notify: true, timeoutSeconds: 12 }, path);
		expect(readAskConfig(path)).toEqual({ notify: true, timeoutSeconds: 12 });
	});

	it("serves a description with the reserved labels verbatim and no omp-only features", () => {
		expect(ASK_TOOL_DESCRIPTION).toContain("Other (type your own)");
		expect(ASK_TOOL_DESCRIPTION).toContain("(Recommended)");
		expect(ASK_TOOL_DESCRIPTION).toContain("multi");
		expect(ASK_TOOL_DESCRIPTION).not.toMatch(/vocaliz|speech|notification/i);
	});

	it("configures values interactively, saves them, and reloads", async () => {
		const { commands, ctx } = setupHarness({
			mode: "tui",
			hasUI: true,
			ui: {
				confirm: vi.fn(async () => true),
				input: vi.fn(async () => "30"),
			},
			register: (pi) => askToolExtension(pi),
		});
		const handler = commands.get("ask-configure")?.handler;
		expect(handler).toBeDefined();
		if (!handler) return;
		await handler("", ctx);
		expect(readAskConfig("/tmp/ask-tool-tests-agent/ask-tool.json")).toEqual({
			notify: true,
			timeoutSeconds: 30,
		});
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			"Ask configuration saved. Reloading…",
			"info",
		);
		expect(ctx.reload).toHaveBeenCalledOnce();
	});

	it("Path C: returns an error result in headless mode without throwing", async () => {
		const { tool, ctx } = setupHarness({
			mode: "print",
			hasUI: false,
			register: (pi) => askToolExtension(pi),
		});
		const result = await tool.execute(
			"id",
			singleQuestionParams(),
			undefined,
			undefined,
			ctx,
		);
		const text =
			(result as { content: Array<{ text?: string }> }).content[0]?.text ?? "";
		expect(text).toContain("Ask tool requires interactive mode");
	});

	it("Path B: single select resolves to the expected response text", async () => {
		const { tool, ctx } = setupHarness({
			mode: "rpc",
			hasUI: true,
			register: (pi) => askToolExtension(pi),
			ui: { select: vi.fn(async () => "PostgreSQL") },
		});
		const result = (await tool.execute(
			"id",
			singleQuestionParams(),
			undefined,
			undefined,
			ctx,
		)) as {
			content: Array<{ text?: string }>;
			details: { question?: string; selectedOptions?: string[] };
		};
		expect(result.content[0]?.text).toBe("User selected: PostgreSQL");
		expect(result.details.selectedOptions).toEqual(["PostgreSQL"]);
	});

	it("Path B: Esc cancels, aborts the turn, and returns a cancelled result", async () => {
		const { tool, ctx } = setupHarness({
			mode: "rpc",
			hasUI: true,
			register: (pi) => askToolExtension(pi),
			ui: { select: vi.fn(async () => undefined) },
		});
		const result = (await tool.execute(
			"id",
			singleQuestionParams(),
			undefined,
			undefined,
			ctx,
		)) as {
			content: Array<{ text?: string }>;
		};
		expect(ctx.abort).toHaveBeenCalled();
		expect(result.content[0]?.text).toBe("User cancelled the selection");
	});

	it("recognizes terminals with focus-aware native notification protocols", () => {
		expect(supportsTerminalNotifications({ TERM_PROGRAM: "kitty" })).toBe(true);
		expect(
			supportsTerminalNotifications({
				TERM_PROGRAM: "xterm",
				TERM: "xterm-256color",
			}),
		).toBe(false);
	});

	it("Path A: widget dialog drives the callbacks and returns the mapped result", async () => {
		vi.stubEnv("TERM_PROGRAM", "kitty");
		let widgetCleared = false;
		const { tool, ctx, events } = setupHarness({
			mode: "tui",
			hasUI: true,
			flags: { "ask-notify": "on" },
			register: (pi) => askToolExtension(pi),
			ui: {
				setWidget: (async (_key: unknown, content: unknown) => {
					if (content === undefined) {
						widgetCleared = true;
						return;
					}
					const f = content as (tui: unknown, theme: unknown) => unknown;
					const tracking = focusTrackingTui();
					const editor = { name: "editor" };
					tracking.state.focused = editor;
					const component = (await f(tracking.tui, fakeTheme())) as {
						handleInput(data: string): void;
						dispose?(): void;
					};
					// The factory must have grabbed focus for the dialog.
					expect(tracking.state.focused).toBe(component);
					component.handleInput("\r"); // select the recommended option
					// After completion the widget is cleared and focus restored.
					expect(widgetCleared).toBe(true);
					expect(tracking.state.focused).toBe(editor);
					return undefined;
				}) as never,
			},
		});
		const result = (await tool.execute(
			"id",
			singleQuestionParams(),
			undefined,
			undefined,
			ctx,
		)) as {
			content: Array<{ text?: string }>;
			details: { selectedOptions?: string[] };
		};
		expect(result.content[0]?.text).toBe("User selected: SQLite");
		expect(result.details.selectedOptions).toEqual(["SQLite"]);
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			"Ask tool is waiting for input",
			"info",
		);
		expect(events.emit).toHaveBeenCalledOnce();
		expect(events.emit).toHaveBeenCalledWith("desktop-notify:request", {
			title: "Which storage backend?",
			body: "Waiting for input",
			type: "ask",
			urgency: "normal",
			sound: "question",
		});
	});

	it("flag wins over env for the timeout", async () => {
		vi.stubEnv("PI_ASK_TIMEOUT_SECONDS", "9");
		const { tool, ctx } = setupHarness({
			mode: "rpc",
			hasUI: true,
			flags: { "ask-timeout": "3" },
			register: (pi) => askToolExtension(pi),
			ui: { select: vi.fn(async () => "SQLite") },
		});
		const select = vi.mocked(ctx.ui.select);
		await tool.execute("id", singleQuestionParams(), undefined, undefined, ctx);
		const opts = select.mock.calls[0]?.[2] as { timeout?: number } | undefined;
		expect(opts?.timeout).toBe(3000);
	});

	it("env supplies the timeout when no flag is set", async () => {
		vi.stubEnv("PI_ASK_TIMEOUT_SECONDS", "5");
		const { tool, ctx } = setupHarness({
			mode: "rpc",
			hasUI: true,
			register: (pi) => askToolExtension(pi),
			ui: { select: vi.fn(async () => "SQLite") },
		});
		const select = vi.mocked(ctx.ui.select);
		await tool.execute("id", singleQuestionParams(), undefined, undefined, ctx);
		const opts = select.mock.calls[0]?.[2] as { timeout?: number } | undefined;
		expect(opts?.timeout).toBe(5000);
	});

	it("defaults to timeout disabled (no timeout passed to select)", async () => {
		const { tool, ctx } = setupHarness({
			mode: "rpc",
			hasUI: true,
			register: (pi) => askToolExtension(pi),
			ui: { select: vi.fn(async () => "SQLite") },
		});
		const select = vi.mocked(ctx.ui.select);
		await tool.execute("id", singleQuestionParams(), undefined, undefined, ctx);
		const opts = select.mock.calls[0]?.[2] as { timeout?: number } | undefined;
		expect(opts?.timeout).toBeUndefined();
	});

	it("Path B: Other routes through ctx.ui.editor and returns custom input", async () => {
		const { tool, ctx } = setupHarness({
			mode: "rpc",
			hasUI: true,
			register: (pi) => askToolExtension(pi),
			ui: {
				select: vi.fn(async () => OTHER_OPTION),
				editor: vi.fn(async () => "Custom storage"),
			},
		});
		const result = (await tool.execute(
			"id",
			singleQuestionParams(),
			undefined,
			undefined,
			ctx,
		)) as {
			content: Array<{ text?: string }>;
			details: { customInput?: string };
		};
		expect(ctx.ui.editor).toHaveBeenCalled();
		expect(result.content[0]?.text).toBe(
			"User provided custom input: Custom storage",
		);
		expect(result.details.customInput).toBe("Custom storage");
	});

	it("Path B: timeout auto-selects the recommended option and marks timedOut", async () => {
		const { tool, ctx } = setupHarness({
			mode: "rpc",
			hasUI: true,
			flags: { "ask-timeout": "1" },
			register: (pi) => askToolExtension(pi),
			ui: {
				select: vi.fn<ExtensionContext["ui"]["select"]>(
					() => new Promise(() => {}),
				),
			},
		});
		const result = (await tool.execute(
			"id",
			singleQuestionParams(),
			undefined,
			undefined,
			ctx,
		)) as {
			content: Array<{ text?: string }>;
			details: { selectedOptions?: string[]; timedOut?: boolean };
		};
		expect(result.details.selectedOptions).toEqual(["SQLite"]);
		expect(result.details.timedOut).toBe(true);
		expect(result.content[0]?.text).toContain("auto-selected after timeout");
	});

	it("sends a best-effort notification only when ask-notify is on", async () => {
		const first = setupHarness({
			mode: "rpc",
			hasUI: true,
			flags: { "ask-notify": "on" },
			register: (pi) => askToolExtension(pi),
			ui: { select: vi.fn(async () => "SQLite") },
		});
		await first.tool.execute(
			"id",
			singleQuestionParams(),
			undefined,
			undefined,
			first.ctx,
		);
		expect(first.ctx.ui.notify).toHaveBeenCalledWith(
			"Ask tool is waiting for input",
			"info",
		);
		expect(first.events.emit).not.toHaveBeenCalled();

		const second = setupHarness({
			mode: "rpc",
			hasUI: true,
			register: (pi) => askToolExtension(pi),
			ui: { select: vi.fn(async () => "SQLite") },
		});
		await second.tool.execute(
			"id",
			singleQuestionParams(),
			undefined,
			undefined,
			second.ctx,
		);
		expect(second.ctx.ui.notify).not.toHaveBeenCalled();
		expect(second.events.emit).not.toHaveBeenCalled();
	});

	it("does not request desktop notifications for unsupported TUI terminals", async () => {
		vi.stubEnv("TERM_PROGRAM", "xterm");
		vi.stubEnv("TERM", "xterm-256color");
		for (const variable of [
			"KITTY_WINDOW_ID",
			"GHOSTTY_RESOURCES_DIR",
			"WEZTERM_PANE",
			"ITERM_SESSION_ID",
			"LC_TERMINAL",
		]) {
			vi.stubEnv(variable, "");
		}
		expect(supportsTerminalNotifications()).toBe(false);
		const tui = setupHarness({
			mode: "tui",
			hasUI: true,
			flags: { "ask-notify": "on" },
			register: (pi) => askToolExtension(pi),
			ui: {
				setWidget: (async (_key: unknown, content: unknown) => {
					if (content === undefined) return;
					const factory = content as (tui: unknown, theme: unknown) => unknown;
					const component = (await factory(fakeTui(), fakeTheme())) as {
						handleInput(data: string): void;
					};
					component.handleInput("\r");
				}) as never,
			},
		});
		await tui.tool.execute(
			"id",
			singleQuestionParams(),
			undefined,
			undefined,
			tui.ctx,
		);
		expect(tui.ctx.ui.notify).toHaveBeenCalledWith(
			"Ask tool is waiting for input",
			"info",
		);
		expect(tui.events.emit).not.toHaveBeenCalled();

		const headless = setupHarness({
			mode: "print",
			hasUI: false,
			flags: { "ask-notify": "on" },
			register: (pi) => askToolExtension(pi),
		});
		await headless.tool.execute(
			"id",
			singleQuestionParams(),
			undefined,
			undefined,
			headless.ctx,
		);
		expect(headless.ctx.ui.notify).not.toHaveBeenCalled();
		expect(headless.events.emit).not.toHaveBeenCalled();
	});

	it("prepareArguments rejects reserved labels and invalid payloads", async () => {
		const { tool } = setupHarness({ register: (pi) => askToolExtension(pi) });
		expect(() => tool.prepareArguments?.({ questions: [] })).toThrow();
		expect(() =>
			tool.prepareArguments?.({
				questions: [
					{ id: "q", question: "Q?", options: [{ label: OTHER_OPTION }] },
				],
			}),
		).toThrow(/reserved/);
		const parsed = tool.prepareArguments?.(singleQuestionParams());
		expect(parsed?.questions[0]?.id).toBe("storage");
	});

	it("waits for the timeout before auto-selecting (integration guard)", async () => {
		const started = Date.now();
		const { tool, ctx } = setupHarness({
			mode: "rpc",
			hasUI: true,
			flags: { "ask-timeout": "1" },
			register: (pi) => askToolExtension(pi),
			ui: {
				select: vi.fn<ExtensionContext["ui"]["select"]>(
					() => new Promise(() => {}),
				),
			},
		});
		await tool.execute("id", singleQuestionParams(), undefined, undefined, ctx);
		expect(Date.now() - started).toBeGreaterThanOrEqual(900);
	});
});
