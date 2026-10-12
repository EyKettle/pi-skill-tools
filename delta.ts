/**
 * delta.ts — the line diff and its application (plan Task 2).
 *
 * A delta is a list of hunks in the old text's line coordinates: each hunk
 * gives its 1-based start line, the number of replaced old lines, and the text
 * it inserts. Only the inserted text is stored — kept and deleted lines come
 * from the accumulating state. The change comes from Myers's O(ND) family
 * through jsdiff's `diffLines`, whose defaults keep a missing final newline
 * and a CR as differences, so reconstruction is exact.
 *
 * A replacement never costs more than the document: an abort (`timeout` or
 * `maxEditLength`) or a hunk list whose text does not beat the replacement
 * body sends the whole body instead.
 *
 * Pure module: no filesystem, no Pi import; its only dependency is the diff
 * library.
 */
import { diffLines } from "diff";
import type { ChangeObject } from "diff";

export interface Hunk {
	/** 1-based index of the first replaced line in the old text. */
	start: number;
	/** How many old lines the hunk replaces. */
	count: number;
	/** The inserted text; the whole new body when the diff degrades. */
	text: string;
}

export interface DeltaOptions {
	timeout?: number;
	maxEditLength?: number;
}

/** The abort window: past either bound the whole body is carried instead. */
const DEFAULT_TIMEOUT_MS = 1000;
const DEFAULT_MAX_EDIT_LENGTH = 10000;

/**
 * The hunks that turn `oldText` into `newText`. On abort, or when the stored
 * text would not beat the replacement body, one hunk replaces the whole text.
 */
export function diffText(
	oldText: string,
	newText: string,
	options: DeltaOptions = {},
): Hunk[] {
	const changes = diffLines(oldText, newText, {
		timeout: options.timeout ?? DEFAULT_TIMEOUT_MS,
		maxEditLength: options.maxEditLength ?? DEFAULT_MAX_EDIT_LENGTH,
	});
	if (changes === undefined) {
		return [wholeHunk(oldText, newText)];
	}
	const hunks = hunksOf(changes);
	const stored = hunks.reduce((total, hunk) => total + hunk.text.length, 0);
	if (hunks.length > 0 && stored >= newText.length) {
		return [wholeHunk(oldText, newText)];
	}
	return hunks;
}

/** Apply hunks to the old text, or undefined when they do not fit it. */
export function applyHunks(
	oldText: string,
	hunks: readonly Hunk[],
): string | undefined {
	if (!Array.isArray(hunks)) {
		return undefined;
	}
	const lines = splitLines(oldText);
	let cursor = 0;
	let out = "";
	for (const hunk of hunks) {
		if (typeof hunk !== "object" || hunk === null) {
			return undefined;
		}
		const { start, count, text } = hunk;
		if (!Number.isInteger(start) || start < 1) {
			return undefined;
		}
		if (!Number.isInteger(count) || count < 0) {
			return undefined;
		}
		if (typeof text !== "string") {
			return undefined;
		}
		const at = start - 1;
		if (at < cursor || at + count > lines.length) {
			return undefined;
		}
		out += lines.slice(cursor, at).join("");
		cursor = at + count;
		out += text;
	}
	out += lines.slice(cursor).join("");
	return out;
}

/** One hunk carrying the whole replacement. */
function wholeHunk(oldText: string, newText: string): Hunk {
	return { start: 1, count: splitLines(oldText).length, text: newText };
}

/** The hunks of a jsdiff change list, in the old text's coordinates. */
function hunksOf(changes: readonly ChangeObject<string>[]): Hunk[] {
	const hunks: Hunk[] = [];
	let line = 1;
	let start = 0;
	let count = 0;
	for (const change of changes) {
		const lines = splitLines(change.value).length;
		if (change.removed === true) {
			if (count === 0) {
				start = line;
			}
			count += lines;
			line += lines;
		} else if (change.added === true) {
			hunks.push({ start: count === 0 ? line : start, count, text: change.value });
			start = 0;
			count = 0;
		} else {
			if (count > 0) {
				hunks.push({ start, count, text: "" });
			}
			start = 0;
			count = 0;
			line += lines;
		}
	}
	if (count > 0) {
		hunks.push({ start, count, text: "" });
	}
	return hunks;
}

/** The lines of a text, each keeping its terminator: the unit hunks address. */
function splitLines(text: string): string[] {
	return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}
