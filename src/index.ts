/**
 * @gamaraan/ask-tool — pi extension entry.
 *
 * Registers the `ask` tool plus its CLI flags. Loaded by pi's extension
 * discovery via the `"pi": { "extensions": ["./src/index.ts"] }` manifest
 * (or by copying this package into `~/.pi/agent/extensions/`).
 *
 * Port of omp's ask tool (`oh-my-pi/packages/coding-agent/src/tools/ask.ts`);
 * see AGENTS.md for the architecture and development notes.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { defineAskTool } from "./ask-tool.ts";
import { ASK_NOTIFY_FLAG, ASK_TIMEOUT_FLAG } from "./constants.ts";

export default function askToolExtension(pi: ExtensionAPI): void {
	pi.registerFlag(ASK_TIMEOUT_FLAG, {
		description:
			"Ask tool timeout in seconds (0 = disabled, default). Flags win over PI_ASK_TIMEOUT_SECONDS.",
		type: "string",
	});
	pi.registerFlag(ASK_NOTIFY_FLAG, {
		description:
			"Best-effort 'waiting for input' notification (off|on, default off).",
		type: "string",
		default: "off",
	});
	pi.registerTool(defineAskTool(pi));
}

// Re-exported for future `/tree` re-answer wiring: re-validates a persisted
// `ask` toolCall's arguments through the same schema the live tool used.
export { recoverAskQuestions } from "./schema.ts";
export type {
	AskDialogResultItem,
	AskDialogSubmitResult,
	AskOption,
	AskQuestionInput,
	AskToolDetails,
	AskToolInput,
	QuestionResult,
} from "./types.ts";
