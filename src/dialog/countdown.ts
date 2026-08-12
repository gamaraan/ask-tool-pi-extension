/**
 * Deadline-based countdown timer for the ask dialog.
 *
 * Ported from omp `packages/coding-agent/src/modes/components/countdown-timer.ts`
 * (pi's built-in timer has no `reset()`; the ask dialog re-arms the countdown
 * on every key press, so the deadline-based variant is required).
 */
import type { TUI } from "@earendil-works/pi-tui";
import { timers } from "../timers.ts";

export class CountdownTimer {
	private intervalId: unknown;
	private expireTimeoutId: unknown;
	private remainingSeconds: number;
	private deadlineMs = 0;
	private readonly initialMs: number;
	private readonly tui: TUI | undefined;
	private readonly onTick: (seconds: number) => void;
	private readonly onExpire: () => void;

	constructor(
		timeoutMs: number,
		tui: TUI | undefined,
		onTick: (seconds: number) => void,
		onExpire: () => void,
	) {
		this.initialMs = timeoutMs;
		this.remainingSeconds = Math.ceil(timeoutMs / 1000);
		this.tui = tui;
		this.onTick = onTick;
		this.onExpire = onExpire;
		this.start();
	}

	private calculateRemainingSeconds(now = Date.now()): number {
		const remainingMs = Math.max(0, this.deadlineMs - now);
		return Math.ceil(remainingMs / 1000);
	}

	private start(): void {
		const now = Date.now();
		this.deadlineMs = now + this.initialMs;
		this.remainingSeconds = this.calculateRemainingSeconds(now);
		this.onTick(this.remainingSeconds);
		this.tui?.requestRender();

		this.expireTimeoutId = timers().setTimeout(() => {
			this.dispose();
			this.onExpire();
		}, this.initialMs);

		this.startInterval();
	}

	private startInterval(): void {
		if (this.intervalId !== undefined) {
			timers().clearInterval(this.intervalId);
			this.intervalId = undefined;
		}
		this.intervalId = timers().setInterval(() => {
			const remainingSeconds = this.calculateRemainingSeconds();
			if (remainingSeconds !== this.remainingSeconds) {
				this.remainingSeconds = remainingSeconds;
				this.onTick(this.remainingSeconds);
			}
			this.tui?.requestRender();
		}, 1000);
	}

	/** Reset the countdown to its initial value (inactivity re-arm). */
	reset(): void {
		this.dispose();
		this.start();
	}

	dispose(): void {
		if (this.intervalId !== undefined) {
			timers().clearInterval(this.intervalId);
			this.intervalId = undefined;
		}
		if (this.expireTimeoutId !== undefined) {
			timers().clearTimeout(this.expireTimeoutId);
			this.expireTimeoutId = undefined;
		}
	}
}
