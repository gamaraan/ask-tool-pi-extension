/**
 * Timeout / notification configuration for the ask tool.
 *
 * pi extensions have no settings accessor, so configuration rides on CLI
 * flags (`--ask-timeout <seconds>`, `--ask-notify <off|on>`) with env-var
 * fallbacks (`PI_ASK_TIMEOUT_SECONDS`, `PI_ASK_NOTIFY`). Precedence:
 * flag > env > default. Default timeout is 0 = disabled (no surprise
 * auto-selects). Decision D2 in the implementation plan.
 */
import {
	ASK_NOTIFY_ENV,
	ASK_NOTIFY_FLAG,
	ASK_TIMEOUT_ENV,
	ASK_TIMEOUT_FLAG,
} from "./constants.ts";

/**
 * Environment access that typechecks with or without @types/node installed
 * (the monorepo test graph provides node types; standalone consumers may not).
 */
function envValue(name: string): string | undefined {
	const env = (
		globalThis as { process?: { env?: Record<string, string | undefined> } }
	).process?.env;
	return env?.[name];
}

export interface AskToolConfig {
	/** Timeout in milliseconds; 0 = disabled. */
	timeoutMs: number;
	/** Best-effort "waiting for input" notification via ctx.ui.notify. */
	notify: boolean;
}

function parseTimeoutSeconds(value: string | undefined): number | undefined {
	if (value === undefined) return undefined;
	const trimmed = value.trim();
	if (trimmed === "") return undefined;
	const seconds = Number(trimmed);
	if (!Number.isFinite(seconds) || seconds < 0) return undefined;
	return Math.floor(seconds);
}

function parseNotify(value: string | undefined): boolean | undefined {
	if (value === undefined) return undefined;
	const normalized = value.trim().toLowerCase();
	if (normalized === "on" || normalized === "true" || normalized === "1")
		return true;
	if (normalized === "off" || normalized === "false" || normalized === "0")
		return false;
	return undefined;
}

/**
 * Resolve the effective config from flag values (already parsed from CLI by
 * the extension runtime) and environment variables.
 */
export function resolveAskConfig(
	getFlag: (name: string) => boolean | string | undefined,
): AskToolConfig {
	const flagSeconds = getFlag(ASK_TIMEOUT_FLAG);
	const timeoutSeconds =
		parseTimeoutSeconds(
			typeof flagSeconds === "string" ? flagSeconds : undefined,
		) ??
		parseTimeoutSeconds(envValue(ASK_TIMEOUT_ENV)) ??
		0;
	const flagNotify = getFlag(ASK_NOTIFY_FLAG);
	const notify =
		parseNotify(typeof flagNotify === "string" ? flagNotify : undefined) ??
		parseNotify(envValue(ASK_NOTIFY_ENV)) ??
		false;
	return { timeoutMs: timeoutSeconds * 1000, notify };
}
