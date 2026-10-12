/**
 * state.ts — the loaded skill set and its algebra (plan Task 1).
 *
 * The unit is one file: a skill's SKILL.md and each of its related files are
 * separate entries. A skill's identity is its id alone — bare until a
 * location conflict prefixes it, a related file appending its ref path; an
 * entry carries that id, the absolute path it was read from, the frozen body,
 * and the volume the tool result reports. Loading returns added, replaced, or
 * unchanged; a replacement keeps its slot, so the order is the load order.
 *
 * This module is pure: no filesystem, no Pi import, no session-state import.
 * Identity syntax and parsing live in skill-id.ts; reaching an id by its shape
 * happens only through that parser.
 *
 * Serialization is versioned and decoded closed: a value whose version or
 * shape is unrecognized decodes as an empty set, never as a partial one.
 */
import { parseSkillId, reproduceSkillId } from "./skill-id";
import type { SkillStorage } from "./skill-id";
import type { CandidateEntry, FailureCode, FailureEvidence } from "./failure";

/** The size the tool result reports for an entry's frozen body. */
export interface EntryVolume {
	bytes: number;
	lines: number;
}

/** One loaded file: a skill's SKILL.md or one of its related files. */
export interface StateEntry {
	id: string;
	path: string;
	body: string;
	volume: EntryVolume;
}

/** The loaded set, in load order. */
export interface LoadedSet {
	entries: readonly StateEntry[];
}

/** The state before anything was loaded. */
export const EMPTY_SET: LoadedSet = { entries: [] };

/** The serialized shape's version; an unrecognized one decodes closed. */
export const STATE_VERSION = 1;

/** The stored shape of the set. */
export interface EncodedState {
	version: number;
	entries: readonly StateEntry[];
}

/** What one load did to the set. */
export type LoadOutcome = "added" | "replaced" | "unchanged";

export interface LoadFailure {
	index: number;
	error: string;
}

export type LoadResult =
	| { ok: true; set: LoadedSet; outcomes: readonly LoadOutcome[] }
	| { ok: false; failures: readonly LoadFailure[] };

export type CancelFailure =
	| {
			index: number;
			id: string;
			kind: "invalid-id";
			error: string;
			code: FailureCode;
			evidence: FailureEvidence;
	  }
	| { index: number; id: string; kind: "not-loaded" }
	| {
			index: number;
			id: string;
			kind: "ambiguous";
			candidates: readonly CandidateEntry[];
	  };

export type CancelResult =
	| { ok: true; set: LoadedSet; removed: readonly StateEntry[] }
	| { ok: false; failures: readonly CancelFailure[] };

/**
 * Load files into the set. Each outcome answers the input at the same index;
 * a replacement keeps its slot, so the order stays the load order.
 */
export function load(
	set: LoadedSet,
	entries: readonly StateEntry[],
): LoadResult {
	const failures: LoadFailure[] = [];
	for (const [index, entry] of entries.entries()) {
		const reason = malformedEntryReason(entry);
		if (reason !== undefined) {
			failures.push({ index, error: reason });
		}
	}
	if (failures.length > 0) {
		return { ok: false, failures };
	}
	const next = [...set.entries];
	const outcomes: LoadOutcome[] = [];
	for (const entry of entries) {
		const at = next.findIndex((existing) => existing.id === entry.id);
		if (at === -1) {
			next.push(entry);
			outcomes.push("added");
		} else if (sameEntry(next[at], entry)) {
			outcomes.push("unchanged");
		} else {
			next[at] = entry;
			outcomes.push("replaced");
		}
	}
	return { ok: true, set: { entries: next }, outcomes };
}

/** Whether two entries with the same id carry the same data. */
function sameEntry(a: StateEntry, b: StateEntry): boolean {
	return (
		a.path === b.path &&
		a.body === b.body &&
		a.volume.bytes === b.volume.bytes &&
		a.volume.lines === b.volume.lines
	);
}

/**
 * Cancel loaded files. An id reaches the entry it names and every entry under
 * it: the same name — and the same storage when the target carries one —
 * with the entry's ref path equal to the target's or below it. A batch is
 * atomic: any failing id leaves the whole set untouched.
 */
export function cancel(set: LoadedSet, ids: readonly string[]): CancelResult {
	const targets = new Set<StateEntry>();
	const failures: CancelFailure[] = [];
	for (const [index, id] of ids.entries()) {
		const parsed = parseSkillId(id);
		if (parsed.error !== undefined) {
			const { error, code, evidence } = parsed;
			if (code === undefined || evidence === undefined) {
				throw new Error("skill id parse failure lacks its code/evidence");
			}
			failures.push({ index, id, kind: "invalid-id", error, code, evidence });
			continue;
		}
		const matches = set.entries.filter((entry) => reaches(entry.id, parsed));
		if (matches.length === 0) {
			failures.push({ index, id, kind: "not-loaded" });
			continue;
		}
		const representatives = new Map<string, StateEntry>();
		for (const entry of matches) {
			const identity = parsedIdentity(entry.id);
			const key = identity.storage ?? "";
			const current = representatives.get(key);
			if (
				current === undefined ||
				(parsedIdentity(current.id).refPath !== undefined &&
					identity.refPath === undefined)
			) {
				representatives.set(key, entry);
			}
		}
		if (representatives.size > 1) {
			failures.push({
				index,
				id,
				kind: "ambiguous",
				candidates: Array.from(representatives.values(), (entry) => ({
					id: entry.id,
					path: entry.path,
				})),
			});
			continue;
		}
		for (const entry of matches) {
			targets.add(entry);
		}
	}
	if (failures.length > 0) {
		return { ok: false, failures };
	}
	const removed = set.entries.filter((entry) => targets.has(entry));
	const remaining = set.entries.filter((entry) => !targets.has(entry));
	return { ok: true, set: { entries: remaining }, removed };
}

/** The parsed parts of a loaded entry's id; entries are validated. */
function parsedIdentity(id: string): {
	storage?: SkillStorage;
	name: string;
	refPath?: string;
} {
	const parsed = parseSkillId(id);
	if (parsed.error !== undefined) {
		throw new Error(`loaded entry id '${id}' does not parse`);
	}
	return parsed;
}

/**
 * Whether an entry id is reached by a cancel target: the same name — and the
 * same storage when the target names one — with the entry's id, ref path
 * included, equal to the target's or below it.
 */
function reaches(
	entryId: string,
	target: { storage?: SkillStorage; name: string; refPath?: string },
): boolean {
	const entry = parsedIdentity(entryId);
	if (entry.name !== target.name) {
		return false;
	}
	if (target.storage !== undefined && entry.storage !== target.storage) {
		return false;
	}
	const targetKey =
		target.refPath === undefined
			? target.name
			: `${target.name}/${target.refPath}`;
	const entryKey =
		entry.refPath === undefined ? entry.name : `${entry.name}/${entry.refPath}`;
	return entryKey === targetKey || entryKey.startsWith(`${targetKey}/`);
}

const ENTRY_KEYS = new Set([
	"id",
	"path",
	"body",
	"volume",
]);

/**
 * Why `value` is not a well-formed entry, or undefined when it is one. The
 * same shape check guards loading and closed decoding.
 */
export function malformedEntryReason(value: unknown): string | undefined {
	if (typeof value !== "object" || value === null) {
		return "entry is not an object";
	}
	const entry = value as Record<string, unknown>;
	if (Object.keys(entry).some((key) => !ENTRY_KEYS.has(key))) {
		return "entry has an unknown field";
	}
	const id = entry.id;
	if (typeof id !== "string") {
		return "id is not a string";
	}
	const parsed = parseSkillId(id);
	if (parsed.error !== undefined || reproduceSkillId(parsed) !== id) {
		return "id is not a skill id";
	}
	if (typeof entry.path !== "string" || !entry.path.startsWith("/")) {
		return "path is not absolute";
	}
	if (typeof entry.body !== "string") {
		return "body is not a string";
	}
	if (typeof entry.volume !== "object" || entry.volume === null) {
		return "volume is not an object";
	}
	const volume = entry.volume as Record<string, unknown>;
	if (
		Object.keys(volume).some((key) => key !== "bytes" && key !== "lines") ||
		!nonNegativeInteger(volume.bytes) ||
		!nonNegativeInteger(volume.lines)
	) {
		return "volume is not a pair of non-negative integers";
	}
	return undefined;
}

/** A bytes/lines counter: an integer, never negative. */
function nonNegativeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * Encode the set for storage. Decoding re-admits it or rejects it whole.
 */
export function encode(state: LoadedSet): EncodedState {
	return {
		version: STATE_VERSION,
		entries: state.entries.map((entry) => ({
			...entry,
			volume: { ...entry.volume },
		})),
	};
}

/**
 * The set a stored value encodes, or undefined when the value is not one. An
 * unrecognized version or shape yields undefined, never a partial set.
 */
export function tryDecode(value: unknown): LoadedSet | undefined {
	if (typeof value !== "object" || value === null) {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	if (
		Object.keys(record).some((key) => key !== "version" && key !== "entries") ||
		record.version !== STATE_VERSION ||
		!Array.isArray(record.entries)
	) {
		return undefined;
	}
	const entries: StateEntry[] = [];
	const identities = new Set<string>();
	for (const raw of record.entries) {
		if (!isWellFormedEntry(raw)) {
			return undefined;
		}
		const id = raw.id;
		if (identities.has(id)) {
			return undefined;
		}
		identities.add(id);
		entries.push(raw);
	}
	return { entries };
}

/**
 * Decode a stored value. A value whose version or shape is unrecognized —
 * a malformed or duplicate entry included — decodes as an empty set, never
 * as a partial one.
 */
export function decode(value: unknown): LoadedSet {
	return tryDecode(value) ?? EMPTY_SET;
}

/** Whether `value` is a well-formed entry. */
function isWellFormedEntry(value: unknown): value is StateEntry {
	return malformedEntryReason(value) === undefined;
}
