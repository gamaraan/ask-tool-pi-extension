/**
 * Timeout / notification configuration for the ask tool.
 *
 * Configuration is stored in the global `ask-tool.json` file under Pi's
 * agent directory. CLI flags and environment variables override the file:
 * flag > env > file > default. Default timeout is 0 = disabled (no surprise
 * auto-selects).
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
// pi-lens-ignore: typescript:2307
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
	ASK_CONFIG_FILE_NAME,
	ASK_NOTIFY_ENV,
	ASK_NOTIFY_FLAG,
	ASK_TIMEOUT_ENV,
	ASK_TIMEOUT_FLAG,
} from "./constants.ts";

/**
 * Environment access that typechecks with or without @types/node installed
 * (the monorepo test graph provides node types; standalone consumers may not).
 */
function currentEnv(): Readonly<Record<string, string | undefined>> {
	return (
		(globalThis as { process?: { env?: Record<string, string | undefined> } })
			.process?.env ?? {}
	);
}

function envValue(name: string): string | undefined {
	return currentEnv()[name];
}

/**
 * Whether the current terminal advertises a notification protocol that can
 * manage focus-aware notifications itself. Unknown/base terminals are not
 * eligible for the desktop EventBus request because native desktop fallbacks
 * cannot tell whether the terminal window is focused.
 */
export function supportsTerminalNotifications(
	env: Readonly<Record<string, string | undefined>> = currentEnv(),
): boolean {
	const program = env.TERM_PROGRAM?.trim().toLowerCase() ?? "";
	const term = env.TERM?.trim().toLowerCase() ?? "";
	return (
		program === "kitty" ||
		term === "xterm-kitty" ||
		Boolean(env.KITTY_WINDOW_ID) ||
		program === "ghostty" ||
		Boolean(env.GHOSTTY_RESOURCES_DIR) ||
		program === "wezterm" ||
		Boolean(env.WEZTERM_PANE) ||
		program === "iterm.app" ||
		program === "iterm2" ||
		Boolean(env.ITERM_SESSION_ID) ||
		env?.LC_TERMINAL?.trim().toLowerCase() === "iterm2" ||
		program === "warpterminal" ||
		program === "warp" ||
		term.includes("ghostty")
	);
}

export interface AskToolConfig {
	/** Timeout in milliseconds; 0 = disabled. */
	timeoutMs: number;
	/** Best-effort "waiting for input" notification via ctx.ui.notify. */
	notify: boolean;
}

/** Values persisted in the global static JSON configuration file. */
export interface AskToolStoredConfig {
	timeoutSeconds?: number;
	notify?: boolean;
}

export function getAskConfigPath(): string {
	return join(getAgentDir(), ASK_CONFIG_FILE_NAME);
}

function parseTimeoutSeconds(
	value: string | number | undefined,
): number | undefined {
	if (value === undefined) return undefined;
	const trimmed = typeof value === "number" ? String(value) : value.trim();
	if (trimmed === "") return undefined;
	const seconds = Number(trimmed);
	if (!Number.isFinite(seconds) || seconds < 0) return undefined;
	return Math.floor(seconds);
}

function parseNotify(value: unknown): boolean | undefined {
	if (typeof value === "boolean") return value;
	if (typeof value !== "string") return undefined;
	const normalized = value.trim().toLowerCase();
	if (normalized === "on" || normalized === "true" || normalized === "1")
		return true;
	if (normalized === "off" || normalized === "false" || normalized === "0")
		return false;
	return undefined;
}

/** Read and structurally validate the static config; invalid files fall back to defaults. */
export function readAskConfig(path = getAskConfigPath()): AskToolStoredConfig {
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return {};
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
		return {};
	const record = parsed as Record<string, unknown>;
	const timeoutSeconds = parseTimeoutSeconds(
		typeof record.timeoutSeconds === "number"
			? record.timeoutSeconds
			: undefined,
	);
	const notify = parseNotify(record.notify);
	return {
		...(timeoutSeconds === undefined ? {} : { timeoutSeconds }),
		...(notify === undefined ? {} : { notify }),
	};
}

/** Persist the complete static config, creating Pi's agent directory if needed. */
export function writeAskConfig(
	config: Required<AskToolStoredConfig>,
	path = getAskConfigPath(),
): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

/**
 * Resolve the effective config from flag values (already parsed from CLI by
 * the extension runtime) and environment variables.
 */
export function resolveAskConfig(
	getFlag: (name: string) => boolean | string | undefined,
): AskToolConfig {
	const flagSeconds = getFlag(ASK_TIMEOUT_FLAG);
	const stored = readAskConfig();
	const timeoutSeconds =
		parseTimeoutSeconds(
			typeof flagSeconds === "string" ? flagSeconds : undefined,
		) ??
		parseTimeoutSeconds(envValue(ASK_TIMEOUT_ENV)) ??
		stored.timeoutSeconds ??
		0;
	const flagNotify = getFlag(ASK_NOTIFY_FLAG);
	const notify =
		parseNotify(typeof flagNotify === "string" ? flagNotify : undefined) ??
		parseNotify(envValue(ASK_NOTIFY_ENV)) ??
		stored.notify ??
		false;
	return { timeoutMs: timeoutSeconds * 1000, notify };
}
