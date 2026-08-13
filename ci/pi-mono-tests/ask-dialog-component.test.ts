/**
 * Rich dialog (Path A) component tests (plan §9.2: ≥12 cases across T7.1–T7.6).
 *
 * The component is driven directly: construct with fakes, feed synthetic key
 * sequences (pi-tui escape codes), and assert `render` output and the
 * `onSubmit`/`onCancel` payloads.
 */
// pi-lens-ignore: typescript:2307
import { describe, expect, it, vi } from "vitest";
import { OTHER_OPTION } from "../../src/constants.ts";
import { AskDialogComponent } from "../../src/dialog/ask-dialog-component.ts";
import type {
	AskDialogQuestion,
	AskDialogSubmitResult,
} from "../../src/types.ts";
import { fakeTheme, fakeTui, keys } from "./test-helpers.ts";

function setup(
	questions: AskDialogQuestion[],
	options: { timeout?: number } = {},
) {
	const onSubmit = vi.fn<(result: AskDialogSubmitResult) => void>();
	const onCancel = vi.fn<() => void>();
	const tui = fakeTui();
	const theme = fakeTheme();
	const component = new AskDialogComponent(
		questions,
		{ onSubmit, onCancel },
		{ ...options, tui, theme },
	);
	const render = () => component.render(80).join("\n");
	return { component, onSubmit, onCancel, render, tui };
}

const singleQuestion: AskDialogQuestion = {
	id: "storage",
	question: "Which storage backend?",
	options: [
		{ label: "SQLite", description: "File-based, zero config." },
		{ label: "PostgreSQL", description: "Server-based." },
		{ label: "MongoDB" },
	],
	recommended: 1,
};

describe("AskDialogComponent", () => {
	it("T7.1 renders the question, options with markers/descriptions, Other and Chat rows", () => {
		const { render } = setup([singleQuestion]);
		const out = render();
		expect(out).toContain("Ask");
		expect(out).toContain("Which storage backend?");
		expect(out).toContain("SQLite");
		expect(out).toContain("File-based, zero config.");
		expect(out).toContain("PostgreSQL (Recommended)");
		expect(out).toContain("❯ ○ PostgreSQL (Recommended)");
		expect(out).toContain(OTHER_OPTION);
		expect(out).toContain("Chat about this");
	});

	it("T7.2 ↑/↓ moves the cursor marker between rows", () => {
		const { component, render } = setup([singleQuestion]);
		// Cursor starts on the recommended row (index 1).
		component.handleInput(keys.up);
		expect(render()).toContain("❯ ○ SQLite");
		component.handleInput(keys.down);
		component.handleInput(keys.down);
		const out = render();
		expect(out).toContain("❯ ○ MongoDB");
		expect(out).not.toContain("❯ ○ SQLite");
	});

	it("T7.2 Enter selects the recommended option and submits a single question", () => {
		const { component, onSubmit } = setup([singleQuestion]);
		component.handleInput(keys.enter);
		expect(onSubmit).toHaveBeenCalledTimes(1);
		const result = onSubmit.mock.calls[0]?.[0];
		expect(result).toMatchObject({ kind: "submit" });
		if (result?.kind === "submit") {
			expect(result.results[0]?.selectedOptions).toEqual(["PostgreSQL"]);
			expect(result.results[0]?.multi).toBe(false);
		}
	});

	it("T7.3 multi: Space/Enter toggles checkboxes and the Submit tab confirms", () => {
		const multi: AskDialogQuestion = {
			id: "features",
			question: "Which features?",
			multi: true,
			options: [{ label: "A" }, { label: "B" }, { label: "C" }],
		};
		const { component, render, onSubmit } = setup([multi]);
		component.handleInput(keys.enter); // toggle A
		component.handleInput(keys.down);
		component.handleInput(keys.space); // toggle B
		expect(render()).toContain("☑ A");
		expect(render()).toContain("☑ B");
		// Enter on a multi question must NOT submit — go to the Submit tab.
		component.handleInput(keys.tab);
		expect(render()).toContain("Review answers");
		component.handleInput(keys.enter);
		const result = onSubmit.mock.calls[0]?.[0];
		if (result?.kind === "submit") {
			expect(result.results[0]?.selectedOptions).toEqual(["A", "B"]);
		}
		expect(onSubmit).toHaveBeenCalledTimes(1);
	});

	it("T7.2/D5 Other opens the inline editor and records the custom input", async () => {
		const { component, onSubmit } = setup([singleQuestion]);
		// Cursor starts at recommended (1): down twice reaches the Other row.
		component.handleInput(keys.down);
		component.handleInput(keys.down);
		component.handleInput(keys.enter);
		// Type a custom answer and submit it.
		for (const char of "Custom DB") component.handleInput(char);
		component.handleInput(keys.enter);
		const result = onSubmit.mock.calls[0]?.[0];
		if (result?.kind === "submit") {
			expect(result.results[0]?.customInput).toBe("Custom DB");
			expect(result.results[0]?.selectedOptions).toEqual([]);
		}
		expect(onSubmit).toHaveBeenCalledTimes(1);
	});

	it("T7.2 Esc inside the inline editor returns to the list without submitting", () => {
		const { component, onSubmit, render } = setup([singleQuestion]);
		component.handleInput(keys.down);
		component.handleInput(keys.down);
		component.handleInput(keys.enter); // enter Other editor
		component.handleInput("x");
		component.handleInput(keys.escape); // back to list
		expect(onSubmit).not.toHaveBeenCalled();
		expect(render()).toContain("Chat about this");
	});

	it("T7.2/F10 Chat about this returns a chat redirect result", () => {
		const { component, onSubmit } = setup([singleQuestion]);
		// Cursor starts at recommended (1); Chat is the last row (3 downs).
		component.handleInput(keys.down);
		component.handleInput(keys.down);
		component.handleInput(keys.down);
		component.handleInput(keys.enter);
		expect(onSubmit).toHaveBeenCalledWith({ kind: "chat" });
	});

	it("T7.2 Esc cancels the whole dialog", () => {
		const { component, onCancel } = setup([singleQuestion]);
		component.handleInput(keys.escape);
		expect(onCancel).toHaveBeenCalledTimes(1);
	});

	it("T7.3 multi-question paging: answer Q1, tab to Q2, back preserves the answer", () => {
		const { component, render } = setup([
			singleQuestion,
			{
				id: "auth",
				question: "Which auth method?",
				options: [{ label: "JWT" }, { label: "OAuth2" }],
			},
		]);
		component.handleInput(keys.enter); // answer Q1 (PostgreSQL recommended)
		let out = render();
		expect(out).toContain("2. auth");
		expect(out).toContain("Which auth method?");
		component.handleInput(keys.left); // back to Q1
		out = render();
		expect(out).toContain("Which storage backend?");
		expect(out).toContain("◉ PostgreSQL (Recommended)");
		// The multi-question dialog has a Submit tab; go forward again.
		component.handleInput(keys.right);
		component.handleInput(keys.right);
		expect(render()).toContain("Review answers");
	});

	it("T7.4 timeout auto-selects the recommended option and marks timedOut", async () => {
		const { onSubmit } = setup([singleQuestion], { timeout: 40 });
		await new Promise((resolve) => setTimeout(resolve, 150));
		expect(onSubmit).toHaveBeenCalledTimes(1);
		const result = onSubmit.mock.calls[0]?.[0];
		if (result?.kind === "submit") {
			expect(result.results[0]?.selectedOptions).toEqual(["PostgreSQL"]);
			expect(result.results[0]?.timedOut).toBe(true);
		}
	});

	it("T7.4 timeout does not fire when the user already answered", async () => {
		const { component, onSubmit } = setup([singleQuestion], { timeout: 40 });
		component.handleInput(keys.enter); // answer immediately
		await new Promise((resolve) => setTimeout(resolve, 120));
		expect(onSubmit).toHaveBeenCalledTimes(1);
		const result = onSubmit.mock.calls[0]?.[0];
		if (result?.kind === "submit") {
			expect(result.results[0]?.timedOut).toBeUndefined();
		}
	});

	it("T7.5 header chip renders in the tab bar", () => {
		const { render } = setup([
			{
				id: "s",
				header: "Storage",
				question: "Which storage backend?",
				options: [{ label: "SQLite" }],
			},
			{ id: "a", question: "Which auth method?", options: [{ label: "JWT" }] },
		]);
		expect(render()).toContain("1. Storage");
	});

	it("T7.4 Esc just after show is a cancel, not a timeout (tolerance window)", async () => {
		const { component, onCancel, onSubmit } = setup([singleQuestion], {
			timeout: 60,
		});
		component.handleInput(keys.escape);
		expect(onCancel).toHaveBeenCalledTimes(1);
		await new Promise((resolve) => setTimeout(resolve, 120));
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("T7.2 note key attaches a note to the selected answer", () => {
		const { component, onSubmit } = setup([singleQuestion]);
		component.handleInput("n"); // note for the recommended row
		for (const char of "fast") component.handleInput(char);
		component.handleInput(keys.enter); // save note
		component.handleInput(keys.enter); // select PostgreSQL → submit
		const result = onSubmit.mock.calls[0]?.[0];
		if (result?.kind === "submit") {
			expect(result.results[0]?.note).toBe("fast");
			expect(result.results[0]?.selectedOptions).toEqual(["PostgreSQL"]);
		}
	});

	it("T7.6 maps the rich result into per-question items with ids and options", () => {
		const { component, onSubmit } = setup([singleQuestion]);
		component.handleInput(keys.enter);
		const result = onSubmit.mock.calls[0]?.[0];
		if (result?.kind === "submit") {
			expect(result.results[0]?.id).toBe("storage");
			expect(result.results[0]?.options).toEqual([
				"SQLite",
				"PostgreSQL",
				"MongoDB",
			]);
		}
	});
});
