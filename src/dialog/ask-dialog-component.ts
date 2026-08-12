/**
 * Rich multi-question ask dialog (Path A — TUI).
 *
 * Port of omp `packages/coding-agent/src/modes/components/ask-dialog.ts`
 * rendered through `ctx.ui.custom(...)` with pi's `Theme` and keybindings.
 * Differences from omp, all deliberate:
 *  - Rows render with plain text (pi-tui has no `renderInlineMarkdown`).
 *  - "Other (type your own)" and notes use an inline `Editor` sub-field
 *    (pi-tui) instead of omp's modal HookEditor swap (plan decision D5).
 *  - "Chat about this" is offered as the last row (TUI-only, plan F10);
 *    omp only surfaces it to collab guests, which pi has no equivalent of.
 *  - Code preview segments are not syntax-highlighted.
 *  - Tab bar is hand-rolled (pi-tui has no TabBar component).
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	Editor,
	type EditorTheme,
	getKeybindings,
	Key,
	Markdown,
	type MarkdownTheme,
	matchesKey,
	type TUI,
	truncateToWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { OTHER_OPTION, RECOMMENDED_SUFFIX } from "../constants.ts";
import type {
	AskDialogQuestion,
	AskDialogResultItem,
	AskDialogSubmitResult,
} from "../types.ts";
import {
	bottomBorder,
	divider,
	fit,
	replaceTabs,
	row,
	topBorder,
} from "./chrome.ts";
import { CountdownTimer } from "./countdown.ts";

const CHAT_OPTION = "Chat about this";
const SUBMIT_OPTION = "Submit";

/** Fraction of the terminal the dialog may occupy. */
const DIALOG_HEIGHT_RATIO = 0.7;
const MIN_DIALOG_ROWS = 12;
const MIN_BODY_ROWS = 5;
const MAX_HEADER_CHIP_WIDTH = 16;
const MAX_HEADER_ROWS = 4;
const MAX_DESCRIPTION_ROWS = 2;

const clamp = (value: number, min: number, max: number): number =>
	Math.max(min, Math.min(value, max));

function terminalRows(): number {
	const stdout = (globalThis as { process?: { stdout?: { rows?: number } } })
		.process?.stdout;
	return stdout?.rows ?? 40;
}

export interface AskDialogCallbacks {
	onSubmit(result: AskDialogSubmitResult): void;
	onCancel(): void;
}

export interface AskDialogOptions {
	timeout?: number;
	tui?: TUI;
	theme: Theme;
}

interface QuestionState {
	selectedOptions: Set<string>;
	customInput: string | undefined;
	note: string | undefined;
	noteRowKey: string | undefined;
	cursorIndex: number;
	scrollOffset: number;
	manualScroll: boolean;
	timedOut: boolean;
}

type QuestionRowKind = "option" | "other" | "chat";

interface QuestionRow {
	kind: QuestionRowKind;
	key: string;
	label: string;
	optionIndex: number | undefined;
}

interface RenderedList {
	lines: string[];
	scrollOffset: number;
	indicator: string;
}

type EditMode = "none" | "other" | "note";

interface PreviewSegment {
	kind: "markdown" | "code";
	text: string;
}

function stripRecommendedSuffix(label: string): string {
	return label.endsWith(RECOMMENDED_SUFFIX)
		? label.slice(0, -RECOMMENDED_SUFFIX.length)
		: label;
}

function questionTabLabel(question: AskDialogQuestion, index: number): string {
	const base = question.header?.trim() || question.id || `Q${index + 1}`;
	return truncateToWidth(replaceTabs(base), MAX_HEADER_CHIP_WIDTH, "…");
}

function renderQuestionTitle(
	question: AskDialogQuestion,
	width: number,
): string[] {
	const wrapped = wrapTextWithAnsi(
		replaceTabs(question.question),
		Math.max(1, width),
	);
	if (wrapped.length <= MAX_HEADER_ROWS) return wrapped;
	return [
		...wrapped.slice(0, MAX_HEADER_ROWS - 1),
		truncateToWidth(
			wrapped.slice(MAX_HEADER_ROWS - 1).join(" "),
			Math.max(1, width),
			"…",
		),
	];
}

/** Split a preview into markdown and fenced-code segments. */
function splitPreviewSegments(preview: string): PreviewSegment[] {
	const segments: PreviewSegment[] = [];
	const markdownBuffer: string[] = [];
	let fenceChar: string | undefined;
	let fenceLength = 0;
	let codeBuffer: string[] = [];

	const flushMarkdown = (): void => {
		if (markdownBuffer.length === 0) return;
		segments.push({ kind: "markdown", text: markdownBuffer.join("\n") });
		markdownBuffer.length = 0;
	};
	const flushCode = (): void => {
		segments.push({ kind: "code", text: codeBuffer.join("\n") });
		codeBuffer = [];
		fenceChar = undefined;
		fenceLength = 0;
	};

	for (const line of replaceTabs(preview).split("\n")) {
		const fenceMatch = /^(\s{0,3})(`{3,}|~{3,})(.*)$/.exec(line);
		if (fenceChar !== undefined) {
			if (fenceMatch) {
				const marker = fenceMatch[2] ?? "";
				const info = fenceMatch[3]?.trim() ?? "";
				if (
					marker.startsWith(fenceChar) &&
					marker.length >= fenceLength &&
					info === ""
				) {
					flushCode();
					continue;
				}
			}
			codeBuffer.push(line);
			continue;
		}
		if (fenceMatch) {
			flushMarkdown();
			const marker = fenceMatch[2] ?? "";
			fenceChar = marker[0];
			fenceLength = marker.length;
			codeBuffer = [];
			continue;
		}
		markdownBuffer.push(line);
	}

	if (fenceChar !== undefined) {
		segments.push({ kind: "code", text: codeBuffer.join("\n") });
	} else {
		flushMarkdown();
	}
	return segments;
}

/** Build a MarkdownTheme from the pi Theme instance handed to the dialog. */
export function markdownThemeFrom(theme: Theme): MarkdownTheme {
	return {
		heading: (text: string) => theme.fg("mdHeading", text),
		link: (text: string) => theme.fg("mdLink", text),
		linkUrl: (text: string) => theme.fg("mdLinkUrl", text),
		code: (text: string) => theme.fg("mdCode", text),
		codeBlock: (text: string) => theme.fg("mdCodeBlock", text),
		codeBlockBorder: (text: string) => theme.fg("mdCodeBlockBorder", text),
		quote: (text: string) => theme.fg("mdQuote", text),
		quoteBorder: (text: string) => theme.fg("mdQuoteBorder", text),
		hr: (text: string) => theme.fg("mdHr", text),
		listBullet: (text: string) => theme.fg("mdListBullet", text),
		bold: (text: string) => theme.bold(text),
		italic: (text: string) => theme.italic(text),
		underline: (text: string) => theme.underline(text),
		strikethrough: (text: string) => theme.strikethrough(text),
		highlightCode: (code: string) =>
			code.split("\n").map((line) => theme.fg("mdCodeBlock", line)),
	};
}

function renderPreviewContent(
	theme: Theme,
	preview: string,
	width: number,
): string[] {
	const out: string[] = [];
	const mdTheme = markdownThemeFrom(theme);
	const accentStyle = { color: (text: string) => theme.fg("muted", text) };
	for (const segment of splitPreviewSegments(preview)) {
		if (segment.kind === "code") {
			for (const line of segment.text.split("\n")) {
				out.push(theme.fg("mdCodeBlock", line));
			}
			continue;
		}
		const markdown = new Markdown(segment.text, 0, 0, mdTheme, accentStyle);
		out.push(...markdown.render(Math.max(1, width)));
	}
	return out;
}

function renderAnswerSummary(
	question: AskDialogQuestion,
	state: QuestionState,
	theme: Theme,
): string {
	const selected = question.options
		.map((option) => option.label)
		.filter((label) => state.selectedOptions.has(label));
	if (question.multi) {
		const answers = [...selected];
		if (state.customInput !== undefined)
			answers.push(`Other: “${state.customInput.replace(/\s+/g, " ").trim()}”`);
		return answers.length > 0
			? answers.join(", ")
			: theme.fg("warning", "unanswered");
	}
	if (state.customInput !== undefined)
		return `“${state.customInput.replace(/\s+/g, " ").trim()}”`;
	if (selected.length === 0) return theme.fg("warning", "unanswered");
	return selected[0] ?? theme.fg("warning", "unanswered");
}

function clearNote(state: QuestionState): void {
	state.note = undefined;
	state.noteRowKey = undefined;
}

function clearNoteIfRow(state: QuestionState, rowKey: string): void {
	if (state.noteRowKey === rowKey) clearNote(state);
}

function clearNoteUnlessRow(state: QuestionState, rowKey: string): void {
	if (state.noteRowKey !== undefined && state.noteRowKey !== rowKey)
		clearNote(state);
}

function noteForSubmittedAnswer(
	question: AskDialogQuestion,
	state: QuestionState,
): string | undefined {
	if (state.note === undefined || state.noteRowKey === undefined)
		return undefined;
	if (state.noteRowKey === "other")
		return state.customInput !== undefined ? state.note : undefined;
	const match = /^option:(\d+)$/.exec(state.noteRowKey);
	const optionIndex =
		match?.[1] === undefined ? Number.NaN : Number.parseInt(match[1], 10);
	const option = Number.isInteger(optionIndex)
		? question.options[optionIndex]
		: undefined;
	return option && state.selectedOptions.has(option.label)
		? state.note
		: undefined;
}

function optionMarker(
	question: AskDialogQuestion,
	theme: Theme,
	checked: boolean,
): string {
	const glyph = question.multi ? (checked ? "☑" : "☐") : checked ? "◉" : "○";
	return theme.fg(checked ? "success" : "dim", glyph);
}

/**
 * Coerce untrusted dialog questions into a render-safe shape (streamed or
 * model-mangled entries must not take down the render loop).
 */
function normalizeDialogQuestions(
	questions: AskDialogQuestion[],
): AskDialogQuestion[] {
	if (!Array.isArray(questions)) return [];
	const out: AskDialogQuestion[] = [];
	for (const entry of questions) {
		if (!entry || typeof entry !== "object") continue;
		const q = entry as Partial<AskDialogQuestion>;
		const options: AskDialogQuestion["options"] = [];
		if (Array.isArray(q.options)) {
			for (const opt of q.options) {
				if (!opt || typeof opt !== "object") continue;
				const o = opt as Partial<AskDialogQuestion["options"][number]>;
				options.push({
					label: typeof o.label === "string" ? o.label : "",
					...(typeof o.description === "string"
						? { description: o.description }
						: {}),
					...(typeof o.preview === "string" ? { preview: o.preview } : {}),
				});
			}
		}
		out.push({
			id: typeof q.id === "string" ? q.id : "?",
			question: typeof q.question === "string" ? q.question : "",
			...(typeof q.header === "string" ? { header: q.header } : {}),
			options,
			...(typeof q.multi === "boolean" ? { multi: q.multi } : {}),
			...(Number.isInteger(q.recommended)
				? { recommended: q.recommended }
				: {}),
		});
	}
	return out;
}

export class AskDialogComponent implements Component {
	private readonly states: QuestionState[];
	private activeTabIndex = 0;
	private submitScrollOffset = 0;
	private bodyRows = MIN_BODY_ROWS;
	private questionCanPage = false;
	private remainingSeconds: number | undefined;
	private countdown: CountdownTimer | undefined;
	private editMode: EditMode = "none";
	private editNoteRowKey: string | undefined;
	private readonly editor: Editor;
	private timeoutExpired = false;
	private closed = false;
	private stableHeight: { key: string; total: number } | undefined;
	private readonly previewCache = new Map<
		string,
		Map<number, readonly string[]>
	>();
	private readonly overflowLayouts = new WeakMap<
		AskDialogQuestion,
		Set<string>
	>();
	private readonly questions: AskDialogQuestion[];
	private readonly callbacks: AskDialogCallbacks;
	private readonly theme: Theme;
	private readonly tui: TUI | undefined;

	constructor(
		questions: AskDialogQuestion[],
		callbacks: AskDialogCallbacks,
		options: AskDialogOptions,
	) {
		this.questions = normalizeDialogQuestions(questions);
		this.callbacks = callbacks;
		this.theme = options.theme;
		this.tui = options.tui;
		this.states = this.questions.map((question) => {
			const recommended = Number.isInteger(question.recommended)
				? (question.recommended ?? 0)
				: 0;
			const maxIndex = Math.max(0, question.options.length - 1);
			return {
				selectedOptions: new Set<string>(),
				customInput: undefined,
				note: undefined,
				noteRowKey: undefined,
				cursorIndex: clamp(recommended, 0, maxIndex),
				scrollOffset: 0,
				manualScroll: false,
				timedOut: false,
			};
		});
		const editorTheme: EditorTheme = {
			borderColor: (text: string) => this.theme.fg("accent", text),
			selectList: {
				selectedPrefix: (text: string) => this.theme.fg("accent", text),
				selectedText: (text: string) => this.theme.fg("accent", text),
				description: (text: string) => this.theme.fg("muted", text),
				scrollInfo: (text: string) => this.theme.fg("dim", text),
				noMatch: (text: string) => this.theme.fg("warning", text),
			},
		};
		this.editor = new Editor(this.tui ?? ({} as TUI), editorTheme);
		this.editor.onSubmit = (value: string) => this.handleEditorSubmit(value);
		if (options.timeout !== undefined && options.timeout > 0) {
			this.countdown = new CountdownTimer(
				options.timeout,
				this.tui,
				(seconds) => {
					this.remainingSeconds = seconds;
				},
				() => this.handleTimeout(),
			);
		}
	}

	invalidate(): void {
		this.stableHeight = undefined;
		this.previewCache.clear();
	}

	dispose(): void {
		this.closed = true;
		this.countdown?.dispose();
	}

	handleInput(keyData: string): void {
		if (this.closed) return;
		this.countdown?.reset();
		if (this.editMode !== "none") {
			this.handleEditInput(keyData);
			return;
		}
		const kb = getKeybindings();
		if (kb.matches(keyData, "tui.select.cancel")) {
			this.finishCancel();
			return;
		}
		if (this.hasSubmitTab() && this.handleTabSwitchKey(keyData)) {
			this.requestRender();
			return;
		}
		if (this.isSubmitTab()) {
			this.handleSubmitTabInput(keyData);
			return;
		}
		this.handleQuestionInput(keyData);
	}

	render(width: number): string[] {
		const innerWidth = Math.max(1, width - 4);
		const totalRows = this.dialogHeight(innerWidth, terminalRows());
		const headerLines = this.renderHeader(innerWidth);
		const fixedRows = 1 + headerLines.length + 1 + 1 + 1 + 1;
		const bodyRows = Math.max(MIN_BODY_ROWS, totalRows - fixedRows);
		this.bodyRows = bodyRows;
		const bodyLines = this.isSubmitTab()
			? this.renderSubmitBody(innerWidth, bodyRows)
			: this.renderQuestionBody(innerWidth, bodyRows);
		const footer = this.footerHintText(bodyLines.indicator);
		return [
			topBorder(this.theme, width, this.titleText()),
			...headerLines.map((line) => row(this.theme, line, width)),
			divider(this.theme, width),
			...bodyLines.lines.map((line) => row(this.theme, line, width)),
			divider(this.theme, width),
			row(this.theme, this.theme.fg("dim", footer), width),
			bottomBorder(this.theme, width),
		];
	}

	private dialogHeight(width: number, termRows: number): number {
		const key = `${width}:${termRows}`;
		if (this.stableHeight?.key === key) return this.stableHeight.total;
		const total = this.measureHeight(width, termRows);
		this.stableHeight = { key, total };
		return total;
	}

	private measureHeight(width: number, termRows: number): number {
		const maxHeight = Math.max(
			MIN_DIALOG_ROWS,
			Math.floor(termRows * DIALOG_HEIGHT_RATIO),
		);
		const chrome = 5;
		const tabBarRows = this.hasSubmitTab() ? 1 : 0;
		let needed = MIN_DIALOG_ROWS;
		for (let index = 0; index < this.questions.length; index++) {
			const question = this.questions[index];
			const state = this.states[index];
			if (!question || !state) continue;
			const headerRows =
				tabBarRows + renderQuestionTitle(question, width).length;
			const listRows = this.questionRows(question).reduce(
				(total, rowItem) =>
					total +
					this.renderRowLabel(rowItem, question, state, false, width).length,
				0,
			);
			needed = Math.max(
				needed,
				chrome + headerRows + Math.max(MIN_BODY_ROWS, listRows),
			);
		}
		if (this.hasSubmitTab()) {
			const body = 2 + this.questions.length + 2;
			needed = Math.max(
				needed,
				chrome + tabBarRows + 1 + Math.max(MIN_BODY_ROWS, body),
			);
		}
		return Math.min(needed, maxHeight);
	}

	private titleText(): string {
		return this.remainingSeconds === undefined
			? "Ask"
			: `Ask (${this.remainingSeconds}s)`;
	}

	private hasSubmitTab(): boolean {
		return (
			this.questions.length > 1 ||
			this.questions.some((question) => question.multi === true)
		);
	}

	private submitTabIndex(): number {
		return this.questions.length;
	}

	private isSubmitTab(): boolean {
		return this.hasSubmitTab() && this.activeTabIndex === this.submitTabIndex();
	}

	private currentQuestionIndex(): number {
		return clamp(
			this.activeTabIndex,
			0,
			Math.max(0, this.questions.length - 1),
		);
	}

	private requestRender(): void {
		this.tui?.requestRender();
	}

	private renderHeader(width: number): string[] {
		const lines: string[] = [];
		if (this.hasSubmitTab()) {
			lines.push(this.renderTabBar(width));
		}
		if (this.isSubmitTab()) {
			lines.push(this.theme.bold(this.theme.fg("accent", "Review answers")));
			return lines;
		}
		const questionIndex = this.currentQuestionIndex();
		const question = this.questions[questionIndex];
		if (!question) return lines;
		lines.push(...renderQuestionTitle(question, width));
		return lines;
	}

	private renderTabBar(width: number): string {
		const tabs: Array<{ label: string; active: boolean }> = this.questions.map(
			(question, index) => ({
				label: questionTabLabel(question, index),
				active: index === this.activeTabIndex,
			}),
		);
		if (this.hasSubmitTab()) {
			tabs.push({ label: SUBMIT_OPTION, active: this.isSubmitTab() });
		}
		const parts = tabs.map((tab, index) => {
			const text = `${index + 1}. ${tab.label}`;
			if (tab.active) {
				return this.theme.bold(this.theme.fg("accent", ` ${text} `));
			}
			return this.theme.fg("dim", ` ${text} `);
		});
		return truncateToWidth(
			parts.join(this.theme.fg("border", "│")),
			Math.max(1, width),
			"…",
		);
	}

	private footerHintText(indicator: string): string {
		const cancel = "Esc cancel";
		if (this.isSubmitTab()) {
			const scroll = indicator ? ` ${indicator} scroll ·` : "";
			return `Enter submit · ↑/↓ scroll ·${scroll} ${cancel}`;
		}
		const question = this.questions[this.currentQuestionIndex()];
		const action =
			question?.multi === true
				? "Space/Enter toggle · n note"
				: "Enter select · n note";
		const tabs = this.hasSubmitTab() ? " · Tab/←/→" : "";
		if (this.questionCanPage && indicator) {
			return `${action} · ↑/↓${tabs} · ${cancel} · PgUp/PgDn ${indicator}`;
		}
		const scroll = indicator ? ` ${indicator} scroll ·` : "";
		return `${action} · ↑/↓ move${tabs} ·${scroll} ${cancel}`;
	}

	private questionRows(question: AskDialogQuestion): QuestionRow[] {
		const rows: QuestionRow[] = question.options.map((option, index) => ({
			kind: "option",
			key: `option:${index}`,
			label: this.optionLabel(question, option.label, index),
			optionIndex: index,
		}));
		rows.push({
			kind: "other",
			key: "other",
			label: OTHER_OPTION,
			optionIndex: undefined,
		});
		rows.push({
			kind: "chat",
			key: "chat",
			label: CHAT_OPTION,
			optionIndex: undefined,
		});
		return rows;
	}

	private optionLabel(
		question: AskDialogQuestion,
		label: string,
		index: number,
	): string {
		return question.recommended === index
			? `${label}${RECOMMENDED_SUFFIX}`
			: label;
	}

	private activeQuestionState():
		| { question: AskDialogQuestion; state: QuestionState }
		| undefined {
		const question = this.questions[this.currentQuestionIndex()];
		const state = this.states[this.currentQuestionIndex()];
		if (!question || !state) return undefined;
		return { question, state };
	}

	private handleEditInput(keyData: string): void {
		if (matchesKey(keyData, Key.escape)) {
			this.editMode = "none";
			this.editNoteRowKey = undefined;
			this.editor.setText("");
			this.runDeferredTimeout();
			this.requestRender();
			return;
		}
		this.editor.handleInput(keyData);
		this.requestRender();
	}

	private handleEditorSubmit(value: string): void {
		const active = this.activeQuestionState();
		if (!active) {
			this.editMode = "none";
			return;
		}
		const { question, state } = active;
		if (this.editMode === "other") {
			const trimmed = value.trim();
			if (trimmed === "") {
				state.customInput = undefined;
				clearNoteIfRow(state, "other");
			} else {
				state.customInput = value;
				if (!question.multi) {
					state.selectedOptions.clear();
					clearNoteUnlessRow(state, "other");
				}
			}
			this.editMode = "none";
			this.editor.setText("");
			if (!question.multi && trimmed !== "") {
				this.advanceAfterQuestion();
				return;
			}
			this.runDeferredTimeout();
			this.requestRender();
			return;
		}
		if (this.editMode === "note") {
			state.note = value;
			state.noteRowKey = this.editNoteRowKey;
			this.editMode = "none";
			this.editNoteRowKey = undefined;
			this.editor.setText("");
			this.runDeferredTimeout();
			this.requestRender();
			return;
		}
		this.editMode = "none";
		this.runDeferredTimeout();
		this.requestRender();
	}

	private handleQuestionInput(keyData: string): void {
		const active = this.activeQuestionState();
		if (!active) return;
		const { question, state } = active;
		const rows = this.questionRows(question);
		const kb = getKeybindings();
		if (kb.matches(keyData, "tui.select.pageUp")) {
			state.scrollOffset = Math.max(
				0,
				state.scrollOffset - Math.max(1, this.bodyRows - 1),
			);
			state.manualScroll = true;
			this.requestRender();
			return;
		}
		if (kb.matches(keyData, "tui.select.pageDown")) {
			state.scrollOffset += Math.max(1, this.bodyRows - 1);
			state.manualScroll = true;
			this.requestRender();
			return;
		}
		if (kb.matches(keyData, "tui.select.up")) {
			state.cursorIndex = clamp(
				state.cursorIndex - 1,
				0,
				Math.max(0, rows.length - 1),
			);
			state.manualScroll = false;
			this.requestRender();
			return;
		}
		if (kb.matches(keyData, "tui.select.down")) {
			state.cursorIndex = clamp(
				state.cursorIndex + 1,
				0,
				Math.max(0, rows.length - 1),
			);
			state.manualScroll = false;
			this.requestRender();
			return;
		}
		const rowItem = rows[state.cursorIndex];
		if (!rowItem) return;
		if (keyData === "n" || keyData === "N") {
			if (rowItem.kind === "option" || rowItem.kind === "other") {
				this.enterNoteEdit(state, rowItem);
			}
			return;
		}
		const isEnter =
			matchesKey(keyData, Key.enter) ||
			matchesKey(keyData, Key.return) ||
			keyData === "\n";
		const isSpace = matchesKey(keyData, Key.space) || keyData === " ";
		if (!isEnter && !(question.multi === true && isSpace)) return;
		if (rowItem.kind === "chat") {
			this.finishChat();
			return;
		}
		if (rowItem.kind === "other") {
			this.enterOtherEdit(state);
			return;
		}
		const option = question.options[rowItem.optionIndex ?? -1];
		if (!option) return;
		if (question.multi) {
			if (state.selectedOptions.has(option.label)) {
				state.selectedOptions.delete(option.label);
				clearNoteIfRow(state, rowItem.key);
			} else {
				state.selectedOptions.add(option.label);
			}
			this.requestRender();
			return;
		}
		state.selectedOptions = new Set([option.label]);
		state.customInput = undefined;
		clearNoteUnlessRow(state, rowItem.key);
		this.advanceAfterQuestion();
	}

	private enterOtherEdit(state: QuestionState): void {
		this.editMode = "other";
		this.editNoteRowKey = undefined;
		this.editor.setText(state.customInput ?? "");
		this.requestRender();
	}

	private enterNoteEdit(state: QuestionState, rowItem: QuestionRow): void {
		this.editMode = "note";
		this.editNoteRowKey = rowItem.key;
		this.editor.setText(
			state.noteRowKey === rowItem.key ? (state.note ?? "") : "",
		);
		this.requestRender();
	}

	private handleSubmitTabInput(keyData: string): void {
		const kb = getKeybindings();
		if (kb.matches(keyData, "tui.select.up")) {
			this.submitScrollOffset = Math.max(0, this.submitScrollOffset - 1);
			this.requestRender();
			return;
		}
		if (kb.matches(keyData, "tui.select.down")) {
			this.submitScrollOffset += 1;
			this.requestRender();
			return;
		}
		const isEnter =
			matchesKey(keyData, Key.enter) ||
			matchesKey(keyData, Key.return) ||
			keyData === "\n";
		if (isEnter) this.finishSubmit();
	}

	private handleTabSwitchKey(keyData: string): boolean {
		if (matchesKey(keyData, Key.tab) || matchesKey(keyData, Key.right)) {
			this.switchTab(1);
			return true;
		}
		if (matchesKey(keyData, "shift+tab") || matchesKey(keyData, Key.left)) {
			this.switchTab(-1);
			return true;
		}
		return false;
	}

	private switchTab(direction: 1 | -1): void {
		const tabCount = this.questions.length + 1;
		this.activeTabIndex =
			(this.activeTabIndex + direction + tabCount) % tabCount;
		this.submitScrollOffset = 0;
	}

	private advanceAfterQuestion(): void {
		const current = this.currentQuestionIndex();
		if (this.questions.length === 1) {
			this.finishSubmit();
			return;
		}
		this.activeTabIndex =
			current + 1 < this.questions.length ? current + 1 : this.submitTabIndex();
		this.submitScrollOffset = 0;
		this.requestRender();
	}

	private renderQuestionBody(width: number, maxRows: number): RenderedList {
		const active = this.activeQuestionState();
		if (!active) return { lines: [], scrollOffset: 0, indicator: "" };
		const { question, state } = active;
		const rowItems = this.questionRows(question);
		state.cursorIndex = clamp(
			state.cursorIndex,
			0,
			Math.max(0, rowItems.length - 1),
		);
		const list = this.renderQuestionList(
			question,
			state,
			rowItems,
			width,
			maxRows,
		);
		if (this.editMode === "none") return list;
		// Inline editor for "Other" / note answers, rendered below the list.
		const editorLines = this.editor.render(Math.max(1, width - 2));
		const hint = this.theme.fg(
			"dim",
			this.editMode === "note"
				? "Enter to save note • Esc to go back"
				: "Enter to submit • Esc to go back",
		);
		const combined = [
			...list.lines,
			"",
			...editorLines.map((line) => ` ${line}`),
			hint,
		];
		return {
			lines: combined.slice(0, maxRows),
			scrollOffset: list.scrollOffset,
			indicator: "",
		};
	}

	private renderQuestionList(
		question: AskDialogQuestion,
		state: QuestionState,
		rowItems: QuestionRow[],
		width: number,
		rows: number,
	): RenderedList {
		const renderRows = (
			contentWidth: number,
		): { allLines: string[]; lineStartByRow: number[] } => {
			const allLines: string[] = [];
			const lineStartByRow: number[] = [];
			for (let index = 0; index < rowItems.length; index++) {
				lineStartByRow.push(allLines.length);
				const rowItem = rowItems[index];
				if (!rowItem) continue;
				allLines.push(
					...this.renderRowLabel(
						rowItem,
						question,
						state,
						index === state.cursorIndex,
						contentWidth,
					),
				);
			}
			return { allLines, lineStartByRow };
		};
		const layoutKey = `${width}:${rows}:${state.customInput === undefined ? 0 : 1}`;
		let overflowLayouts = this.overflowLayouts.get(question);
		const knownOverflow = overflowLayouts?.has(layoutKey) ?? false;
		let renderedRows = renderRows(
			knownOverflow && width > 1 ? width - 1 : width,
		);
		if (!knownOverflow && width > 1 && renderedRows.allLines.length > rows) {
			if (!overflowLayouts) {
				overflowLayouts = new Set();
				this.overflowLayouts.set(question, overflowLayouts);
			}
			overflowLayouts.add(layoutKey);
			renderedRows = renderRows(width - 1);
		}
		const { allLines, lineStartByRow } = renderedRows;
		const cursorStart = lineStartByRow[state.cursorIndex] ?? 0;
		const cursorEnd = lineStartByRow[state.cursorIndex + 1] ?? allLines.length;
		this.questionCanPage = cursorEnd - cursorStart > rows;
		state.scrollOffset = this.scrollOffsetForCursor(
			state.scrollOffset,
			cursorStart,
			cursorEnd,
			rows,
			allLines.length,
			state.manualScroll,
		);
		const lines = allLines.slice(state.scrollOffset, state.scrollOffset + rows);
		while (lines.length < rows) lines.push("");
		return {
			lines: lines.slice(0, rows),
			scrollOffset: state.scrollOffset,
			indicator: this.clipIndicator(state.scrollOffset, rows, allLines.length),
		};
	}

	private renderRowLabel(
		rowItem: QuestionRow,
		question: AskDialogQuestion,
		state: QuestionState,
		selected: boolean,
		width: number,
	): string[] {
		const isOption = rowItem.kind === "option";
		const isOther = rowItem.kind === "other";
		const checked = isOption
			? state.selectedOptions.has(stripRecommendedSuffix(rowItem.label))
			: isOther && state.customInput !== undefined;
		const color = selected ? "accent" : checked ? "toolOutput" : "text";
		const marker = `${optionMarker(question, this.theme, checked)} `;
		const cursor = selected ? this.theme.fg("accent", "❯ ") : "  ";
		const label = this.theme.fg(color, rowItem.label);
		const noteMarker =
			state.note !== undefined && state.noteRowKey === rowItem.key
				? this.theme.fg("success", "  ✎ note")
				: "";
		const firstLine = `${cursor}${marker}${label}${noteMarker}`;
		const lines = [truncateToWidth(firstLine, width, "…")];
		if (rowItem.kind === "option") {
			const option = question.options[rowItem.optionIndex ?? -1];
			if (option?.description?.trim()) {
				const wrapped = wrapTextWithAnsi(
					option.description.trim(),
					Math.max(1, width - 6),
				);
				for (const line of wrapped.slice(0, MAX_DESCRIPTION_ROWS)) {
					lines.push(
						`      ${truncateToWidth(line, Math.max(1, width - 6), "…")}`,
					);
				}
			}
			if (option?.preview?.trim()) {
				const previewWidth = Math.max(1, width - 8);
				lines.push(...this.renderCachedPreview(option.preview, previewWidth));
			}
		}
		if (isOther && state.customInput !== undefined) {
			const preview = replaceTabs(state.customInput)
				.replace(/\s+/g, " ")
				.trim();
			lines.push(
				this.theme.fg(
					"muted",
					`      ${truncateToWidth(preview, Math.max(1, width - 6), "…")}`,
				),
			);
		}
		return lines;
	}

	private renderCachedPreview(
		preview: string,
		width: number,
	): readonly string[] {
		let byWidth = this.previewCache.get(preview);
		if (!byWidth) {
			byWidth = new Map();
			this.previewCache.set(preview, byWidth);
		}
		let rendered = byWidth.get(width);
		if (!rendered) {
			rendered = renderPreviewContent(this.theme, preview, width).map(
				(line) => `      ${line}`,
			);
			byWidth.set(width, rendered);
		}
		return rendered;
	}

	private renderSubmitBody(width: number, rows: number): RenderedList {
		const allLines: string[] = [];
		const unanswered = this.unansweredCount();
		if (unanswered > 0) {
			allLines.push(
				this.theme.fg(
					"warning",
					`${unanswered} unanswered question${unanswered === 1 ? "" : "s"}; Enter still submits.`,
				),
			);
			allLines.push("");
		}
		for (let index = 0; index < this.questions.length; index++) {
			const question = this.questions[index];
			const state = this.states[index];
			if (!question || !state) continue;
			const label = questionTabLabel(question, index);
			const answer = renderAnswerSummary(question, state, this.theme);
			allLines.push(
				`${this.theme.fg("dim", `${index + 1}. ${label}:`)} ${answer}`,
			);
			const submittedNote = noteForSubmittedAnswer(question, state);
			if (submittedNote?.trim()) {
				const note = submittedNote.replace(/\s+/g, " ").trim();
				allLines.push(
					this.theme.fg(
						"muted",
						`   Note: ${truncateToWidth(note, Math.max(1, width - 9), "…")}`,
					),
				);
			}
		}
		allLines.push("");
		allLines.push(
			this.theme.fg(
				"accent",
				`${this.theme.fg("accent", "❯")} ${SUBMIT_OPTION}`,
			),
		);
		this.submitScrollOffset = clamp(
			this.submitScrollOffset,
			0,
			Math.max(0, allLines.length - rows),
		);
		const lines = allLines.slice(
			this.submitScrollOffset,
			this.submitScrollOffset + rows,
		);
		while (lines.length < rows) lines.push("");
		return {
			lines: lines.slice(0, rows),
			scrollOffset: this.submitScrollOffset,
			indicator: this.clipIndicator(
				this.submitScrollOffset,
				rows,
				allLines.length,
			),
		};
	}

	private scrollOffsetForCursor(
		currentOffset: number,
		cursorStart: number,
		cursorEnd: number,
		rows: number,
		totalRows: number,
		manualScroll: boolean,
	): number {
		const maxOffset = Math.max(0, totalRows - rows);
		if (maxOffset === 0) return 0;
		let nextOffset = clamp(currentOffset, 0, maxOffset);
		const cursorRows = cursorEnd - cursorStart;
		if (manualScroll && cursorRows > rows) {
			nextOffset = clamp(nextOffset, cursorStart, cursorEnd - rows);
		} else if (cursorStart < nextOffset || cursorEnd > nextOffset + rows) {
			nextOffset = cursorRows <= rows ? cursorEnd - rows : cursorStart;
		}
		return clamp(nextOffset, 0, maxOffset);
	}

	private clipIndicator(
		offset: number,
		rows: number,
		totalRows: number,
	): string {
		const above = offset > 0;
		const below = offset + rows < totalRows;
		if (above && below) return "↕";
		if (above) return "↑";
		if (below) return "↓";
		return "";
	}

	private unansweredCount(): number {
		let count = 0;
		for (let index = 0; index < this.questions.length; index++) {
			const question = this.questions[index];
			const state = this.states[index];
			if (!question || !state) continue;
			if (state.selectedOptions.size === 0 && state.customInput === undefined)
				count += 1;
		}
		return count;
	}

	private handleTimeout(): void {
		if (this.closed) return;
		if (this.editMode !== "none") {
			this.timeoutExpired = true;
			return;
		}
		for (let index = 0; index < this.questions.length; index++) {
			const question = this.questions[index];
			const state = this.states[index];
			if (!question || !state) continue;
			if (state.selectedOptions.size === 0 && state.customInput === undefined) {
				const fallbackIndex = clamp(
					question.recommended ?? 0,
					0,
					Math.max(0, question.options.length - 1),
				);
				const fallback = question.options[fallbackIndex];
				if (fallback) state.selectedOptions.add(fallback.label);
				state.timedOut = true;
			}
		}
		this.finishSubmit();
	}

	private runDeferredTimeout(): void {
		if (!this.timeoutExpired) return;
		this.timeoutExpired = false;
		this.handleTimeout();
	}

	private finishSubmit(): void {
		if (this.closed) return;
		this.closed = true;
		this.countdown?.dispose();
		this.callbacks.onSubmit({ kind: "submit", results: this.buildResults() });
	}

	private finishCancel(): void {
		if (this.closed) return;
		this.closed = true;
		this.countdown?.dispose();
		this.callbacks.onCancel();
	}

	private finishChat(): void {
		if (this.closed) return;
		this.closed = true;
		this.countdown?.dispose();
		this.callbacks.onSubmit({ kind: "chat" });
	}

	private buildResults(): AskDialogResultItem[] {
		const results: AskDialogResultItem[] = [];
		for (let index = 0; index < this.questions.length; index++) {
			const question = this.questions[index];
			const state = this.states[index];
			if (!question || !state) continue;
			const selectedOptions = question.options
				.map((option) => option.label)
				.filter((label) => state.selectedOptions.has(label));
			results.push({
				id: question.id,
				question: question.question,
				options: question.options.map((option) => option.label),
				multi: question.multi ?? false,
				selectedOptions,
				customInput: state.customInput,
				note: noteForSubmittedAnswer(question, state),
				timedOut: state.timedOut || undefined,
			});
		}
		return results;
	}
}

export { fit };
