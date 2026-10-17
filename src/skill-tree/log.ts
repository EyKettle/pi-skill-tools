/**
 * The commit log: entry shapes and folding.
 *
 * A path's entries fold into the state they produce: start from the empty
 * set, or from the last `baseline` when the path has one, and apply every
 * change in order. Each change carries its whole effect — the loads, the
 * replacements, and every remove a cascade reached — so the same path always
 * yields the same state.
 *
 * A malformed entry, a replacement that does not fit, or an operation on an
 * identity the state does not hold aborts the fold; the caller then falls
 * back to the copy.
 */
import { applyReplacement } from "./delta";
import { isStateEntry } from "./state";
import type { CommitEntry, LoadedSet, StateEntry } from "./types";

export type FoldResult =
	| { readonly ok: true; readonly state: LoadedSet }
	| { readonly ok: false; readonly index: number; readonly error: string };

/** Fold a path's commit entries into the state they produce. */
export function fold(entries: readonly CommitEntry[]): FoldResult {
	let start = 0;
	let baseline: readonly StateEntry[] = [];
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (entry.kind === "baseline") {
			start = index + 1;
			baseline = entry.entries;
			break;
		}
	}

	const state: StateEntry[] = [];
	if (!Array.isArray(baseline)) {
		return {
			ok: false,
			index: start - 1,
			error: "the baseline is not a list of entries",
		};
	}
	for (const entry of baseline) {
		if (!isStateEntry(entry)) {
			return {
				ok: false,
				index: start - 1,
				error: "the baseline holds a malformed entry",
			};
		}
		if (state.some((existing) => existing.id === entry.id)) {
			return {
				ok: false,
				index: start - 1,
				error: "the baseline repeats an identity",
			};
		}
		state.push(entry);
	}

	for (let index = start; index < entries.length; index++) {
		const entry = entries[index];
		if (entry.kind !== "change") {
			return {
				ok: false,
				index,
				error: "a baseline appears after the fold start",
			};
		}
		if (!Array.isArray(entry.operations)) {
			return {
				ok: false,
				index,
				error: "the change's operations are not a list",
			};
		}
		if (entry.operations.length === 0) {
			return { ok: false, index, error: "the change carries no operations" };
		}
		for (const operation of entry.operations) {
			if (operation.kind === "load") {
				if (!isStateEntry(operation.entry)) {
					return {
						ok: false,
						index,
						error: "the loaded entry is malformed",
					};
				}
				if (state.some((existing) => existing.id === operation.entry.id)) {
					return {
						ok: false,
						index,
						error: "the identity is already loaded",
					};
				}
				state.push(operation.entry);
				continue;
			}
			const at = state.findIndex((existing) => existing.id === operation.id);
			if (operation.kind === "replace") {
				if (at === -1) {
					return {
						ok: false,
						index,
						error: "the replaced identity is not loaded",
					};
				}
				const body = applyReplacement(state[at].body, operation.payload);
				if (body === undefined) {
					return {
						ok: false,
						index,
						error: "the replacement does not fit the loaded body",
					};
				}
				state[at] = { ...state[at], body };
				continue;
			}
			if (operation.kind !== "remove") {
				return { ok: false, index, error: "the operation kind is unknown" };
			}
			if (at === -1) {
				return {
					ok: false,
					index,
					error: "the removed identity is not loaded",
				};
			}
			state.splice(at, 1);
		}
	}
	return { ok: true, state };
}
