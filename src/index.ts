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
import { readAskConfig, writeAskConfig } from "./config.ts";
import { ASK_NOTIFY_FLAG, ASK_TIMEOUT_FLAG } from "./constants.ts";

export default function askToolExtension(pi: ExtensionAPI): void {
	pi.registerFlag(ASK_TIMEOUT_FLAG, {
		description:
			"Ask tool timeout in seconds (0 = disabled, default). Flags win over PI_ASK_TIMEOUT_SECONDS.",
		type: "string",
	});
	pi.registerFlag(ASK_NOTIFY_FLAG, {
		description:
			"Best-effort 'waiting for input' notification (off|on). Overrides PI_ASK_NOTIFY and ask-tool.json.",
		type: "string",
	});
	pi.registerCommand("ask-configure", {
		description: "Configure ask notifications and timeout defaults",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;
			const current = readAskConfig();
			const notify = await ctx.ui.confirm(
				"Ask notifications",
				`Enable waiting notifications? Currently ${current.notify ? "on" : "off"}.`,
			);
			const timeoutInput = await ctx.ui.input(
				"Ask timeout",
				String(current.timeoutSeconds ?? 0),
			);
			if (timeoutInput === undefined) return;
			const timeoutSeconds = Number(timeoutInput.trim());
			if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 0) {
				ctx.ui.notify(
					"Timeout must be a non-negative number of seconds.",
					"error",
				);
				return;
			}
			writeAskConfig({
				notify,
				timeoutSeconds: Math.floor(timeoutSeconds),
			});
			ctx.ui.notify("Ask configuration saved. Reloading…", "info");
			await ctx.reload();
			return;
		},
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
