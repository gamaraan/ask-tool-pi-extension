/**
 * Shared structural stand-ins for browser/node globals, so the package
 * compiles with or without @types/node (the monorepo test graph provides node
 * types; standalone consumers may not). The real globals are structurally
 * compatible with these views.
 */

/**
 * Structural subset of `AbortSignal` — the members the ask tool uses. A real
 * `AbortSignal` satisfies this interface, so pi's `ctx.signal` can be passed
 * straight into these helpers.
 */
export interface AbortLike {
	readonly aborted: boolean;
	addEventListener(
		type: "abort",
		listener: () => void,
		options?: { once?: boolean },
	): void;
	removeEventListener(type: "abort", listener: () => void): void;
}

/** Structural view of the timer globals. */
export interface TimerGlobals {
	setTimeout: (fn: () => void, ms: number) => unknown;
	clearTimeout: (handle: unknown) => void;
	setInterval: (fn: () => void, ms: number) => unknown;
	clearInterval: (handle: unknown) => void;
}

export function timers(): TimerGlobals {
	return globalThis as unknown as TimerGlobals;
}

/** Structural view of the AbortController global (node >= 18 guarantees it). */
export interface AbortControllerLike {
	signal: AbortLike;
	abort(): void;
}

export function createAbortController(): AbortControllerLike {
	const Ctor = (
		globalThis as unknown as { AbortController: new () => AbortControllerLike }
	).AbortController;
	return new Ctor();
}

/** Abort error with the conventional name (`error.name === "AbortError"`). */
export function abortError(): Error {
	const error = new Error("Aborted");
	error.name = "AbortError";
	return error;
}
