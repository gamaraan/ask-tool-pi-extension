/**
 * Tool-level tests: registration, dispatch paths, flag/env config, and the
 * served description contract (plan §9.2: ≥7 cases + T2 description pins).
 */

// pi-lens-ignore: typescript:2307
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OTHER_OPTION } from "../../../../../ask-tool/src/constants.ts";
import { ASK_TOOL_DESCRIPTION } from "../../../../../ask-tool/src/description.ts";
import askToolExtension from "../../../../../ask-tool/src/index.ts";
import { fakeTheme, focusTrackingTui, setupHarness, singleQuestionParams } from "./test-helpers.ts";

describe("ask tool extension", () => {
	beforeEach(() => {
		vi.unstubAllEnvs();
	});

	it("registers the tool with executionMode sequential", () => {
		const { tool, api, flags } = setupHarness({ register: (pi) => askToolExtension(pi) });
		expect(api.registerTool).toHaveBeenCalledOnce();
		expect(tool.executionMode).toBe("sequential");
		expect(tool.name).toBe("ask");
		expect(flags.has("ask-timeout")).toBe(true);
		expect(flags.has("ask-notify")).toBe(true);
	});

	it("serves a description with the reserved labels verbatim and no omp-only features", () => {
		expect(ASK_TOOL_DESCRIPTION).toContain("Other (type your own)");
		expect(ASK_TOOL_DESCRIPTION).toContain("(Recommended)");
		expect(ASK_TOOL_DESCRIPTION).toContain("multi");
		expect(ASK_TOOL_DESCRIPTION).not.toMatch(/vocaliz|speech|notification/i);
	});

	it("Path C: returns an error result in headless mode without throwing", async () => {
		const { tool, ctx } = setupHarness({ mode: "print", hasUI: false, register: (pi) => askToolExtension(pi) });
		const result = await tool.execute("id", singleQuestionParams(), undefined, undefined, ctx);
		const text = (result as { content: Array<{ text?: string }> }).content[0]?.text ?? "";
		expect(text).toContain("Ask tool requires interactive mode");
	});

	it("Path B: single select resolves to the expected response text", async () => {
		const { tool, ctx } = setupHarness({
			mode: "rpc",
			hasUI: true,
			register: (pi) => askToolExtension(pi),
			ui: { select: vi.fn(async () => "PostgreSQL") },
		});
		const result = (await tool.execute("id", singleQuestionParams(), undefined, undefined, ctx)) as {
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
		const result = (await tool.execute("id", singleQuestionParams(), undefined, undefined, ctx)) as {
			content: Array<{ text?: string }>;
		};
		expect(ctx.abort).toHaveBeenCalled();
		expect(result.content[0]?.text).toBe("User cancelled the selection");
	});

	it("Path A: widget dialog drives the callbacks and returns the mapped result", async () => {
		let widgetCleared = false;
		const { tool, ctx } = setupHarness({
			mode: "tui",
			hasUI: true,
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
		const result = (await tool.execute("id", singleQuestionParams(), undefined, undefined, ctx)) as {
			content: Array<{ text?: string }>;
			details: { selectedOptions?: string[] };
		};
		expect(result.content[0]?.text).toBe("User selected: SQLite");
		expect(result.details.selectedOptions).toEqual(["SQLite"]);
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
		const result = (await tool.execute("id", singleQuestionParams(), undefined, undefined, ctx)) as {
			content: Array<{ text?: string }>;
			details: { customInput?: string };
		};
		expect(ctx.ui.editor).toHaveBeenCalled();
		expect(result.content[0]?.text).toBe("User provided custom input: Custom storage");
		expect(result.details.customInput).toBe("Custom storage");
	});

	it("Path B: timeout auto-selects the recommended option and marks timedOut", async () => {
		const { tool, ctx } = setupHarness({
			mode: "rpc",
			hasUI: true,
			flags: { "ask-timeout": "1" },
			register: (pi) => askToolExtension(pi),
			ui: {
				select: vi.fn<ExtensionContext["ui"]["select"]>(() => new Promise(() => {})),
			},
		});
		const result = (await tool.execute("id", singleQuestionParams(), undefined, undefined, ctx)) as {
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
		await first.tool.execute("id", singleQuestionParams(), undefined, undefined, first.ctx);
		expect(first.ctx.ui.notify).toHaveBeenCalledWith("Ask tool is waiting for input", "info");

		const second = setupHarness({
			mode: "rpc",
			hasUI: true,
			register: (pi) => askToolExtension(pi),
			ui: { select: vi.fn(async () => "SQLite") },
		});
		await second.tool.execute("id", singleQuestionParams(), undefined, undefined, second.ctx);
		expect(second.ctx.ui.notify).not.toHaveBeenCalled();
	});

	it("prepareArguments rejects reserved labels and invalid payloads", async () => {
		const { tool } = setupHarness({ register: (pi) => askToolExtension(pi) });
		expect(() => tool.prepareArguments?.({ questions: [] })).toThrow();
		expect(() =>
			tool.prepareArguments?.({
				questions: [{ id: "q", question: "Q?", options: [{ label: OTHER_OPTION }] }],
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
			ui: { select: vi.fn<ExtensionContext["ui"]["select"]>(() => new Promise(() => {})) },
		});
		await tool.execute("id", singleQuestionParams(), undefined, undefined, ctx);
		expect(Date.now() - started).toBeGreaterThanOrEqual(900);
	});
});
