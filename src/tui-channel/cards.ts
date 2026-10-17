/**
 * The card as the terminal receives it: the projection painted through the
 * injected theme, made safe for a terminal, and bounded by display width.
 *
 * Every string a card shows is untrusted in the sense that it came from a
 * skill's own metadata or from a path on disk. Control characters and
 * bidirectional overrides are replaced, and a line is cut by visible columns
 * rather than by code units, so a wide character cannot overflow the frame.
 */
import { sliceByColumn, visibleWidth } from "../deps/pi-tui";
import type { CardProjection, CardRole } from "./types";

/** The roles a theme can paint; a card names only these. */
export interface CardTheme {
	fg(role: CardRole, text: string): string;
}

export interface CardComponents {
	Text: new (text?: string) => { render(width: number): string[] };
}

export interface RenderOptions {
	readonly theme: CardTheme;
	readonly components: CardComponents;
	readonly width: number;
}

/**
 * Characters a terminal must not receive: C0/C1 controls (a newline and a tab
 * are handled by the line splitter, so they never reach here), bidi overrides
 * and isolates, zero-width joiners used to hide text, and the byte-order mark.
 */
const HAZARDS =
	/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u061c\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2060-\u206f\ufeff\ufdd0-\ufdef\ufffe\uffff]+/gu;

/** Replace each run of hazardous characters with one replacement character. */
export function sanitizeTerminalText(text: string): string {
	return text.replace(HAZARDS, "\uFFFD");
}

/** The visible column count of a line, ANSI-aware and East-Asian aware. */
export function displayWidth(line: string): number {
	return visibleWidth(line);
}

/**
 * Cut an unstyled line to `maxColumns` visible columns. A styled line is
 * returned unchanged: cutting inside an SGR sequence would leave the terminal
 * in whatever state the partial sequence set.
 */
export function boundToWidth(line: string, maxColumns: number): string {
	if (line.includes("\u001b")) {
		return line;
	}
	const cap = maxColumns < 0 ? 0 : maxColumns;
	if (visibleWidth(line) <= cap) {
		return line;
	}
	return sliceByColumn(line, 0, cap, true);
}

/** Render one card to terminal lines. */
export function renderCard(
	projection: CardProjection,
	options: RenderOptions,
): string[] {
	const lines: string[] = [];
	const paint = (role: CardRole, text: string): string =>
		options.theme.fg(role, sanitizeTerminalText(text));

	if (projection.labels !== undefined && projection.labels.length > 0) {
		// A load/unload card is its labels, one row, space-separated.
		const row = projection.labels.map((label) => paint(label.role, label.text));
		lines.push(...wrapRow(row.join(" "), options.width));
		return lines;
	}

	if (projection.call.length > 0) {
		lines.push(...renderSpans(projection.call, paint, options.width));
	}
	for (const arg of projection.fullArgs) {
		lines.push(
			...wrapRow(
				sanitizeTerminalText(arg),
				options.width,
			).map((line) => line),
		);
	}
	for (const line of projection.result) {
		lines.push(...renderSpans(line, paint, options.width));
	}
	return lines;
}

function renderSpans(
	spans: readonly { readonly text: string; readonly role: CardRole }[],
	paint: (role: CardRole, text: string) => string,
	width: number,
): string[] {
	const text = spans.map((span) => paint(span.role, span.text)).join("");
	return wrapRow(text, width);
}

/**
 * Wrap a painted row at `width` visible columns. A row that fits is returned
 * as it is; a longer one is cut, because a card line never scrolls
 * horizontally.
 */
function wrapRow(text: string, width: number): string[] {
	const bounded = boundToWidth(text, width);
	return bounded.split("\n");
}
