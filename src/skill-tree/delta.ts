/**
 * The line diff and its application.
 *
 * A replacement is a list of blocks in the old text's coordinates: each names
 * its 1-based start line, the number of old lines it replaces, and the text it
 * inserts. Kept and deleted lines come from the accumulating state, so only
 * the blocks land.
 *
 * A replacement never costs more than the document: an abort (`timeout` or
 * `maxEditLength`), or a stored diff that does not come out smaller than the
 * whole body, carries the whole body instead.
 */
import { diffLines } from "diff";
import type { ChangeObject } from "diff";
import type { DiffBlock, ReplacePayload } from "./types";

export interface DeltaOptions {
	readonly timeout?: number;
	readonly maxEditLength?: number;
}

/** The abort window: past either bound the whole body is carried instead. */
const DEFAULT_TIMEOUT_MS = 1000;
const DEFAULT_MAX_EDIT_LENGTH = 10000;

/** The replacement that turns `before` into `after`. */
export function buildReplacement(
	before: string,
	after: string,
	options: DeltaOptions = {},
): ReplacePayload {
	const changes = diffLines(before, after, {
		timeout: options.timeout ?? DEFAULT_TIMEOUT_MS,
		maxEditLength: options.maxEditLength ?? DEFAULT_MAX_EDIT_LENGTH,
	});
	if (changes === undefined) {
		return { kind: "body", body: after };
	}
	const blocks = blocksOf(changes);
	const wholeBlock: DiffBlock = {
		start: 1,
		count: splitLines(before).length,
		text: after,
	};
	// The bound measures what lands: the block list with its coordinates,
	// against the whole body as one block of the same shape.
	if (
		blocks.length > 0 &&
		JSON.stringify(blocks).length >= JSON.stringify([wholeBlock]).length
	) {
		return { kind: "body", body: after };
	}
	return { kind: "diff", blocks };
}

/** Apply a replacement to the old text, or undefined when it does not fit. */
export function applyReplacement(
	before: string,
	payload: ReplacePayload,
): string | undefined {
	if (payload.kind === "body") {
		return payload.body;
	}
	if (!Array.isArray(payload.blocks)) {
		return undefined;
	}
	const lines = splitLines(before);
	let cursor = 0;
	let out = "";
	for (const block of payload.blocks) {
		if (typeof block !== "object" || block === null) {
			return undefined;
		}
		const { start, count, text } = block;
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

/** The blocks of a jsdiff change list, in the old text's coordinates. */
function blocksOf(changes: readonly ChangeObject<string>[]): DiffBlock[] {
	const blocks: DiffBlock[] = [];
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
			blocks.push({ start: count === 0 ? line : start, count, text: change.value });
			start = 0;
			count = 0;
		} else {
			if (count > 0) {
				blocks.push({ start, count, text: "" });
			}
			start = 0;
			count = 0;
			line += lines;
		}
	}
	if (count > 0) {
		blocks.push({ start, count, text: "" });
	}
	return blocks;
}

/** The lines of a text, each keeping its terminator: the unit blocks address. */
function splitLines(text: string): string[] {
	return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}
