/**
 * Result and details types for the ask tool.
 *
 * Field names mirror omp's `QuestionResult` / `AskToolDetails` so persisted
 * toolResult `details` stay schema-compatible with the fork that originated
 * this port. Ported from omp `packages/coding-agent/src/tools/ask.ts`.
 */

/** Result for a single question. */
export interface QuestionResult {
	id: string;
	question: string;
	options: string[];
	multi: boolean;
	selectedOptions: string[];
	customInput?: string;
	/** Optional note attached to the selected answer in the rich ask dialog. */
	note?: string;
	/** True when the answer was auto-selected because the dialog timed out. */
	timedOut?: boolean;
}

/** Structured `details` of an ask tool result. */
export interface AskToolDetails {
	question?: string;
	options?: string[];
	multi?: boolean;
	selectedOptions?: string[];
	customInput?: string;
	note?: string;
	timedOut?: boolean;
	/** Multi-part question mode */
	results?: QuestionResult[];
	/** Chat redirect: the user chose "Chat about this" instead of answering. */
	chatRedirect?: boolean;
	/** Questions surfaced when chatRedirect is true. */
	questions?: string[];
}

/** An option as the model provides it (label plus optional description/preview). */
export interface AskOption {
	label: string;
	description?: string;
	preview?: string;
}

/**
 * Validated ask tool input (explicit shape — mirrors `Static<typeof
 * AskParamsSchema>` without depending on typebox, so consumer modules compile
 * even when typebox is not installed; schema.ts asserts the two agree).
 */
export interface AskQuestionInput {
	id: string;
	question: string;
	header?: string;
	options: AskOption[];
	multi?: boolean;
	recommended?: number;
}

export interface AskToolInput {
	questions: AskQuestionInput[];
}

/** Normalized question shape consumed by the rich dialog component. */
export interface AskDialogQuestion {
	id: string;
	question: string;
	header?: string;
	options: AskOption[];
	multi?: boolean;
	recommended?: number;
}

/** Result item produced by the rich dialog for one question. */
export interface AskDialogResultItem {
	id: string;
	question: string;
	options: string[];
	multi: boolean;
	selectedOptions: string[];
	customInput?: string;
	note?: string;
	timedOut?: boolean;
}

/** Final outcome of the rich dialog. */
export type AskDialogSubmitResult =
	| { kind: "submit"; results: AskDialogResultItem[] }
	| { kind: "chat"; questions?: string[] };

/** Internal navigation outcome of a simple-path question. */
export interface NavigationControls {
	allowBack: boolean;
	allowForward: boolean;
	progressText?: string;
}

/** Internal selection outcome of a simple-path question. */
export interface SelectionResult {
	selectedOptions: string[];
	customInput?: string;
	note?: string;
	timedOut: boolean;
	navigation?: "back" | "forward";
	cancelled?: boolean;
}
