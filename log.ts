/**
 * log.ts — the commit log: entry shapes, folding, and marker validation
 * (plan Task 2).
 *
 * Each change appends one entry carrying its whole effect; a change that
 * cancels a skill carries the skill and every related file it reaches. An
 * entry is either `delta` — the commit table's loads, replaces, and removes —
 * or `baseline`, a whole state, produced where the history setting turns on
 * after being off.
 *
 * Folding starts from the empty state, or from the nearest `baseline` on the
 * path, and applies every delta in order; the same log always yields the same
 * state. A malformed entry or a patch that does not fit aborts the fold.
 *
 * Pure module: no filesystem, no Pi import.
 */
import { applyHunks, countTextLines } from "./delta";
import type { Hunk } from "./delta";
import { malformedEntryReason } from "./state";
import type { LoadedSet, StateEntry } from "./state";

/** One unit-level operation of a change, as the commit table states it. */
export type CommitOperation =
	| { kind: "load"; entry: StateEntry }
	| { kind: "replace"; id: string; hunks: readonly Hunk[] }
	| { kind: "remove"; id: string };

/** One appended entry: a change's operations, or a whole state. */
export type CommitEntry =
	| { kind: "delta"; operations: readonly CommitOperation[] }
	| { kind: "baseline"; entries: readonly StateEntry[] };

export type FoldResult =
	| { ok: true; state: LoadedSet }
	| { ok: false; index: number; error: string };

/** Fold a path's commit entries into the state they produce. */
export function fold(entries: readonly CommitEntry[]): FoldResult {
	let start = 0;
	let base: readonly StateEntry[] = [];
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (entry.kind === "baseline") {
			if (!Array.isArray(entry.entries)) {
				return { ok: false, index, error: "the baseline is not a list of entries" };
			}
			start = index + 1;
			base = entry.entries;
			break;
		}
	}
	const state: StateEntry[] = [];
	for (const entry of base) {
		const reason = malformedEntryReason(entry);
		if (reason !== undefined) {
			return { ok: false, index: start - 1, error: reason };
		}
		if (state.some((existing) => existing.id === entry.id)) {
			return { ok: false, index: start - 1, error: "the id is duplicated in the baseline" };
		}
		state.push(entry);
	}
	for (let index = start; index < entries.length; index++) {
		const entry = entries[index];
		if (entry.kind !== "delta") {
			return { ok: false, index, error: "an entry after the fold start is a baseline" };
		}
		if (!Array.isArray(entry.operations)) {
			return { ok: false, index, error: "the change's operations are not a list" };
		}
		if (entry.operations.length === 0) {
			return { ok: false, index, error: "the change carries no operations" };
		}
		for (const operation of entry.operations) {
			if (operation.kind === "load") {
				const reason = malformedEntryReason(operation.entry);
				if (reason !== undefined) {
					return { ok: false, index, error: reason };
				}
				if (state.some((existing) => existing.id === operation.entry.id)) {
					return { ok: false, index, error: "the id is already loaded" };
				}
				state.push(operation.entry);
				continue;
			}
			const at = state.findIndex((existing) => existing.id === operation.id);
			if (operation.kind === "replace") {
				if (at === -1) {
					return { ok: false, index, error: "the replaced identity is not loaded" };
				}
				const body = applyHunks(state[at].body, operation.hunks);
				if (body === undefined) {
					return { ok: false, index, error: "the patch does not fit the loaded body" };
				}
				state[at] = withBody(state[at], body);
				continue;
			}
			if (at === -1) {
				return { ok: false, index, error: "the removed identity is not loaded" };
			}
			state.splice(at, 1);
		}
	}
	return { ok: true, state: { entries: state } };
}

/** Refresh an entry's body and the volume the tool result reports. */
function withBody(entry: StateEntry, body: string): StateEntry {
	return {
		...entry,
		body,
		volume: {
			bytes: Buffer.byteLength(body, "utf8"),
			lines: countTextLines(body),
		},
	};
}

/**
 * Whether the copy can be trusted as the current state: it exists, the path
 * has commit entries, and its marker names the path's last one. With no
 * entries on the path the copy is authoritative.
 */
export function copyIsCurrent(
	copy: { marker: string | undefined } | undefined,
	lastEntryId: string | undefined,
): boolean {
	if (copy === undefined) {
		return false;
	}
	if (lastEntryId === undefined) {
		return true;
	}
	return copy.marker === lastEntryId;
}
