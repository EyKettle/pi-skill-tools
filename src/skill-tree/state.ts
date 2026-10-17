/**
 * The loaded set and its algebra.
 *
 * The unit is one file: a skill's main document and each related file are
 * separate entries. An entry's identity is its fully expanded id — the
 * location prefix always present, a related file appending its ref path.
 * Loading reports Loaded, Refreshed, or Unchanged; a replacement keeps its
 * slot, so the set stays in load order. A cancel target reaches the entry it
 * names and every entry below it.
 *
 * The copy is encoded closed: a value whose version or shape is not
 * recognized decodes as absent, never as a partial set.
 */
import { isSkillName, splitSkillId } from "../discovery/skill-id";
import type { ParsedSkillId } from "../discovery/skill-id";
import { COPY_VERSION } from "./types";

export { COPY_VERSION };
import type { ChangeOutcome, LoadedSet, StateEntry, StoredCopy } from "./types";

/** The parsed parts of a fully expanded entry id. */
export interface LoadedIdentity {
	readonly location: string;
	readonly name: string;
	readonly refPath?: string;
}

/**
 * Read a fully expanded id into its parts; undefined when it is not one.
 *
 * The split is `discovery/`'s: an entry id must carry a location and a name
 * the ID grammar accepts, but the location set is the registry's business, so
 * no set is consulted here.
 */
export function identityOf(id: string): LoadedIdentity | undefined {
	// A stored id is canonical: a trailing separator names no file and would
	// not reproduce itself, so it is not an entry identity.
	if (id.endsWith("/")) {
		return undefined;
	}
	const { location, name, refPath } = splitSkillId(id);
	if (location === undefined || !isSkillName(location) || !isSkillName(name)) {
		return undefined;
	}
	return { location, name, refPath };
}

/** Whether `value` is a well-formed loaded entry. */
export function isStateEntry(value: unknown): value is StateEntry {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const entry = value as Record<string, unknown>;
	if (
		Object.keys(entry).some(
			(key) => key !== "id" && key !== "path" && key !== "body",
		)
	) {
		return false;
	}
	return (
		typeof entry.id === "string" &&
		identityOf(entry.id) !== undefined &&
		typeof entry.path === "string" &&
		entry.path.startsWith("/") &&
		typeof entry.body === "string"
	);
}

/**
 * Add or replace one entry; the outcome names what the set did.
 *
 * A replacement carries the body alone — the commit table gives it no path —
 * so an entry's path is fixed at its first load. A reload with the same body
 * is Unchanged even when the file moved, and a body change keeps the original
 * path, which is what folding the appended entry reproduces.
 */
export function loadEntry(
	state: LoadedSet,
	entry: StateEntry,
): { readonly state: LoadedSet; readonly outcome: ChangeOutcome } {
	const at = state.findIndex((existing) => existing.id === entry.id);
	if (at === -1) {
		return { state: [...state, entry], outcome: "Loaded" };
	}
	const existing = state[at];
	if (existing.body === entry.body) {
		return { state, outcome: "Unchanged" };
	}
	const next = [...state];
	next[at] = { ...existing, body: entry.body };
	return { state: next, outcome: "Refreshed" };
}

/** Remove every entry whose id is in `ids`, keeping the rest in order. */
export function removeIds(
	state: LoadedSet,
	ids: readonly string[],
): LoadedSet {
	const doomed = new Set(ids);
	return state.filter((entry) => !doomed.has(entry.id));
}

/**
 * The entries a cancel target reaches: the same name — and the same location
 * when the target names one — with the entry's ref path equal to the target's
 * or below it. A main-document target carries no ref path and reaches every
 * related file of that identity.
 */
export function cascadeTargets(
	state: LoadedSet,
	target: ParsedSkillId,
): StateEntry[] {
	return state.filter((entry) => {
		const identity = identityOf(entry.id);
		if (identity === undefined || identity.name !== target.name) {
			return false;
		}
		if (target.location !== undefined && identity.location !== target.location) {
			return false;
		}
		if (target.refPath === undefined) {
			return true;
		}
		return (
			identity.refPath === target.refPath ||
			identity.refPath?.startsWith(`${target.refPath}/`) === true
		);
	});
}

/** The distinct locations among entries, in encounter order. */
export function distinctLocations(entries: readonly StateEntry[]): string[] {
	const seen: string[] = [];
	for (const entry of entries) {
		const identity = identityOf(entry.id);
		if (identity !== undefined && !seen.includes(identity.location)) {
			seen.push(identity.location);
		}
	}
	return seen;
}

/** Encode the set for session state. */
export function encodeCopy(state: LoadedSet, marker: string): StoredCopy {
	return {
		version: COPY_VERSION,
		marker,
		entries: state.map((entry) => ({ ...entry })),
	};
}

/**
 * Decode a stored copy, or undefined when the value is not one. A value with
 * an unrecognized version, an unknown field, a malformed or duplicate entry
 * decodes as absent.
 */
export function decodeCopy(value: unknown): StoredCopy | undefined {
	if (typeof value !== "object" || value === null) {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	if (
		Object.keys(record).some(
			(key) => key !== "version" && key !== "marker" && key !== "entries",
		) ||
		record.version !== COPY_VERSION ||
		typeof record.marker !== "string" ||
		!Array.isArray(record.entries)
	) {
		return undefined;
	}
	const entries: StateEntry[] = [];
	const identities = new Set<string>();
	for (const raw of record.entries) {
		if (!isStateEntry(raw) || identities.has(raw.id)) {
			return undefined;
		}
		identities.add(raw.id);
		entries.push({ id: raw.id, path: raw.path, body: raw.body });
	}
	return { version: COPY_VERSION, marker: record.marker, entries };
}
