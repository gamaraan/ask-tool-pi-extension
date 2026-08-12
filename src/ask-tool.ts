/**
 * The ask tool: ToolDefinition wiring, three-path execute dispatch, and the
 * transcript renderers.
 *
 * Paths (port of omp `packages/coding-agent/src/tools/ask.ts` §3 of the plan):
 *  - Path A (TUI): rich multi-question dialog via `ctx.ui.custom(...)`.
 *  - Path B (RPC): per-question `select`/`editor`/`confirm` loop.
 *  - Path C (headless): error result, never throws, never opens a dialog.
 */
import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionContext,
	Theme,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { resolveAskConfig } from "./config.ts";
import { ASK_TOOL_DESCRIPTION } from "./description.ts";
import { AskDialogComponent } from "./dialog/ask-dialog-component.ts";
import { bottomBorder, divider, fit, row, topBorder } from "./dialog/chrome.ts";
import {
	formatQuestionResult,
	formatSingleQuestionResponse,
	stripRecommendedSuffix,
} from "./format.ts";
import { askQuestionsViaSimpleRpc } from "./rpc-fallback.ts";
import { AskParamsSchema, validateAskParams } from "./schema.ts";
import type {
	AskDialogSubmitResult,
	AskToolDetails,
	AskToolInput,
	QuestionResult,
} from "./types.ts";

/** Define the ask tool, bound to the pi API for flag access. */
export function defineAskTool(
	pi: ExtensionAPI,
): ToolDefinition<typeof AskParamsSchema, AskToolDetails> {
	return {
		name: "ask",
		label: "Ask",
		description: ASK_TOOL_DESCRIPTION,
		parameters: AskParamsSchema,
		executionMode: "sequential",

		prepareArguments(args: unknown): AskToolInput {
			return validateAskParams(args);
		},

		async execute(
			_toolCallId: string,
			params: AskToolInput,
			signal: AbortSignal | undefined,
			_onUpdate: undefined,
			ctx: ExtensionContext,
		): Promise<AgentToolResult<AskToolDetails>> {
			// Path C — headless/print: error result, no throw, no dialog.
			if (!ctx.hasUI) {
				return {
					content: [
						{ type: "text", text: "Error: Ask tool requires interactive mode" },
					],
					details: {},
				};
			}

			const config = resolveAskConfig((name) => pi.getFlag(name));
			const timeoutMs = config.timeoutMs;

			if (config.notify) {
				ctx.ui.notify("Ask tool is waiting for input", "info");
			}

			if (ctx.mode === "tui") {
				return executeRichDialog(ctx, params, signal, timeoutMs);
			}
			return executeRpcFallback(ctx, params, signal, timeoutMs);
		},

		renderCall(args: AskToolInput, theme: Theme): Component {
			return renderAskCall(args, theme);
		},

		renderResult(
			result: AgentToolResult<AskToolDetails>,
			_options: unknown,
			theme: Theme,
		): Component {
			return renderAskResult(result, theme);
		},
	};
}

/** Widget key under which the ask dialog is mounted (TUI Path A). */
const ASK_WIDGET_KEY = "ask";

/**
 * The currently focused component of a TUI. `getFocusedComponent` exists on
 * the concrete TUI classes but not on the public `TUI` interface.
 */
function focusedComponentOf(tui: TUI): Component | null {
	return (
		tui as unknown as { getFocusedComponent(): Component | null }
	).getFocusedComponent();
}

async function executeRichDialog(
	ctx: ExtensionContext,
	params: AskToolInput,
	signal: AbortSignal | undefined,
	timeoutMs: number,
): Promise<AgentToolResult<AskToolDetails>> {
	const questions = params.questions.map((question) => ({
		id: question.id,
		question: question.question,
		...(question.header?.trim() ? { header: question.header } : {}),
		options: question.options.map((option) => ({
			label: option.label,
			...(option.description?.trim()
				? { description: option.description.trim() }
				: {}),
			...(option.preview?.trim() ? { preview: option.preview } : {}),
		})),
		...(question.multi !== undefined ? { multi: question.multi } : {}),
		...(question.recommended !== undefined
			? { recommended: question.recommended }
			: {}),
	}));

	// The dialog is presented in the extension widget slot (above the prompt
	// editor, below the transcript) instead of a screen-covering overlay: the
	// conversation stays visible while the user answers. The widget factory
	// grabs keyboard focus for the dialog (widgets are passive by default) and
	// restores it to whatever was focused before on completion.
	const result = await new Promise<AskDialogSubmitResult | null>((resolve) => {
		ctx.ui.setWidget(
			ASK_WIDGET_KEY,
			(tui, theme) => {
				const previousFocus = focusedComponentOf(tui);
				let settled = false;
				const onAbort = (): void => {
					cleanup();
					resolve(null);
				};
				const cleanup = (): void => {
					if (settled) return;
					settled = true;
					signal?.removeEventListener("abort", onAbort);
					ctx.ui.setWidget(ASK_WIDGET_KEY, undefined);
					if (previousFocus) tui.setFocus(previousFocus);
				};
				signal?.addEventListener("abort", onAbort, { once: true });
				const component = new AskDialogComponent(
					questions,
					{
						onSubmit: (submit) => {
							cleanup();
							resolve(submit);
						},
						onCancel: () => {
							cleanup();
							resolve(null);
						},
					},
					{
						timeout: timeoutMs > 0 ? timeoutMs : undefined,
						tui,
						theme,
					},
				);
				tui.setFocus(component);
				return component;
			},
			{ placement: "aboveEditor" },
		);
	});
	if (result === null) {
		ctx.abort();
		return cancelledResult();
	}

	const richResult = result;
	if (richResult.kind === "chat") {
		const questionText = params.questions
			.map((question) => question.question)
			.join("\n");
		return {
			content: [
				{
					type: "text",
					text: `User chose to chat about this instead of answering.\n\nQuestions asked:\n${questionText}`,
				},
			],
			details: {
				chatRedirect: true,
				questions: params.questions.map((question) => question.question),
			},
		};
	}
	if (richResult.results.length !== params.questions.length) {
		return errorResult(
			"Ask dialog returned a result count that does not match the requested questions",
		);
	}
	const results: QuestionResult[] = [];
	for (let index = 0; index < params.questions.length; index++) {
		const question = params.questions[index];
		const item = richResult.results[index];
		if (!question || !item || item.id !== question.id) {
			return errorResult(
				"Ask dialog returned results that do not match the requested question order",
			);
		}
		results.push({
			id: question.id,
			question: question.question,
			options: question.options.map((option) => option.label),
			multi: question.multi ?? false,
			selectedOptions: item.selectedOptions,
			customInput: item.customInput,
			note: item.note,
			timedOut: item.timedOut,
		});
	}
	return buildToolResult(params, results);
}

async function executeRpcFallback(
	ctx: ExtensionContext,
	params: AskToolInput,
	signal: AbortSignal | undefined,
	timeoutMs: number,
): Promise<AgentToolResult<AskToolDetails>> {
	const outcome = await askQuestionsViaSimpleRpc(
		{
			select: (title, options, opts) =>
				ctx.ui.select(title, options, opts as never),
			input: (title, placeholder, opts) =>
				ctx.ui.input(title, placeholder, opts as never),
			confirm: (title, message, opts) =>
				ctx.ui.confirm(title, message, opts as never),
			editor: (title, prefill) => ctx.ui.editor(title, prefill),
		},
		params.questions,
		{ timeoutMs, signal: signal as never },
	);
	if (outcome.cancelled === true || !outcome.results) {
		ctx.abort();
		return cancelledResult();
	}
	return buildToolResult(params, outcome.results);
}

function buildToolResult(
	params: AskToolInput,
	results: QuestionResult[],
): AgentToolResult<AskToolDetails> {
	if (params.questions.length === 1) {
		const result = results[0];
		if (!result) return errorResult("Ask tool produced no result");
		if (
			!result.timedOut &&
			result.selectedOptions.length === 0 &&
			result.customInput === undefined
		) {
			return cancelledResult();
		}
		const details: AskToolDetails = {
			question: result.question,
			options: result.options,
			multi: result.multi,
			selectedOptions: result.selectedOptions,
			customInput: result.customInput,
			note: result.note,
			timedOut: result.timedOut,
		};
		const responseText = formatSingleQuestionResponse(result);
		return { content: [{ type: "text", text: responseText }], details };
	}
	const details: AskToolDetails = { results };
	const responseText = `User answers:\n${results.map(formatQuestionResult).join("\n")}`;
	return { content: [{ type: "text", text: responseText }], details };
}

function cancelledResult(): AgentToolResult<AskToolDetails> {
	return {
		content: [{ type: "text", text: "User cancelled the selection" }],
		details: {},
	};
}

function errorResult(text: string): AgentToolResult<AskToolDetails> {
	return {
		content: [{ type: "text", text: `Error: ${text}` }],
		details: {},
	};
}

// =============================================================================
// Renderers
// =============================================================================

interface RenderOption {
	label: string;
	description?: string;
}

interface RenderQuestion {
	id: string;
	question: string;
	options: RenderOption[];
	multi?: boolean;
}

/** Coerce untrusted option args (streamed/model-mangled) into render options. */
function normalizeRenderOptions(raw: unknown): RenderOption[] | undefined {
	if (!Array.isArray(raw)) return undefined;
	const out: RenderOption[] = [];
	for (const entry of raw) {
		if (typeof entry === "string") {
			out.push({ label: entry });
			continue;
		}
		if (!entry || typeof entry !== "object") continue;
		const { label, description } = entry as Partial<RenderOption>;
		if (typeof label !== "string") continue;
		out.push(
			typeof description === "string" ? { label, description } : { label },
		);
	}
	return out;
}

/** Coerce untrusted `questions` args into a renderable array. */
function normalizeRenderQuestions(raw: unknown): RenderQuestion[] | undefined {
	if (typeof raw === "string") {
		try {
			raw = JSON.parse(raw);
		} catch {
			return undefined;
		}
	}
	if (!Array.isArray(raw)) return undefined;
	const out: RenderQuestion[] = [];
	for (const entry of raw) {
		if (!entry || typeof entry !== "object") continue;
		const q = entry as Partial<RenderQuestion>;
		out.push({
			id: typeof q.id === "string" ? q.id : "?",
			question: typeof q.question === "string" ? q.question : "",
			options: normalizeRenderOptions(q.options) ?? [],
			multi: q.multi === true,
		});
	}
	return out;
}

function markerGlyph(multi: boolean | undefined, selected: boolean): string {
	if (multi) return selected ? "☑" : "☐";
	return selected ? "◉" : "○";
}

/** A component that draws a framed block: title, divider, sections, border. */
function framedBlock(
	theme: Theme,
	title: string,
	sections: Array<{ label?: string; lines: string[] }>,
	status: "pending" | "success" | "warning" | "error",
): Component {
	const headerColor =
		status === "error" ? "error" : status === "warning" ? "warning" : "accent";
	return {
		render(width: number): string[] {
			const innerWidth = Math.max(1, width - 4);
			const out: string[] = [topBorder(theme, width, title)];
			for (let index = 0; index < sections.length; index++) {
				if (index > 0) out.push(divider(theme, width));
				const section = sections[index];
				if (!section) continue;
				if (section.label) {
					out.push(row(theme, theme.fg("dim", section.label), width));
				}
				for (const line of section.lines) {
					out.push(row(theme, fit(line, innerWidth), width));
				}
			}
			out.push(divider(theme, width));
			out.push(
				row(
					theme,
					theme.fg(
						headerColor,
						status === "pending" ? "waiting for user input…" : "",
					),
					width,
				),
			);
			out.push(bottomBorder(theme, width));
			return out;
		},
		invalidate() {
			// Stateless render.
		},
		handleInput() {
			// Read-only renderer; no input handling.
		},
	};
}

function renderOptionLines(
	theme: Theme,
	options: RenderOption[],
	multi: boolean | undefined,
	selectedLabels: ReadonlySet<string> | undefined,
): string[] {
	const out: string[] = [];
	for (const option of options) {
		const isSelected = selectedLabels?.has(option.label) ?? false;
		const label = isSelected
			? theme.fg("success", option.label)
			: theme.fg("text", option.label);
		const glyph = markerGlyph(multi, isSelected);
		out.push(` ${theme.fg(isSelected ? "success" : "dim", glyph)} ${label}`);
		if (option.description?.trim()) {
			out.push(`   ${theme.fg("dim", `↳ ${option.description.trim()}`)}`);
		}
	}
	return out;
}

function renderAskCall(args: unknown, theme: Theme): Component {
	const questions = normalizeRenderQuestions(
		(args as { questions?: unknown } | null)?.questions,
	);
	if (questions && questions.length > 0) {
		const title = `Ask ${theme.fg("muted", `· ${questions.length} questions`)}`;
		const sections = questions.map((question) => ({
			label: theme.fg(
				"dim",
				`[${question.id}]${question.multi ? " · multi" : ""}`,
			),
			lines: [
				...wrapLines(question.question, 80),
				...renderOptionLines(
					theme,
					question.options,
					question.multi,
					undefined,
				),
			],
		}));
		return framedBlock(theme, title, sections, "pending");
	}

	const rawQuestion = (args as { question?: unknown } | null)?.question;
	if (typeof rawQuestion !== "string" || !rawQuestion) {
		return framedBlock(
			theme,
			theme.fg("error", "Ask — no question provided"),
			[],
			"error",
		);
	}
	const meta: string[] = [];
	if ((args as { multi?: unknown } | null)?.multi === true) meta.push("multi");
	const options = normalizeRenderOptions(
		(args as { options?: unknown } | null)?.options,
	);
	if (options?.length) meta.push(`options:${options.length}`);
	const title = `Ask${meta.length > 0 ? theme.fg("muted", ` · ${meta.join(" · ")}`) : ""}`;
	return framedBlock(
		theme,
		title,
		[
			{
				lines: [
					...wrapLines(rawQuestion, 80),
					...renderOptionLines(theme, options ?? [], undefined, undefined),
				],
			},
		],
		"pending",
	);
}

function renderAskResult(
	result: {
		content: Array<{ type: string; text?: string }>;
		details?: AskToolDetails;
	},
	theme: Theme,
): Component {
	const details = result.details;
	if (!details) {
		const text = result.content[0];
		return framedBlock(
			theme,
			"Ask",
			[{ lines: [theme.fg("dim", text?.text ?? "")] }],
			"warning",
		);
	}

	if (details.chatRedirect) {
		const questions = details.questions ?? [];
		return framedBlock(
			theme,
			theme.fg("muted", "Ask · chat redirect"),
			questions.length > 0
				? [{ lines: questions.flatMap((question) => wrapLines(question, 80)) }]
				: [],
			"warning",
		);
	}

	if (details.results && details.results.length > 0) {
		const hasAnySelection = details.results.some(
			(item) =>
				item.customInput !== undefined ||
				item.note !== undefined ||
				(item.selectedOptions && item.selectedOptions.length > 0),
		);
		const sections = details.results.map((item) => ({
			label: theme.fg("dim", `[${item.id}]`),
			lines: renderAnswerLines(theme, item),
		}));
		return framedBlock(
			theme,
			`Ask ${theme.fg("muted", `· ${details.results.length} questions`)}`,
			sections,
			hasAnySelection ? "success" : "warning",
		);
	}

	if (!details.question) {
		const text = result.content[0];
		return framedBlock(
			theme,
			"Ask",
			[{ lines: [theme.fg("dim", text?.text ?? "")] }],
			"warning",
		);
	}

	const hasSelection =
		details.customInput !== undefined ||
		details.note !== undefined ||
		(details.selectedOptions && details.selectedOptions.length > 0);
	const lines = renderAnswerLines(theme, details as QuestionResult);
	if (details.timedOut) {
		lines.push(
			theme.fg("dim", "auto-selected after timeout — not a user choice"),
		);
	}
	return framedBlock(
		theme,
		"Ask",
		[{ lines }],
		hasSelection ? "success" : "warning",
	);
}

function renderAnswerLines(theme: Theme, item: QuestionResult): string[] {
	const selected = new Set(item.selectedOptions ?? []);
	const list =
		item.options && item.options.length > 0
			? item.options
			: (item.selectedOptions ?? []);
	if (
		selected.size === 0 &&
		item.customInput === undefined &&
		item.note === undefined
	) {
		return [theme.fg("warning", "Cancelled")];
	}
	const out: string[] = [];
	for (const label of list) {
		const isSelected = selected.has(label);
		const glyph = markerGlyph(item.multi, isSelected);
		const shown = isSelected ? label : stripRecommendedSuffix(label);
		out.push(
			` ${theme.fg(isSelected ? "success" : "dim", glyph)} ${theme.fg(isSelected ? "toolOutput" : "muted", shown)}`,
		);
	}
	if (item.customInput !== undefined) {
		const lines = item.customInput.split("\n");
		out.push(
			` ${theme.fg("success", "✓")} ${theme.fg("toolOutput", lines[0] ?? "")}`,
		);
		for (let i = 1; i < lines.length; i++)
			out.push(`   ${theme.fg("toolOutput", lines[i] ?? "")}`);
	}
	if (item.note !== undefined) {
		out.push(
			` ${theme.fg("dim", "Note:")} ${theme.fg("toolOutput", item.note)}`,
		);
	}
	return out;
}

function wrapLines(text: string, width: number): string[] {
	const plain = text.replace(/\s+/g, " ").trim();
	if (visibleWidth(plain) <= width) return [plain];
	const words = plain.split(" ");
	const lines: string[] = [];
	let current = "";
	for (const word of words) {
		const candidate = current ? `${current} ${word}` : word;
		if (visibleWidth(candidate) > width && current) {
			lines.push(current);
			current = word;
		} else {
			current = candidate;
		}
	}
	if (current) lines.push(current);
	return lines.map((line) => truncateToWidth(line, Math.max(1, width), "…"));
}
