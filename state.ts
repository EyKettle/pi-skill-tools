/**
 * state.ts — the loaded skill set and its algebra (plan Task 1).
 *
 * The unit is one file: a skill's SKILL.md and each of its related files are
 * separate entries. An entry carries its identity, its display id, the
 * absolute path it was read from, the frozen body, and the volume the tool
 * result reports. Loading returns added, replaced, or unchanged; a replacement
 * keeps its slot, so the order is the load order.
 *
 * This module is pure: no filesystem, no Pi import, no session-state import.
 * Identity syntax and parsing live in skill-id.ts; reaching an id by its shape
 * happens only through that parser.
 *
 * Serialization is versioned and decoded closed: a value whose version or
 * shape is unrecognized decodes as an empty set, never as a partial one.
 */
import { formatSkillId, isSkillStorage, parseSkillId } from "./skill-id";
import type { SkillStorage } from "./skill-id";
import type { CandidateEntry, FailureCode, FailureEvidence } from "./failure";

/** The size the tool result reports for an entry's frozen body. */
export interface EntryVolume {
	bytes: number;
	lines: number;
}

/** One loaded file: a skill's SKILL.md or one of its related files. */
export interface StateEntry {
	storage: SkillStorage;
	name: string;
	refPath?: string;
	displayId: string;
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
		const at = next.findIndex((existing) => sameIdentity(existing, entry));
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

/** Whether two entries name the same loaded file. */
function sameIdentity(a: StateEntry, b: StateEntry): boolean {
	return a.storage === b.storage && a.name === b.name && a.refPath === b.refPath;
}

/** Whether two entries with the same identity carry the same data. */
function sameEntry(a: StateEntry, b: StateEntry): boolean {
	return (
		a.displayId === b.displayId &&
		a.path === b.path &&
		a.body === b.body &&
		a.volume.bytes === b.volume.bytes &&
		a.volume.lines === b.volume.lines
	);
}

/**
 * Cancel loaded files. An id carrying a ref path reaches that entry alone; a
 * skill id reaches the skill and every entry under it. A batch is atomic: any
 * failing id leaves the whole set untouched.
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
		if (parsed.refPath !== undefined) {
			const matches = set.entries.filter(
				(entry) =>
					entry.name === parsed.name &&
					entry.refPath === parsed.refPath &&
					(parsed.storage === undefined || entry.storage === parsed.storage),
			);
			if (matches.length === 0) {
				failures.push({ index, id, kind: "not-loaded" });
			} else if (matches.length > 1) {
				failures.push({
					index,
					id,
					kind: "ambiguous",
					candidates: matches.map((entry) => ({
						id: formatSkillId(entry.storage, entry.name, entry.refPath),
						path: entry.path,
					})),
				});
			} else {
				targets.add(matches[0]);
			}
			continue;
		}
		const matches = set.entries.filter(
			(entry) =>
				entry.name === parsed.name &&
				(parsed.storage === undefined || entry.storage === parsed.storage),
		);
		const representatives = new Map<SkillStorage, StateEntry>();
		for (const entry of matches) {
			const current = representatives.get(entry.storage);
			if (
				current === undefined ||
				(current.refPath !== undefined && entry.refPath === undefined)
			) {
				representatives.set(entry.storage, entry);
			}
		}
		if (representatives.size === 0) {
			failures.push({ index, id, kind: "not-loaded" });
		} else if (representatives.size > 1) {
			failures.push({
				index,
				id,
				kind: "ambiguous",
				candidates: Array.from(representatives.values(), (entry) => ({
					id: formatSkillId(entry.storage, entry.name),
					path: entry.path,
				})),
			});
		} else {
			for (const entry of matches) {
				targets.add(entry);
			}
		}
	}
	if (failures.length > 0) {
		return { ok: false, failures };
	}
	const removed = set.entries.filter((entry) => targets.has(entry));
	const remaining = set.entries.filter((entry) => !targets.has(entry));
	return { ok: true, set: { entries: remaining }, removed };
}

const ENTRY_KEYS = new Set([
	"storage",
	"name",
	"refPath",
	"displayId",
	"path",
	"body",
	"volume",
]);

/**
 * Why `value` is not a well-formed entry, or undefined when it is one. The
 * same shape check guards loading and closed decoding.
 */
function malformedEntryReason(value: unknown): string | undefined {
	if (typeof value !== "object" || value === null) {
		return "entry is not an object";
	}
	const entry = value as Record<string, unknown>;
	if (Object.keys(entry).some((key) => !ENTRY_KEYS.has(key))) {
		return "entry has an unknown field";
	}
	const storage = entry.storage;
	if (!isSkillStorage(storage)) {
		return "storage is not one of global, project, package, temp";
	}
	const { name, refPath } = entry;
	if (typeof name !== "string") {
		return "name is not a string";
	}
	if (refPath !== undefined && typeof refPath !== "string") {
		return "refPath is not a string";
	}
	if (refPath === "") {
		return "refPath is empty";
	}
	const identity = parseSkillId(formatSkillId(storage, name, refPath));
	if (
		identity.error !== undefined ||
		identity.storage !== storage ||
		identity.name !== name ||
		identity.refPath !== refPath
	) {
		return "identity is not a parseable skill id";
	}
	if (typeof entry.displayId !== "string" || entry.displayId.length === 0) {
		return "displayId is empty";
	}
	if (typeof entry.path !== "string" || entry.path.length === 0) {
		return "path is empty";
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
 * Decode a stored value. A value whose version or shape is unrecognized —
 * a malformed or duplicate entry included — decodes as an empty set, never
 * as a partial one.
 */
export function decode(value: unknown): LoadedSet {
	if (typeof value !== "object" || value === null) {
		return EMPTY_SET;
	}
	const record = value as Record<string, unknown>;
	if (
		Object.keys(record).some((key) => key !== "version" && key !== "entries") ||
		record.version !== STATE_VERSION ||
		!Array.isArray(record.entries)
	) {
		return EMPTY_SET;
	}
	const entries: StateEntry[] = [];
	const identities = new Set<string>();
	for (const raw of record.entries) {
		if (!isWellFormedEntry(raw)) {
			return EMPTY_SET;
		}
		const id = formatSkillId(raw.storage, raw.name, raw.refPath);
		if (identities.has(id)) {
			return EMPTY_SET;
		}
		identities.add(id);
		entries.push(raw);
	}
	return { entries };
}

/** Whether `value` is a well-formed entry. */
function isWellFormedEntry(value: unknown): value is StateEntry {
	return malformedEntryReason(value) === undefined;
}
