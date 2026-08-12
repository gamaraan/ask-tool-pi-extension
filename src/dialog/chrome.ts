/**
 * Box-drawing chrome for the ask dialog overlay.
 *
 * Ported from omp `packages/coding-agent/src/modes/components/overlay-box.ts`
 * (topBorder/divider/row/bottomBorder) and rendered through pi's `Theme`
 * instead of omp's singleton theme. pi has no `padding` helper, so `fit()`
 * pads with plain spaces.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/** Pad or truncate a (possibly ANSI-styled) string to exactly `width` columns. */
export function fit(text: string, width: number): string {
	if (width <= 0) return "";
	const w = visibleWidth(text);
	if (w === width) return text;
	if (w < width) return text + " ".repeat(width - w);
	const cut = truncateToWidth(text, width);
	const cw = visibleWidth(cut);
	return cw < width ? cut + " ".repeat(width - cw) : cut;
}

/** Top border with an optional accent-colored title inset into the rule. */
export function topBorder(theme: Theme, width: number, title: string): string {
	const inner = Math.max(0, width - 2);
	if (!title) {
		return theme.fg("border", `╭${"─".repeat(inner)}╮`);
	}
	const shown = truncateToWidth(` ${title} `, Math.max(0, inner - 2), "…");
	const fillWidth = Math.max(0, inner - 1 - visibleWidth(shown));
	return (
		theme.fg("border", "╭─") +
		theme.bold(theme.fg("accent", shown)) +
		theme.fg("border", `${"─".repeat(fillWidth)}╮`)
	);
}

/** A horizontal rule with left/right tees, splitting overlay sections. */
export function divider(theme: Theme, width: number): string {
	return theme.fg("border", `├${"─".repeat(Math.max(0, width - 2))}┤`);
}

export function bottomBorder(theme: Theme, width: number): string {
	return theme.fg("border", `╰${"─".repeat(Math.max(0, width - 2))}╯`);
}

/** Wrap pre-styled content in vertical borders with single-column insets. */
export function row(theme: Theme, content: string, width: number): string {
	return `${theme.fg("border", "│")} ${fit(content, Math.max(0, width - 4))} ${theme.fg("border", "│")}`;
}

/** Normalize tabs to two spaces (port of omp's replaceTabs). */
export function replaceTabs(text: string): string {
	return text.replace(/\t/g, "  ");
}
