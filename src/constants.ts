/**
 * Reserved runtime option labels and shared constants for the ask tool.
 *
 * These labels are offered automatically by the UI on every question and must
 * never collide with model-provided option labels (schema validation rejects
 * such collisions). Ported from omp `packages/coding-agent/src/tools/ask.ts`.
 */

/** Free-text answer row, always offered on every question. */
export const OTHER_OPTION = "Other (type your own)";

/** Redirect row: the user chose to talk about the question instead of answering. TUI-only. */
export const CHAT_ABOUT_THIS_OPTION = "Chat about this";

/** Internal paging row used by the rich dialog's submit tab and multi flows. */
export const NEXT_OPTION = "Next →";

/** Simple-path multi-select submit row ("Done selecting"). */
export const DONE_OPTION = "Done selecting";

/** Labels a model-provided option may never use. */
export const RESERVED_OPTION_LABELS: Record<string, true> = {
	[OTHER_OPTION]: true,
	[CHAT_ABOUT_THIS_OPTION]: true,
	[NEXT_OPTION]: true,
};

/** Appended to the recommended option's label. */
export const RECOMMENDED_SUFFIX = " (Recommended)";

/**
 * Window after the timeout deadline within which an `undefined` selection is
 * attributed to a UI-enforced timeout (for surfaces that close the dialog at
 * the deadline but never invoke `onTimeout`). Cancels beyond it are user Esc.
 */
export const TIMEOUT_DETECTION_TOLERANCE_MS = 1_000;

/** Flag name for the timeout in seconds (0 = disabled). */
export const ASK_TIMEOUT_FLAG = "ask-timeout";

/** Flag name for the best-effort waiting notification (off|on). */
export const ASK_NOTIFY_FLAG = "ask-notify";

/** Environment variables read when the corresponding flag is not set. */
export const ASK_TIMEOUT_ENV = "PI_ASK_TIMEOUT_SECONDS";
export const ASK_NOTIFY_ENV = "PI_ASK_NOTIFY";

/** Global static configuration filename under Pi's agent directory. */
export const ASK_CONFIG_FILE_NAME = "ask-tool.json";
