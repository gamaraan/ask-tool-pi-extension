/**
 * Pure format-helper unit tests (plan §9.2: ≥10 cases, golden output).
 */
// pi-lens-ignore: typescript:2307
import { describe, expect, it } from "vitest";
import { RECOMMENDED_SUFFIX } from "../../src/constants.ts";
import {
	addRecommendedSuffix,
	formatQuestionResult,
	formatSingleQuestionResponse,
	getAutoSelectionOnTimeout,
	stripRecommendedSuffix,
} from "../../src/format.ts";
import type { QuestionResult } from "../../src/types.ts";

const options = [
	{ label: "SQLite", description: "File-based." },
	{ label: "PostgreSQL" },
	{ label: "MongoDB" },
];

describe("addRecommendedSuffix", () => {
	it("appends the suffix to the recommended index only", () => {
		const result = addRecommendedSuffix(options, 1);
		expect(result.map((option) => option.label)).toEqual([
			"SQLite",
			`PostgreSQL${RECOMMENDED_SUFFIX}`,
			"MongoDB",
		]);
		expect(result[1]?.description).toBeUndefined();
	});

	it("does not double-append when the label already ends with the suffix", () => {
		const already = [{ label: `SQLite${RECOMMENDED_SUFFIX}` }];
		expect(addRecommendedSuffix(already, 0)[0]?.label).toBe(
			`SQLite${RECOMMENDED_SUFFIX}`,
		);
	});

	it("leaves all labels untouched for an out-of-range or negative index", () => {
		expect(
			addRecommendedSuffix(options, 99).map((option) => option.label),
		).toEqual(["SQLite", "PostgreSQL", "MongoDB"]);
		expect(
			addRecommendedSuffix(options, -1).map((option) => option.label),
		).toEqual(["SQLite", "PostgreSQL", "MongoDB"]);
	});

	it("leaves all labels untouched when recommended is undefined", () => {
		expect(addRecommendedSuffix(options).map((option) => option.label)).toEqual(
			["SQLite", "PostgreSQL", "MongoDB"],
		);
	});
});

describe("stripRecommendedSuffix", () => {
	it("strips the suffix when present", () => {
		expect(stripRecommendedSuffix(`JWT${RECOMMENDED_SUFFIX}`)).toBe("JWT");
	});

	it("returns the label unchanged otherwise", () => {
		expect(stripRecommendedSuffix("JWT")).toBe("JWT");
	});
});

describe("getAutoSelectionOnTimeout", () => {
	it("returns the recommended option when in range", () => {
		expect(getAutoSelectionOnTimeout(options, 2)).toEqual(["MongoDB"]);
	});

	it("falls back to the first option when recommended is missing", () => {
		expect(getAutoSelectionOnTimeout(options)).toEqual(["SQLite"]);
	});

	it("falls back to the first option when recommended is out of range", () => {
		expect(getAutoSelectionOnTimeout(options, 42)).toEqual(["SQLite"]);
	});

	it("returns an empty list for an empty option list", () => {
		expect(getAutoSelectionOnTimeout([], 0)).toEqual([]);
	});
});

describe("formatSingleQuestionResponse", () => {
	it("formats a selected answer", () => {
		expect(
			formatSingleQuestionResponse({ selectedOptions: ["JWT"], multi: false }),
		).toBe("User selected: JWT");
	});

	it("formats a multi selection", () => {
		expect(
			formatSingleQuestionResponse({
				selectedOptions: ["JWT", "OAuth2"],
				multi: true,
			}),
		).toBe("User selected: JWT, OAuth2");
	});

	it("formats a custom input", () => {
		expect(
			formatSingleQuestionResponse({
				selectedOptions: [],
				customInput: "Something else",
				multi: false,
			}),
		).toBe("User provided custom input: Something else");
	});

	it("indents multi-line custom input", () => {
		expect(
			formatSingleQuestionResponse({
				selectedOptions: [],
				customInput: "line1\nline2",
				multi: false,
			}),
		).toBe("User provided custom input:\n  line1\n  line2");
	});

	it("marks timeout auto-selection", () => {
		expect(
			formatSingleQuestionResponse({
				selectedOptions: ["SQLite"],
				multi: false,
				timedOut: true,
			}),
		).toBe("User selected: SQLite (auto-selected after timeout)");
	});

	it("appends a note", () => {
		expect(
			formatSingleQuestionResponse({
				selectedOptions: ["JWT"],
				multi: false,
				note: "check expiry",
			}),
		).toBe("User selected: JWT\nUser added note: check expiry");
	});

	it("reports a plain cancel", () => {
		expect(
			formatSingleQuestionResponse({ selectedOptions: [], multi: false }),
		).toBe("User cancelled the selection");
	});
});

describe("formatQuestionResult", () => {
	it("formats a single-selection result", () => {
		const result: QuestionResult = {
			id: "auth",
			question: "Which auth method?",
			options: ["JWT", "OAuth2"],
			multi: false,
			selectedOptions: ["JWT"],
		};
		expect(formatQuestionResult(result)).toBe("auth: JWT");
	});

	it("formats a multi-selection result with timeout marker", () => {
		const result: QuestionResult = {
			id: "auth",
			question: "Which auth method?",
			options: ["JWT", "OAuth2"],
			multi: true,
			selectedOptions: ["JWT", "OAuth2"],
			timedOut: true,
		};
		expect(formatQuestionResult(result)).toBe(
			"auth: [JWT, OAuth2] (auto-selected after timeout)",
		);
	});

	it("formats a custom input result", () => {
		const result: QuestionResult = {
			id: "auth",
			question: "Which auth method?",
			options: ["JWT"],
			multi: false,
			selectedOptions: [],
			customInput: "Magic tokens",
		};
		expect(formatQuestionResult(result)).toBe('auth: "Magic tokens"');
	});

	it("formats a cancelled result with note", () => {
		const result: QuestionResult = {
			id: "auth",
			question: "Which auth method?",
			options: ["JWT"],
			multi: false,
			selectedOptions: [],
			note: "user walked away",
		};
		expect(formatQuestionResult(result)).toBe(
			"auth: (cancelled) (note: user walked away)",
		);
	});
});
