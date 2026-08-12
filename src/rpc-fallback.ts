/**
 * Simple per-question fallback path (Path B) for non-TUI modes (RPC).
 *
 * Port of omp's simple select loop (`ask.ts` `askSingleQuestion`) built on
 * pi's `ExtensionUIContext.select/input/confirm/editor` primitives. pi's
 * `select` takes plain strings, so descriptions and markers are dropped here
 * — matching omp's simple-path degradation. "Chat about this" is NOT offered
 * in this path (it is a rich-dialog affordance; documented in the README).
 */
import {
	DONE_OPTION,
	OTHER_OPTION,
	TIMEOUT_DETECTION_TOLERANCE_MS,
} from "./constants.ts";
import {
	addRecommendedSuffix,
	getAutoSelectionOnTimeout,
	stripRecommendedSuffix,
} from "./format.ts";
import {
	type AbortLike,
	abortError,
	createAbortController,
	timers,
} from "./timers.ts";
import type {
	AskOption,
	AskToolInput,
	NavigationControls,
	QuestionResult,
	SelectionResult,
} from "./types.ts";

export interface AskUiContext {
	select(
		title: string,
		options: string[],
		opts?: { signal?: AbortLike; timeout?: number },
	): Promise<string | undefined>;
	input(
		title: string,
		placeholder?: string,
		opts?: { signal?: AbortLike; timeout?: number },
	): Promise<string | undefined>;
	confirm(
		title: string,
		message: string,
		opts?: { signal?: AbortLike; timeout?: number },
	): Promise<boolean>;
	editor(
		title: string,
		prefill?: string,
		opts?: { signal?: AbortLike },
	): Promise<string | undefined>;
}

export interface RpcFallbackOptions {
	timeoutMs: number;
	signal?: AbortLike;
}

export interface RpcFallbackOutcome {
	results?: QuestionResult[];
	cancelled?: boolean;
}

interface SingleQuestionOptions {
	recommended?: number;
	timeout?: number;
	signal?: AbortLike;
	initialSelection?: Pick<
		SelectionResult,
		"selectedOptions" | "customInput" | "note"
	>;
	navigation?: NavigationControls;
}

interface SelectOutcome {
	choice: string | undefined;
	timedOut: boolean;
	navigation?: "back" | "forward";
}

/**
 * Run the RPC-per-question orchestration loop. Returns `cancelled: true`
 * when the user Esc'd (the caller aborts the turn); otherwise `results` with
 * one entry per question, in order.
 */
export async function askQuestionsViaSimpleRpc(
	ui: AskUiContext,
	questions: AskToolInput["questions"],
	options: RpcFallbackOptions,
): Promise<RpcFallbackOutcome> {
	const resultsByIndex: Array<QuestionResult | undefined> = Array.from({
		length: questions.length,
	});
	let questionIndex = 0;
	while (questionIndex < questions.length) {
		const question = questions[questionIndex];
		if (!question) return { cancelled: true };
		const previous = resultsByIndex[questionIndex];
		const navigation: NavigationControls = {
			allowBack: questionIndex > 0,
			allowForward: true,
			progressText: `${questionIndex + 1}/${questions.length}`,
		};
		const selection = await askSingleQuestion(
			ui,
			question.question,
			question.options,
			question.multi ?? false,
			{
				recommended: question.recommended,
				timeout: options.timeoutMs > 0 ? options.timeoutMs : undefined,
				signal: options.signal,
				initialSelection: previous,
				navigation,
			},
		);
		if (selection.cancelled === true && !selection.timedOut) {
			return { cancelled: true };
		}
		resultsByIndex[questionIndex] = {
			id: question.id,
			question: question.question,
			options: question.options.map((option) => option.label),
			multi: question.multi ?? false,
			selectedOptions: selection.selectedOptions,
			customInput: selection.customInput,
			note: selection.note,
			timedOut: selection.timedOut || undefined,
		};

		if (questionIndex < questions.length - 1) {
			// Gate to the next question; "No" walks back to the previous
			// question (re-asked with its prior answer pre-selected), or
			// cancels when already at the first question.
			const dialogOptions = {
				timeout: options.timeoutMs > 0 ? options.timeoutMs : undefined,
				signal: options.signal,
			};
			const goNext = await ui.confirm(
				`Question ${questionIndex + 1}/${questions.length} answered`,
				"Continue to the next question?",
				dialogOptions,
			);
			if (!goNext) {
				if (questionIndex === 0) return { cancelled: true };
				questionIndex -= 1;
				continue;
			}
		}
		questionIndex += 1;
	}

	const results = questions.map((question, index) => {
		const result = resultsByIndex[index];
		if (result) return result;
		return {
			id: question.id,
			question: question.question,
			options: question.options.map((option) => option.label),
			multi: question.multi ?? false,
			selectedOptions: [],
		};
	});
	return { results };
}

/** One question via `select` (+ `editor` for "Other") — port of omp's `askSingleQuestion`. */
async function askSingleQuestion(
	ui: AskUiContext,
	question: string,
	questionOptions: AskOption[],
	multi: boolean,
	options: SingleQuestionOptions = {},
): Promise<SelectionResult> {
	const { recommended, timeout, signal, initialSelection, navigation } =
		options;
	const doneLabel = DONE_OPTION;
	let selectedOptions = [...(initialSelection?.selectedOptions ?? [])];
	let customInput = initialSelection?.customInput;
	const note = initialSelection?.note;
	let timedOut = false;

	const selectOption = async (
		prompt: string,
		optionsToShow: string[],
		initialIndex?: number,
	): Promise<SelectOutcome> => {
		let timeoutTriggered = false;
		let navigationAction: "back" | "forward" | undefined;
		const timeoutMs =
			typeof timeout === "number" && timeout > 0 ? timeout : undefined;
		const timeoutController =
			timeoutMs === undefined ? undefined : createAbortController();
		let dialogSignal: AbortLike | undefined;
		if (timeoutController) {
			dialogSignal = timeoutController.signal;
			if (signal) {
				signal.addEventListener("abort", () => timeoutController.abort(), {
					once: true,
				});
			}
		} else {
			dialogSignal = signal;
		}
		let timeoutStartedMs = Date.now();
		let timeoutId: unknown;
		const armFallbackTimeout = (durationMs: number) => {
			if (timeoutId !== undefined) timers().clearTimeout(timeoutId);
			timeoutStartedMs = Date.now();
			timeoutId = timers().setTimeout(() => {
				timeoutTriggered = true;
				timeoutController?.abort();
			}, durationMs);
		};
		const dialogOptions = {
			initialIndex,
			timeout: timeoutMs,
			signal: dialogSignal,
		};
		try {
			const runSelect = () => ui.select(prompt, optionsToShow, dialogOptions);
			if (timeoutMs !== undefined) armFallbackTimeout(timeoutMs);
			const choice = dialogSignal
				? await untilAborted(dialogSignal, runSelect)
				: await runSelect();
			if (
				!timeoutTriggered &&
				choice === undefined &&
				typeof timeout === "number"
			) {
				// UI surfaces that enforce `timeout` without invoking a timeout
				// callback resolve `undefined` right at the deadline. A cancel
				// arriving well past the deadline is a deliberate user Esc.
				const elapsed = Date.now() - timeoutStartedMs;
				timeoutTriggered =
					elapsed >= timeout &&
					elapsed <= timeout + TIMEOUT_DETECTION_TOLERANCE_MS;
			}
			return {
				choice,
				timedOut: timeoutTriggered,
				navigation: navigationAction,
			};
		} catch (error) {
			if (
				timeoutTriggered &&
				error instanceof Error &&
				error.name === "AbortError"
			) {
				return {
					choice: undefined,
					timedOut: true,
					navigation: navigationAction,
				};
			}
			throw error;
		} finally {
			if (timeoutId !== undefined) timers().clearTimeout(timeoutId);
		}
	};

	const promptForCustomInput = async (
		title: string,
	): Promise<{ input: string | undefined }> => {
		const dialogOptions = signal ? { signal } : undefined;
		const showCustomInput = () => ui.editor(title, undefined, dialogOptions);
		const input = signal
			? await untilAborted(signal, showCustomInput)
			: await showCustomInput();
		return { input };
	};

	const promptWithProgress = navigation?.progressText
		? `${question} (${navigation.progressText})`
		: question;
	if (multi) {
		const selected = new Set<string>(selectedOptions);
		let cursorIndex = Math.min(
			Math.max(recommended ?? 0, 0),
			Math.max(questionOptions.length - 1, 0),
		);
		const firstSelected = selectedOptions[0];
		if (firstSelected) {
			const selectedIndex = questionOptions.findIndex(
				(option) => option.label === firstSelected,
			);
			if (selectedIndex >= 0) cursorIndex = selectedIndex;
		}
		while (true) {
			const opts: string[] = questionOptions.map((option) => option.label);
			if (!navigation?.allowForward && selected.size > 0) {
				opts.push(doneLabel);
			}
			opts.push(OTHER_OPTION);

			const prefix = selected.size > 0 ? `(${selected.size} selected) ` : "";
			const { choice, timedOut: selectTimedOut } = await selectOption(
				`${prefix}${promptWithProgress}`,
				opts,
				cursorIndex,
			);

			if (choice === undefined) {
				if (selectTimedOut) {
					timedOut = true;
					break;
				}
				return {
					selectedOptions: Array.from(selected),
					customInput,
					note,
					timedOut,
					cancelled: true,
				};
			}
			if (choice === doneLabel) break;
			if (choice === OTHER_OPTION) {
				if (selectTimedOut) {
					timedOut = true;
					break;
				}
				const customResult = await promptForCustomInput(
					`${prefix}${promptWithProgress}`,
				);
				if (customResult.input === undefined) {
					continue;
				}
				customInput = customResult.input;
				break;
			}
			const selectedIdx = opts.indexOf(choice);
			if (selectedIdx >= 0) cursorIndex = selectedIdx;
			if (selected.has(choice)) {
				selected.delete(choice);
			} else {
				selected.add(choice);
			}
			if (selectTimedOut) {
				timedOut = true;
				break;
			}
		}
		selectedOptions = Array.from(selected);
	} else {
		while (true) {
			const displayOptions = addRecommendedSuffix(
				questionOptions,
				recommended,
			).map((option) => option.label);
			const optionsWithNavigation: string[] = [...displayOptions, OTHER_OPTION];

			let initialIndex = recommended;
			const previouslySelected = selectedOptions[0];
			if (previouslySelected) {
				const selectedIndex = questionOptions.findIndex(
					(option) => option.label === previouslySelected,
				);
				if (selectedIndex >= 0) initialIndex = selectedIndex;
			} else if (customInput !== undefined) {
				initialIndex = displayOptions.length;
			}
			if (initialIndex !== undefined) {
				const maxIndex = Math.max(optionsWithNavigation.length - 1, 0);
				initialIndex = Math.max(0, Math.min(initialIndex, maxIndex));
			}

			const { choice, timedOut: selectTimedOut } = await selectOption(
				promptWithProgress,
				optionsWithNavigation,
				initialIndex,
			);
			timedOut = selectTimedOut;

			if (choice === undefined) {
				if (!timedOut) {
					return {
						selectedOptions,
						customInput,
						note,
						timedOut,
						cancelled: true,
					};
				}
				break;
			}
			if (choice === OTHER_OPTION) {
				if (selectTimedOut) {
					break;
				}
				const customResult = await promptForCustomInput(promptWithProgress);
				if (customResult.input === undefined) {
					continue;
				}
				customInput = customResult.input;
				selectedOptions = [];
				break;
			}
			selectedOptions = [stripRecommendedSuffix(choice)];
			customInput = undefined;
			break;
		}
	}

	if (timedOut && selectedOptions.length === 0 && customInput === undefined) {
		selectedOptions = getAutoSelectionOnTimeout(questionOptions, recommended);
	}
	return { selectedOptions, customInput, note, timedOut };
}

/**
 * Resolve `promise` against `signal`: when the signal aborts first, the
 * returned promise rejects with an `AbortError`-named error. Port of omp's
 * `untilAborted` (pi-utils), kept local because pi has no equivalent export.
 */
export async function untilAborted<T>(
	signal: AbortLike,
	promise: () => Promise<T>,
): Promise<T> {
	if (signal.aborted) throw abortError();
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => {
			signal.removeEventListener("abort", onAbort);
			reject(abortError());
		};
		signal.addEventListener("abort", onAbort, { once: true });
		promise().then(
			(value) => {
				signal.removeEventListener("abort", onAbort);
				resolve(value);
			},
			(error) => {
				signal.removeEventListener("abort", onAbort);
				reject(error);
			},
		);
	});
}
