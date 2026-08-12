/**
 * TypeBox schemas for the ask tool plus imperative validation that TypeBox
 * cannot express (reserved-label collisions) and the `recoverAskQuestions`
 * helper for re-opening a persisted ask with the original questions.
 *
 * Ported from omp `packages/coding-agent/src/tools/ask.ts` (omptype → typebox).
 *
 * `Type` is imported through `@earendil-works/pi-ai`, which re-exports it:
 * the package then has zero direct typebox dependency — resolution works in
 * pi's extension loader (virtual modules), pi-mono's vitest alias graph, and
 * the monorepo tsconfig paths alike. Validation is structural (schema
 * constraints are mirrored imperatively) so `typebox/value` is not needed.
 */
import { Type } from "@earendil-works/pi-ai";
import { RESERVED_OPTION_LABELS } from "./constants.ts";
import type { AskToolInput } from "./types.ts";

export type { AskToolInput } from "./types.ts";

export const OptionItem = Type.Object({
	label: Type.String({ description: "Display label for the option" }),
	description: Type.Optional(
		Type.String({
			description: "Optional explanatory text displayed below the label",
		}),
	),
	preview: Type.Optional(
		Type.String({
			description: "Optional rich preview content for interactive ask dialogs",
		}),
	),
});

export const QuestionItem = Type.Object({
	id: Type.String({ description: "Question id" }),
	question: Type.String({ description: "Question text" }),
	header: Type.Optional(
		Type.String({
			description: "Optional short display chip for rich ask dialogs",
		}),
	),
	options: Type.Array(OptionItem, {
		description: "Available options",
		minItems: 1,
	}),
	multi: Type.Optional(
		Type.Boolean({ description: "Allow multiple selections" }),
	),
	recommended: Type.Optional(
		Type.Number({ description: "Recommended option index" }),
	),
});

export const AskParamsSchema = Type.Object({
	questions: Type.Array(QuestionItem, {
		description: "Questions to ask",
		minItems: 1,
	}),
});

function invalid(message: string): Error {
	return new Error(`Invalid ask tool arguments:\n  - ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Imperative reserved-label check (the typebox analogue of omp's `.narrow`).
 * Returns the offending label, or `undefined` when all labels are free.
 */
export function findReservedLabelCollision(
	questions: unknown,
): string | undefined {
	if (!Array.isArray(questions)) return undefined;
	for (const question of questions) {
		if (!isRecord(question)) continue;
		const options = question.options;
		if (!Array.isArray(options)) continue;
		for (const option of options) {
			if (!isRecord(option)) continue;
			const label = option.label;
			if (typeof label === "string" && RESERVED_OPTION_LABELS[label] === true) {
				return label;
			}
		}
	}
	return undefined;
}

/**
 * Validate raw tool-call arguments against the ask schema, including the
 * reserved-label collision check. Returns the validated payload or throws an
 * `Error` describing the first problem — used by `prepareArguments` and by
 * `recoverAskQuestions` (which fails closed instead of throwing). The checks
 * mirror the `AskParamsSchema` constraints (minItems, string/boolean/number
 * types) so validation and schema cannot drift apart.
 */
export function validateAskParams(args: unknown): AskToolInput {
	if (!isRecord(args)) throw invalid("root: expected an object");
	const questions = args.questions;
	if (!Array.isArray(questions) || questions.length === 0) {
		throw invalid("questions: must be an array with at least 1 question");
	}
	const collision = findReservedLabelCollision(questions);
	if (collision !== undefined) {
		throw new Error(
			`Ask tool options must not use reserved runtime labels: "${collision}" is reserved for the UI`,
		);
	}
	for (let index = 0; index < questions.length; index++) {
		const question = questions[index];
		const path = `questions[${index}]`;
		if (!isRecord(question)) throw invalid(`${path}: expected an object`);
		if (typeof question.id !== "string")
			throw invalid(`${path}.id: expected a string`);
		if (typeof question.question !== "string")
			throw invalid(`${path}.question: expected a string`);
		if (question.header !== undefined && typeof question.header !== "string") {
			throw invalid(`${path}.header: expected a string`);
		}
		if (question.multi !== undefined && typeof question.multi !== "boolean") {
			throw invalid(`${path}.multi: expected a boolean`);
		}
		if (
			question.recommended !== undefined &&
			typeof question.recommended !== "number"
		) {
			throw invalid(`${path}.recommended: expected a number`);
		}
		const options = question.options;
		if (!Array.isArray(options) || options.length === 0) {
			throw invalid(`${path}.options: must be an array with at least 1 option`);
		}
		for (let optionIndex = 0; optionIndex < options.length; optionIndex++) {
			const option = options[optionIndex];
			const optionPath = `${path}.options[${optionIndex}]`;
			if (!isRecord(option)) throw invalid(`${optionPath}: expected an object`);
			if (typeof option.label !== "string")
				throw invalid(`${optionPath}.label: expected a string`);
			if (
				option.description !== undefined &&
				typeof option.description !== "string"
			) {
				throw invalid(`${optionPath}.description: expected a string`);
			}
			if (option.preview !== undefined && typeof option.preview !== "string") {
				throw invalid(`${optionPath}.preview: expected a string`);
			}
		}
	}
	return args as unknown as AskToolInput;
}

/**
 * Recover a validated `questions` payload from a persisted `ask` toolCall's
 * `arguments`. Runs the same schema the live tool call validated against —
 * legacy/corrupted persisted args fail closed (`undefined`) rather than
 * feeding malformed data back into a picker. Exported for future `/tree`
 * re-answer wiring; the picker itself is out of scope for v1.
 */
export function recoverAskQuestions(
	toolCallArguments: unknown,
): AskToolInput["questions"] | undefined {
	try {
		return validateAskParams(toolCallArguments).questions;
	} catch {
		return undefined;
	}
}
