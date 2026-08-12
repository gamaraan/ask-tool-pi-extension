/**
 * renderCall / renderResult snapshot tests (plan T9 / §9.2: ≥5 cases).
 */
// pi-lens-ignore: typescript:2307
import { describe, expect, it } from "vitest";
import askToolExtension from "../../src/index.ts";
import type { AskToolDetails } from "../../src/types.ts";
import { fakeTheme, setupHarness } from "./test-helpers.ts";

function tool() {
	const { tool } = setupHarness({ register: (pi) => askToolExtension(pi) });
	return tool;
}

function render(
	component: { render(width: number): string[] } | undefined,
	width = 80,
): string {
	if (!component) return "";
	return component.render(width).join("\n");
}

describe("ask renderers", () => {
	it("renderCall shows the question form with option markers", () => {
		const out = render(
			tool().renderCall?.(
				{
					questions: [
						{
							id: "storage",
							question: "Which storage backend?",
							options: [
								{ label: "SQLite", description: "File-based." },
								{ label: "PostgreSQL" },
							],
						},
					],
				},
				fakeTheme(),
			),
		);
		expect(out).toContain("Ask");
		expect(out).toContain("Which storage backend?");
		expect(out).toContain("○ SQLite");
		expect(out).toContain("↳ File-based.");
		expect(out).toContain("○ PostgreSQL");
	});

	it("renderCall normalizes model-mangled args without crashing", () => {
		const out = render(
			tool().renderCall?.({ questions: '{"bad": true}' } as never, fakeTheme()),
		);
		// Falls back to the no-question error frame instead of throwing.
		expect(out).toContain("Ask");
	});

	it("renderResult shows the selected answer for a single question", () => {
		const details: AskToolDetails = {
			question: "Which storage backend?",
			options: ["SQLite", "PostgreSQL"],
			multi: false,
			selectedOptions: ["SQLite"],
		};
		const out = render(
			tool().renderResult?.(
				{ content: [{ type: "text", text: "User selected: SQLite" }], details },
				{} as never,
				fakeTheme(),
			),
		);
		expect(out).toContain("◉ SQLite");
		expect(out).toContain("○ PostgreSQL");
	});

	it("renderResult marks timeout auto-selection and notes", () => {
		const details: AskToolDetails = {
			question: "Which storage backend?",
			options: ["SQLite"],
			multi: false,
			selectedOptions: ["SQLite"],
			timedOut: true,
			note: "user was away",
		};
		const out = render(
			tool().renderResult?.(
				{
					content: [
						{
							type: "text",
							text: "User selected: SQLite (auto-selected after timeout)",
						},
					],
					details,
				},
				{} as never,
				fakeTheme(),
			),
		);
		expect(out).toContain("auto-selected after timeout — not a user choice");
		expect(out).toContain("Note:");
	});

	it("renderResult shows the chat redirect frame", () => {
		const details: AskToolDetails = {
			chatRedirect: true,
			questions: ["Which storage backend?"],
		};
		const out = render(
			tool().renderResult?.(
				{
					content: [
						{
							type: "text",
							text: "User chose to chat about this instead of answering.",
						},
					],
					details,
				},
				{} as never,
				fakeTheme(),
			),
		);
		expect(out).toContain("chat redirect");
		expect(out).toContain("Which storage backend?");
	});

	it("renderResult renders multi-question results with custom input", () => {
		const details: AskToolDetails = {
			results: [
				{
					id: "storage",
					question: "Which storage backend?",
					options: ["SQLite", "PostgreSQL"],
					multi: false,
					selectedOptions: ["PostgreSQL"],
				},
				{
					id: "auth",
					question: "Which auth method?",
					options: ["JWT", "OAuth2"],
					multi: false,
					selectedOptions: [],
					customInput: "Magic tokens",
				},
			],
		};
		const out = render(
			tool().renderResult?.(
				{ content: [{ type: "text", text: "User answers:" }], details },
				{} as never,
				fakeTheme(),
			),
		);
		expect(out).toContain("2 questions");
		expect(out).toContain("◉ PostgreSQL");
		expect(out).toContain("✓ Magic tokens");
	});
});
