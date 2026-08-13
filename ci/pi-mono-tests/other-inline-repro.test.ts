/**
 * Regression tests for the reported "Other (type your own) freezes" bug.
 *
 * Root cause (fixed): the inline editor was appended BELOW the option list in
 * the dialog body, and the body is sliced to the measured row budget — the
 * list already filled it, so the editor rendered off-screen. The dialog
 * looked frozen and typing was invisible. The fix makes the editor REPLACE
 * the option list while active.
 *
 * These tests drive the REAL pi-tui TUI (TuiAltScreen + the widget-slot
 * mount the extension uses: component added to a container and focused via
 * `tui.setFocus`, no overlay) with a stub terminal, the real theme, and the
 * actual input routing, asserting the editor is visible and typeable.
 */

// pi-lens-ignore: typescript:2307
import { Container, type Terminal, TuiAltScreen } from "@earendil-works/pi-tui";
// pi-lens-ignore: typescript:2307
import { describe, expect, it } from "vitest";
import {
	initTheme,
	theme,
} from "../../../pi-mono/packages/coding-agent/src/modes/interactive/theme/theme.ts";
import { AskDialogComponent } from "../../src/dialog/ask-dialog-component.ts";
import type { AskDialogSubmitResult } from "../../src/types.ts";
import { keys } from "./test-helpers.ts";

class StubTerminal implements Terminal {
	written = "";
	private inputHandler: ((data: string) => void) | undefined;
	start(onInput: (data: string) => void): void {
		this.inputHandler = onInput;
	}
	send(data: string): void {
		this.inputHandler?.(data);
	}
	stop(): void {}
	drainInput(): Promise<void> {
		return Promise.resolve();
	}
	write(data: string): void {
		this.written += data;
	}
	get columns(): number {
		return 120;
	}
	get rows(): number {
		return 30;
	}
	get kittyProtocolActive(): boolean {
		return false;
	}
	moveBy(): void {}
	hideCursor(): void {}
	showCursor(): void {}
	clearLine(): void {}
	clearFromCursor(): void {}
	clearScreen(): void {}
	setTitle(): void {}
	setProgress(): void {}
}

const questions = [
	{
		id: "storage",
		question: "Which storage backend should I use?",
		options: [
			{
				label: "SQLite",
				description: "File-based, zero config, single-writer.",
			},
			{
				label: "PostgreSQL",
				description: "Server-based, feature-rich, concurrent access.",
			},
			{ label: "MongoDB", description: "Document store with flexible schema." },
		],
		recommended: 0,
	},
];

function plain(text: string): string {
	const escapeCharacter = String.fromCharCode(27);
	return text.replace(
		new RegExp(`${escapeCharacter}\\[[0-9;?]*[a-zA-Z]`, "g"),
		"",
	);
}

describe("Other inline editor visibility (real TUI)", () => {
	it("renders the inline editor on-screen when it opens (regression: sliced-off editor)", () => {
		initTheme("dark");
		const terminal = new StubTerminal();
		const tui = new TuiAltScreen(terminal);
		tui.start();
		const component = new AskDialogComponent(
			questions,
			{ onSubmit: () => {}, onCancel: () => {} },
			{ theme: theme as never, tui },
		);
		// Widget-slot mount: the widget container holds the component and the
		// extension explicitly focuses it (widgets are passive by default).
		const widgetContainer = new Container();
		tui.addChild(widgetContainer);
		widgetContainer.addChild(component);
		tui.setFocus(component);
		tui.renderNow(true);
		terminal.written = "";

		// Navigate to "Other (type your own)" (3 options + Other) and open it.
		for (let i = 0; i < 3; i++) terminal.send(keys.down);
		terminal.send(keys.enter);
		tui.renderNow(true);

		const frame = plain(terminal.written);
		expect(frame).toContain("Enter to submit");
		// The option list is replaced while editing — the list footer must not
		// be what the user sees.
		expect(frame).not.toContain("Enter select");
	});

	it("types through the real input routing and submits the custom answer", () => {
		initTheme("dark");
		const terminal = new StubTerminal();
		const tui = new TuiAltScreen(terminal);
		tui.start();
		let submit: AskDialogSubmitResult | undefined;
		const component = new AskDialogComponent(
			questions,
			{
				onSubmit: (result) => {
					submit = result;
				},
				onCancel: () => {},
			},
			{ theme: theme as never, tui },
		);
		const widgetContainer = new Container();
		tui.addChild(widgetContainer);
		widgetContainer.addChild(component);
		tui.setFocus(component);
		tui.renderNow(true);

		for (let i = 0; i < 3; i++) terminal.send(keys.down);
		terminal.send(keys.enter);
		for (const char of "Custom backend") terminal.send(char);
		terminal.send(keys.enter);
		tui.renderNow(true);

		expect(submit).toBeDefined();
		if (submit?.kind === "submit") {
			expect(submit.results[0]?.customInput).toBe("Custom backend");
			expect(submit.results[0]?.selectedOptions).toEqual([]);
		}
	});
});
