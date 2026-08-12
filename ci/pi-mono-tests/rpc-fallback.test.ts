/**
 * Path B (RPC fallback) loop tests (plan §9.2: ≥7 cases).
 */
import { describe, expect, it, vi } from "vitest";
import { DONE_OPTION, OTHER_OPTION, RECOMMENDED_SUFFIX } from "../../../../../ask-tool/src/constants.ts";
import { type AskUiContext, askQuestionsViaSimpleRpc } from "../../../../../ask-tool/src/rpc-fallback.ts";
import type { AskToolInput } from "../../../../../ask-tool/src/types.ts";

function ui(overrides: Partial<AskUiContext> = {}): AskUiContext & { calls: Record<string, unknown[][]> } {
	const select = vi.fn<AskUiContext["select"]>(async () => "SQLite");
	const input = vi.fn<AskUiContext["input"]>(async () => undefined);
	const confirm = vi.fn<AskUiContext["confirm"]>(async () => true);
	const editor = vi.fn<AskUiContext["editor"]>(async () => undefined);
	return {
		select: overrides.select ?? select,
		input: overrides.input ?? input,
		confirm: overrides.confirm ?? confirm,
		editor: overrides.editor ?? editor,
		calls: {
			select: [],
			input: [],
			confirm: [],
			editor: [],
		},
	} as AskUiContext & { calls: Record<string, unknown[][]> };
}

const single: AskToolInput = {
	questions: [
		{
			id: "storage",
			question: "Which storage backend?",
			options: [{ label: "SQLite", description: "File-based." }, { label: "PostgreSQL" }],
			recommended: 0,
		},
	],
};

const two: AskToolInput = {
	questions: [
		{
			id: "storage",
			question: "Which storage backend?",
			options: [{ label: "SQLite" }, { label: "PostgreSQL" }],
			recommended: 0,
		},
		{ id: "auth", question: "Which auth method?", options: [{ label: "JWT" }, { label: "OAuth2" }] },
	],
};

describe("askQuestionsViaSimpleRpc", () => {
	it("answers a single question via select", async () => {
		const select = vi.fn<AskUiContext["select"]>(async () => "PostgreSQL");
		const mockUi = ui({ select });
		const outcome = await askQuestionsViaSimpleRpc(mockUi, single.questions, { timeoutMs: 0 });
		expect(outcome.cancelled).toBeUndefined();
		expect(outcome.results?.[0]?.selectedOptions).toEqual(["PostgreSQL"]);
		expect(outcome.results?.[0]?.multi).toBe(false);
	});

	it("appends the recommended suffix to the select option label", async () => {
		const select = vi.fn<AskUiContext["select"]>(async () => "SQLite");
		const mockUi = ui({ select });
		await askQuestionsViaSimpleRpc(mockUi, single.questions, { timeoutMs: 0 });
		const options = select.mock.calls[0]?.[1];
		expect(options?.[0]).toBe(`SQLite${RECOMMENDED_SUFFIX}`);
		expect(options?.[options.length - 1]).toBe(OTHER_OPTION);
	});

	it("routes Other through the editor and records custom input", async () => {
		const select = vi.fn<AskUiContext["select"]>(async () => OTHER_OPTION);
		const editor = vi.fn<AskUiContext["editor"]>(async () => "Custom backend");
		const mockUi = ui({ select, editor });
		const outcome = await askQuestionsViaSimpleRpc(mockUi, single.questions, { timeoutMs: 0 });
		expect(editor).toHaveBeenCalled();
		expect(outcome.results?.[0]?.customInput).toBe("Custom backend");
		expect(outcome.results?.[0]?.selectedOptions).toEqual([]);
	});

	it("auto-selects the recommended option when the select times out", async () => {
		const select = vi.fn<AskUiContext["select"]>(() => new Promise(() => {}));
		const mockUi = ui({ select });
		const outcome = await askQuestionsViaSimpleRpc(mockUi, single.questions, { timeoutMs: 40 });
		expect(outcome.results?.[0]?.selectedOptions).toEqual(["SQLite"]);
		expect(outcome.results?.[0]?.timedOut).toBe(true);
	});

	it("walks forward through multiple questions with the confirm gate", async () => {
		const select = vi.fn<AskUiContext["select"]>(async () => "SQLite");
		const confirm = vi.fn<AskUiContext["confirm"]>(async () => true);
		const mockUi = ui({ select, confirm });
		const outcome = await askQuestionsViaSimpleRpc(mockUi, two.questions, { timeoutMs: 0 });
		expect(confirm).toHaveBeenCalledTimes(1);
		expect(outcome.results?.map((result) => result.id)).toEqual(["storage", "auth"]);
	});

	it("cancels when the confirm gate is declined at the first question", async () => {
		const select = vi.fn<AskUiContext["select"]>(async () => "SQLite");
		const confirm = vi.fn<AskUiContext["confirm"]>(async () => false);
		const mockUi = ui({ select, confirm });
		const outcome = await askQuestionsViaSimpleRpc(mockUi, two.questions, { timeoutMs: 0 });
		// storage answered → gate declined at the first question → whole ask cancelled.
		expect(outcome.cancelled).toBe(true);
		expect(select).toHaveBeenCalledTimes(1);
	});

	it("cancels on Esc (select returns undefined without timeout)", async () => {
		const select = vi.fn<AskUiContext["select"]>(async () => undefined);
		const mockUi = ui({ select });
		const outcome = await askQuestionsViaSimpleRpc(mockUi, single.questions, { timeoutMs: 0 });
		expect(outcome.cancelled).toBe(true);
	});

	it("toggles multi selections and submits via the done option", async () => {
		const multi: AskToolInput = {
			questions: [
				{
					id: "features",
					question: "Which features?",
					multi: true,
					options: [{ label: "A" }, { label: "B" }, { label: "C" }],
				},
			],
		};
		const select = vi
			.fn<AskUiContext["select"]>()
			.mockResolvedValueOnce("A")
			.mockResolvedValueOnce("B")
			.mockResolvedValueOnce(DONE_OPTION);
		const mockUi = ui({ select });
		const outcome = await askQuestionsViaSimpleRpc(mockUi, multi.questions, { timeoutMs: 0 });
		expect(outcome.results?.[0]?.multi).toBe(true);
		expect(outcome.results?.[0]?.selectedOptions).toEqual(["A", "B"]);
	});

	it("walks back to the previous question when the gate is declined", async () => {
		const three: AskToolInput = {
			questions: [
				{ id: "q0", question: "Q0?", options: [{ label: "A" }] },
				{ id: "q1", question: "Q1?", options: [{ label: "B" }] },
				{ id: "q2", question: "Q2?", options: [{ label: "C" }] },
			],
		};
		const select = vi.fn<AskUiContext["select"]>(async () => "A");
		const confirm = vi
			.fn<AskUiContext["confirm"]>()
			.mockResolvedValueOnce(true) // q0 answered → forward to q1
			.mockResolvedValueOnce(false) // decline after q1 → back to q0
			.mockResolvedValueOnce(true) // q0 re-answered → forward
			.mockResolvedValueOnce(true); // q1 → forward → q2 → done
		const mockUi = ui({ select, confirm });
		const outcome = await askQuestionsViaSimpleRpc(mockUi, three.questions, { timeoutMs: 0 });
		expect(outcome.results?.map((result) => result.id)).toEqual(["q0", "q1", "q2"]);
		// q0, q1, then q0 (re-ask), q1 (re-ask), q2.
		expect(select).toHaveBeenCalledTimes(5);
	});
});
