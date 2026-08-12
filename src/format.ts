/**
 * Pure formatting helpers: recommended-option suffix handling, timeout
 * auto-selection, and the response text sent back to the model.
 *
 * Ported byte-for-byte from omp `packages/coding-agent/src/tools/ask.ts`
 * (formatting output is part of the user-facing contract).
 */
import { RECOMMENDED_SUFFIX } from "./constants.ts";
import type { AskOption, QuestionResult } from "./types.ts";

/** Add "(Recommended)" suffix to the option at the given index if not already present. */
export function addRecommendedSuffix(
	options: AskOption[],
	recommendedIndex?: number,
): Array<{ label: string; description?: string }> {
	if (
		recommendedIndex === undefined ||
		recommendedIndex < 0 ||
		recommendedIndex >= options.length
	) {
		return options.map((option) => ({
			label: option.label,
			description: option.description,
		}));
	}
	return options.map((option, i) => ({
		label:
			i === recommendedIndex && !option.label.endsWith(RECOMMENDED_SUFFIX)
				? option.label + RECOMMENDED_SUFFIX
				: option.label,
		description: option.description,
	}));
}

/** Strip "(Recommended)" suffix from a label. */
export function stripRecommendedSuffix(label: string): string {
	return label.endsWith(RECOMMENDED_SUFFIX)
		? label.slice(0, -RECOMMENDED_SUFFIX.length)
		: label;
}

/** Auto-selection when a question times out: recommended option, else the first. */
export function getAutoSelectionOnTimeout(
	options: AskOption[],
	recommended?: number,
): string[] {
	if (options.length === 0) return [];
	if (
		typeof recommended === "number" &&
		recommended >= 0 &&
		recommended < options.length
	) {
		return [options[recommended]!.label];
	}
	return [options[0]!.label];
}

/** Format one question's result for a multi-question response. */
export function formatQuestionResult(result: QuestionResult): string {
	const noteSuffix = result.note ? ` (note: ${result.note})` : "";
	if (result.customInput !== undefined) {
		return `${result.id}: "${result.customInput}"${noteSuffix}`;
	}
	if (result.selectedOptions.length > 0) {
		const suffix = `${result.timedOut ? " (auto-selected after timeout)" : ""}${noteSuffix}`;
		return result.multi
			? `${result.id}: [${result.selectedOptions.join(", ")}]${suffix}`
			: `${result.id}: ${result.selectedOptions[0]}${suffix}`;
	}
	return `${result.id}: (cancelled)${noteSuffix}`;
}

/** Format a single-question response. */
export function formatSingleQuestionResponse(result: {
	selectedOptions: string[];
	customInput?: string;
	note?: string;
	timedOut?: boolean;
	multi: boolean;
}): string {
	const responseParts: string[] = [];
	if (result.selectedOptions.length > 0) {
		const selectedText = result.multi
			? `User selected: ${result.selectedOptions.join(", ")}`
			: `User selected: ${result.selectedOptions[0]}`;
		responseParts.push(
			result.timedOut
				? `${selectedText} (auto-selected after timeout)`
				: selectedText,
		);
	}
	if (result.customInput !== undefined) {
		responseParts.push(
			result.customInput.includes("\n")
				? `User provided custom input:\n${result.customInput
						.split("\n")
						.map((line) => `  ${line}`)
						.join("\n")}`
				: `User provided custom input: ${result.customInput}`,
		);
	}
	if (result.note) {
		responseParts.push(
			result.note.includes("\n")
				? `User added note:\n${result.note
						.split("\n")
						.map((line) => `  ${line}`)
						.join("\n")}`
				: `User added note: ${result.note}`,
		);
	}
	return responseParts.length > 0
		? responseParts.join("\n")
		: "User cancelled the selection";
}
