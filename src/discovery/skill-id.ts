/**
 * Skill-ID addressing: `{location}:{name}/{type}/{filename.ext}`.
 *
 * The grammar is fixed; the location vocabulary is not. A colon before any
 * slash introduces a location and is checked against the index's registered
 * set, which is why parsing takes that set rather than a union type.
 */
import { createFailure } from "../failure/create";
import type { Failure } from "../failure/types";
import type { Index, RegistryEntry, SkillStorage } from "./types";

/** Pi's skill-name character set; a name outside it cannot be addressed. */
const NAME_PATTERN = /^[a-z0-9-]+$/;

/** The name rule, shared by ID parsing and index scanning. */
export function isSkillName(name: string): boolean {
	return NAME_PATTERN.test(name);
}

export interface ParsedSkillId {
	readonly location?: SkillStorage;
	readonly name: string;
	/** The related-file tail, kept raw: containment is `files/`'s judgement. */
	readonly refPath?: string;
}

export type ParseResult =
	| { readonly ok: true; readonly value: ParsedSkillId }
	| { readonly ok: false; readonly failure: Failure };

/**
 * Split an ID into its parts without judging them: `{location}:` is present
 * only when a colon precedes the first slash, and `/{type}/{file}` is absent
 * when the tail is empty. Validation belongs to the caller, because the
 * location vocabulary differs — the registry knows its set, a stored entry
 * only knows its own shape.
 */
export function splitSkillId(raw: string): ParsedSkillId {
	const colonAt = raw.indexOf(":");
	const slashAt = raw.indexOf("/");
	// A colon after the first slash belongs to the ref path's filename, not to
	// a location prefix.
	const hasLocation = colonAt !== -1 && (slashAt === -1 || colonAt < slashAt);

	const location = hasLocation ? raw.slice(0, colonAt) : undefined;
	const remainder = hasLocation ? raw.slice(colonAt + 1) : raw;

	const slash = remainder.indexOf("/");
	const name = slash === -1 ? remainder : remainder.slice(0, slash);
	const tail = slash === -1 ? undefined : remainder.slice(slash + 1);
	// `name/` names no file; it addresses the skill's main document.
	const refPath = tail === undefined || tail.length === 0 ? undefined : tail;
	return { location, name, refPath };
}

/**
 * Parse an ID against the registered locations. `{location}:` folds away when
 * the name is unique, and `/{type}/{file}` is absent when the ID names the
 * skill's main document.
 */
export function parseSkillId(
	raw: string,
	locations: readonly SkillStorage[],
): ParseResult {
	const { location, name, refPath } = splitSkillId(raw);

	if (location !== undefined && !locations.includes(location)) {
		return {
			ok: false,
			failure: createFailure("ID_LOCATION_UNKNOWN", {
				kind: "locations",
				locations: [...locations],
			}),
		};
	}

	if (!isSkillName(name)) {
		return {
			ok: false,
			failure: createFailure("ID_NAME_INVALID", {
				kind: "input",
				input: raw,
			}),
		};
	}
	return { ok: true, value: { location, name, refPath } };
}

/** The canonical ID: location-qualified, with the ref path when present. */
export function formatSkillId(
	location: SkillStorage,
	name: string,
	refPath?: string,
): string {
	const base = `${location}:${name}`;
	return refPath === undefined ? base : `${base}/${refPath}`;
}

/**
 * The ID as a reader sees it: the location prefix folds away when no other
 * location holds the name, and the ref path appears only when it points at a
 * related file.
 */
export function displaySkillId(
	index: Pick<Index, "entries">,
	entry: Pick<RegistryEntry, "location" | "name">,
	refPath?: string,
): string {
	const shared = index.entries.some(
		(other) => other.name === entry.name && other.location !== entry.location,
	);
	const base = shared ? formatSkillId(entry.location, entry.name) : entry.name;
	return refPath === undefined ? base : `${base}/${refPath}`;
}

export type SkillResolution =
	| {
			readonly ok: true;
			readonly entry: RegistryEntry;
			readonly refPath?: string;
	  }
	| { readonly ok: false; readonly failure: Failure };

/** Resolve an ID against the index; every outcome is data, never a throw. */
export function resolveSkillId(index: Index, raw: string): SkillResolution {
	const parsed = parseSkillId(
		raw,
		index.locations.map((location) => location.id),
	);
	if (!parsed.ok) {
		return parsed;
	}

	const { location, name, refPath } = parsed.value;
	const scoped = index.entries.filter(
		(entry) => location === undefined || entry.location === location,
	);
	const matches = scoped.filter((entry) => entry.name === name);

	if (matches.length === 1) {
		return { ok: true, entry: matches[0], refPath };
	}
	if (matches.length > 1) {
		return {
			ok: false,
			failure: createFailure("ID_AMBIGUOUS", {
				kind: "candidates",
				ids: matches.map((entry) => entry.id),
			}),
		};
	}
	return {
		ok: false,
		failure: createFailure("ID_NOT_FOUND", {
			kind: "suggestions",
			names: nearestNames(scoped, name),
		}),
	};
}

/** The closest distinct names, at most three, each within edit distance 3. */
function nearestNames(
	entries: readonly RegistryEntry[],
	name: string,
): string[] {
	const distanceByName = new Map<string, number>();
	for (const entry of entries) {
		if (!distanceByName.has(entry.name)) {
			distanceByName.set(entry.name, editDistance(name, entry.name));
		}
	}
	return Array.from(distanceByName.entries())
		.filter(([, distance]) => distance <= 3)
		.sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
		.slice(0, 3)
		.map(([candidate]) => candidate);
}

/** Levenshtein distance, two rolling rows. */
function editDistance(a: string, b: string): number {
	if (a.length === 0) return b.length;
	if (b.length === 0) return a.length;
	let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
	for (let i = 1; i <= a.length; i++) {
		const current = [i];
		for (let j = 1; j <= b.length; j++) {
			current[j] = Math.min(
				previous[j] + 1,
				current[j - 1] + 1,
				previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
			);
		}
		previous = current;
	}
	return previous[b.length];
}
