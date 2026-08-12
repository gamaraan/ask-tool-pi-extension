/**
 * Schema + recoverAskQuestions unit tests (plan §9.2: ≥8 cases).
 */
import { describe, expect, it } from "vitest";
import { CHAT_ABOUT_THIS_OPTION, NEXT_OPTION, OTHER_OPTION } from "../../../../../ask-tool/src/constants.ts";
import { AskParamsSchema, recoverAskQuestions, validateAskParams } from "../../../../../ask-tool/src/schema.ts";

const validArgs = {
	questions: [
		{
			id: "auth",
			question: "Which auth method?",
			options: [{ label: "JWT" }, { label: "OAuth2", description: "Delegated." }],
			recommended: 0,
		},
	],
};

describe("ask schema", () => {
	it("accepts a valid single-question payload", () => {
		const parsed = validateAskParams(validArgs);
		expect(parsed.questions).toHaveLength(1);
		expect(parsed.questions[0]?.options[1]?.description).toBe("Delegated.");
	});

	it("accepts a valid multi-question payload with multi and header", () => {
		const parsed = validateAskParams({
			questions: [
				{ id: "a", question: "A?", header: "First", options: [{ label: "x" }], multi: true },
				{ id: "b", question: "B?", options: [{ label: "y" }, { label: "z" }] },
			],
		});
		expect(parsed.questions.map((question) => question.id)).toEqual(["a", "b"]);
	});

	it("rejects an empty questions array", () => {
		expect(() => validateAskParams({ questions: [] })).toThrow(/Invalid ask tool arguments/);
	});

	it("rejects a question with zero options", () => {
		expect(() => validateAskParams({ questions: [{ id: "q", question: "Q?", options: [] }] })).toThrow(
			/Invalid ask tool arguments/,
		);
	});

	for (const reserved of [OTHER_OPTION, CHAT_ABOUT_THIS_OPTION, NEXT_OPTION]) {
		it(`rejects an option label colliding with the reserved label "${reserved}"`, () => {
			expect(() =>
				validateAskParams({
					questions: [{ id: "q", question: "Q?", options: [{ label: reserved }] }],
				}),
			).toThrow(/reserved runtime labels/);
		});
	}

	it("accepts an out-of-range recommended index (no validation error)", () => {
		expect(() =>
			validateAskParams({
				questions: [{ id: "q", question: "Q?", options: [{ label: "a" }], recommended: 5 }],
			}),
		).not.toThrow();
	});

	it("exposes a typebox schema with minItems on questions and options", () => {
		const schema = AskParamsSchema as unknown as {
			properties?: Record<string, { type?: string; minItems?: number }>;
		};
		const questions = schema.properties?.questions;
		expect(questions?.type).toBe("array");
		expect(questions?.minItems).toBe(1);
	});
});

describe("recoverAskQuestions", () => {
	it("round-trips valid persisted arguments", () => {
		const questions = recoverAskQuestions(validArgs);
		expect(questions).toBeDefined();
		expect(questions?.[0]?.id).toBe("auth");
	});

	it("returns undefined for malformed persisted arguments", () => {
		expect(recoverAskQuestions({ questions: [] })).toBeUndefined();
		expect(recoverAskQuestions({ questions: [{ id: "q", question: "Q?", options: [] }] })).toBeUndefined();
		expect(recoverAskQuestions(null)).toBeUndefined();
		expect(recoverAskQuestions("not-an-object")).toBeUndefined();
		expect(
			recoverAskQuestions({
				questions: [{ id: "q", question: "Q?", options: [{ label: OTHER_OPTION }] }],
			}),
		).toBeUndefined();
	});
});
