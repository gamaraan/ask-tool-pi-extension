/**
 * Shared fakes for the ask-tool test suite: ANSI-free theme, fake TUI, and
 * typed test fixtures. Mirrors the mock style of `test/plan-mode-extension.test.ts`
 * while keeping snapshots stable (theme passthrough, no escape codes).
 */
// pi-lens-ignore: typescript:2307
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { vi } from "vitest";
import type { AskToolInput } from "../../../../../ask-tool/src/types.ts";

/** Theme whose style functions pass text through unchanged (ANSI-free snapshots). */
export function fakeTheme(): Theme {
	return {
		fg: (_color: string, text: string) => text,
		bold: (text: string) => text,
		italic: (text: string) => text,
		underline: (text: string) => text,
		strikethrough: (text: string) => text,
	} as unknown as Theme;
}

/** Fake TUI with just what the dialog and Editor touch. */
export function fakeTui(): TUI {
	return {
		requestRender: vi.fn(),
		terminal: { rows: 40, columns: 80 },
		getFocusedComponent: () => null,
		setFocus: vi.fn(),
	} as unknown as TUI;
}

/** Fake TUI that tracks focus (for the widget-presentation Path A tests). */
export function focusTrackingTui(): {
	tui: TUI;
	state: { focused: unknown };
	setFocus: ReturnType<typeof vi.fn>;
} {
	const state: { focused: unknown } = { focused: null };
	const setFocus = vi.fn((component: unknown) => {
		state.focused = component;
	});
	return {
		tui: {
			requestRender: vi.fn(),
			terminal: { rows: 40, columns: 80 },
			getFocusedComponent: () => state.focused,
			setFocus,
		} as unknown as TUI,
		state,
		setFocus,
	};
}

/** Standard key sequences pi-tui expects (matchesKey/Keybindings). */
export const keys = {
	up: "\x1b[A",
	down: "\x1b[B",
	left: "\x1b[D",
	right: "\x1b[C",
	pageUp: "\x1b[5~",
	pageDown: "\x1b[6~",
	enter: "\r",
	escape: "\x1b",
	tab: "\t",
	shiftTab: "\x1b[Z",
	space: " ",
} as const;

export interface ToolHarness {
	api: ExtensionAPI;
	ctx: ExtensionContext;
	tool: {
		execute(
			toolCallId: string,
			params: AskToolInput,
			signal: AbortSignal | undefined,
			onUpdate: undefined,
			ctx: ExtensionContext,
		): Promise<unknown>;
		renderCall?(args: unknown, theme: Theme): { render(width: number): string[] };
		renderResult?(
			result: { content: Array<{ type: string; text?: string }>; details?: unknown },
			options: unknown,
			theme: Theme,
		): { render(width: number): string[] };
		executionMode?: string;
		prepareArguments?(args: unknown): AskToolInput;
		description?: string;
		name?: string;
		label?: string;
	};
	flags: Map<string, { type: string; default?: boolean | string }>;
	getFlag(name: string): boolean | string | undefined;
}

/** Build a mock ExtensionAPI + ExtensionContext around a registered tool. */
export function setupHarness(
	options: {
		mode?: "tui" | "rpc" | "print" | "json";
		hasUI?: boolean;
		flags?: Record<string, boolean | string | undefined>;
		ui?: Partial<ExtensionContext["ui"]>;
		signal?: AbortSignal;
		register?: (api: ExtensionAPI) => void;
	} = {},
): ToolHarness {
	const flags = new Map<string, { type: string; default?: boolean | string }>();
	const flagValues = new Map(Object.entries(options.flags ?? {}));
	const harness: ToolHarness = {
		flags,
		getFlag(name: string): boolean | string | undefined {
			return flagValues.has(name) ? flagValues.get(name) : undefined;
		},
	} as ToolHarness;

	const registered: { tool?: unknown } = {};
	const api = {
		registerFlag: vi.fn((name: string, opts: { type: string; default?: boolean | string }) => {
			flags.set(name, opts);
			if (opts.default !== undefined && !flagValues.has(name)) {
				flagValues.set(name, opts.default);
			}
		}),
		registerTool: vi.fn((tool: unknown) => {
			registered.tool = tool;
		}),
		getFlag: harness.getFlag,
	} as unknown as ExtensionAPI;

	(options.register ?? ((api) => void api))(api);

	const ui = {
		select: vi.fn(async () => undefined),
		input: vi.fn(async () => undefined),
		confirm: vi.fn(async () => true),
		editor: vi.fn(async () => undefined),
		custom: vi.fn(async () => undefined),
		notify: vi.fn(),
		...options.ui,
	} as unknown as ExtensionContext["ui"];

	const ctx = {
		mode: options.mode ?? "print",
		hasUI: options.hasUI ?? false,
		ui,
		cwd: "/tmp",
		abort: vi.fn(),
		signal: options.signal,
	} as unknown as ExtensionContext;

	harness.api = api;
	harness.ctx = ctx;
	harness.tool = registered.tool as ToolHarness["tool"];
	return harness;
}

/** A valid single-question params fixture. */
export function singleQuestionParams(overrides: Partial<AskToolInput["questions"][number]> = {}): AskToolInput {
	return {
		questions: [
			{
				id: "storage",
				question: "Which storage backend?",
				options: [
					{ label: "SQLite", description: "File-based, zero config." },
					{ label: "PostgreSQL", description: "Server-based, feature-rich." },
				],
				recommended: 0,
				...overrides,
			},
		],
	};
}

/** A valid two-question params fixture. */
export function twoQuestionParams(): AskToolInput {
	return {
		questions: [
			{
				id: "storage",
				question: "Which storage backend?",
				options: [{ label: "SQLite" }, { label: "PostgreSQL" }],
				recommended: 0,
			},
			{
				id: "auth",
				question: "Which auth method?",
				options: [{ label: "JWT" }, { label: "OAuth2" }],
			},
		],
	};
}

/** Await a short real-time delay (used for countdown/timeout tests). */
export function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
