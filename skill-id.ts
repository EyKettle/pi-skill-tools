export type SkillStorage = "global" | "project" | "package" | "temp";
import { createFailure } from "./failure";
import type { FailureCode, FailureEvidence } from "./failure";

export const SKILL_STORAGES: readonly SkillStorage[] = [
	"global",
	"project",
	"package",
	"temp",
];

export function isSkillStorage(value: unknown): value is SkillStorage {
	return (
		typeof value === "string" &&
		(SKILL_STORAGES as readonly string[]).includes(value)
	);
}

export interface SkillIdRef {
	storage?: SkillStorage;
	name: string;
	refPath?: string;
	error?: string;
}

export interface ResolvedSkillId {
	storage: SkillStorage;
	name: string;
	error?: undefined;
}

export interface SkillIdError {
	storage?: undefined;
	name?: undefined;
	error: string;
	code: FailureCode;
	evidence: FailureEvidence;
}

export type SkillIdResolution = ResolvedSkillId | SkillIdError;

const NAME_PATTERN = /^[a-z0-9-]+$/;

/**
 * Parse `{storage}:{name}/{ref_path}`. Both `{storage}:` and `/{ref_path}`
 * are optional (design.md §4). The prefix is consumed only when it is exactly
 * one of the storage markers in SKILL_STORAGES; otherwise the whole string
 * is the name part. The name is validated against pi's `/^[a-z0-9-]+$/`.
 */
export function parseSkillId(id: string): {
	storage?: SkillStorage;
	name: string;
	refPath?: string;
	error?: string;
	code?: FailureCode;
	evidence?: FailureEvidence;
} {
	const colonAt = id.indexOf(":");
	let storage: SkillStorage | undefined;
	let remainder = id;
	if (colonAt !== -1) {
		const prefix = id.slice(0, colonAt);
		if (SKILL_STORAGES.includes(prefix as SkillStorage)) {
			storage = prefix as SkillStorage;
			remainder = id.slice(colonAt + 1);
		}
	}

	const slashAt = remainder.indexOf("/");
	let name = remainder;
	let refPath: string | undefined;
	if (slashAt !== -1) {
		name = remainder.slice(0, slashAt);
		const tail = remainder.slice(slashAt + 1);
		refPath = tail.length > 0 ? tail : undefined;
	}

	if (name.length === 0) {
		return parseError(storage, name, refPath, "skill id has an empty name", "ID_EMPTY_NAME");
	}
	if (!NAME_PATTERN.test(name)) {
		return parseError(
			storage,
			name,
			refPath,
			`invalid skill name '${name}'; names match /^[a-z0-9-]+$/ (valid storage prefixes: ${SKILL_STORAGES.join(", ")})`,
			"ID_INVALID_NAME",
		);
	}
	if (storage === undefined && colonAt !== -1 && NAME_PATTERN.test(id.slice(0, colonAt)) === false) {
		// Pre-: segment was not a valid marker and the full string failed name
		// validation — name the valid markers (design.md §4).
		return parseError(
			storage,
			name,
			refPath,
			`'${id}' is not a valid storage marker; use one of: ${SKILL_STORAGES.join(", ")}`,
			"ID_INVALID_STORAGE",
		);
	}
	return { storage, name, refPath };
}

/** Attach the vocabulary's closed code and default evidence to a parse error. */
function parseError(
	storage: SkillStorage | undefined,
	name: string,
	refPath: string | undefined,
	error: string,
	code: FailureCode,
): {
	storage?: SkillStorage;
	name: string;
	refPath?: string;
	error: string;
	code: FailureCode;
	evidence: FailureEvidence;
} {
	const failure = createFailure(code);
	return {
		storage,
		name,
		refPath,
		error,
		code: failure.code,
		evidence: failure.evidence,
	};
}

/**
 * Format `{storage}:{name}/{ref_path}` from parts (design.md §4).
 */
export function formatSkillId(
	storage: SkillStorage,
	name: string,
	refPath?: string,
): string {
	const base = `${storage}:${name}`;
	return refPath === undefined ? base : `${base}/${refPath}`;
}

/**
 * The ref path an id carries, or undefined when the id is not a string or
 * names only the skill. A malformed id carries no ref (its error is
 * classified elsewhere).
 */
export function refPathOf(id: unknown): string | undefined {
	if (typeof id !== "string") {
		return undefined;
	}
	const parsed = parseSkillId(id);
	return parsed.error === undefined ? parsed.refPath : undefined;
}

function levenshtein(a: string, b: string): number {
	const m = a.length;
	const n = b.length;
	if (m === 0) return n;
	if (n === 0) return m;
	const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j);
	for (let i = 1; i <= m; i++) {
		let prev = dp[0];
		dp[0] = i;
		for (let j = 1; j <= n; j++) {
			const tmp = dp[j];
			dp[j] = Math.min(
				dp[j] + 1,
				dp[j - 1] + 1,
				prev + (a[i - 1] === b[j - 1] ? 0 : 1),
			);
			prev = tmp;
		}
	}
	return dp[n];
}

/**
 * Collapse same-id registry copies (§3.3 shadow duplicates) into one
 * candidate. Prefers the non-shadowed copy so candidate evidence paths point
 * at the real skill, not its shadow.
 */
function dedupeById<T extends { storage: SkillStorage; name: string }>(
	entries: readonly T[],
): T[] {
	const byId = new Map<string, T>();
	for (const e of entries) {
		const id = formatSkillId(e.storage, e.name);
		const existing = byId.get(id);
		if (existing === undefined) {
			byId.set(id, e);
		} else if (
			(existing as { state?: string }).state === "shadowed" &&
			(e as { state?: string }).state !== "shadowed"
		) {
			byId.set(id, e);
		}
	}
	return Array.from(byId.values());
}

/**
 * Resolve a name against the registered entries. Without a storage prefix,
 * 0 matches → error with the ~3 nearest names by edit distance (≤ 3);
 * ≥2 matches → error listing every candidate as a full prefixed id; exactly
 * 1 → resolve. An explicit prefix restricts the lookup to that location and
 * never reports an ambiguity (design.md §4).
 */
export function resolveSkillId(
	entries: ReadonlyArray<{
		storage: SkillStorage;
		name: string;
		filePath: string;
	}>,
	storage: SkillStorage | undefined,
	name: string,
): SkillIdResolution {
	const matches = entries.filter(
		(e) => (storage === undefined || e.storage === storage) && e.name === name,
	);
	// A §3.3 shadow copy shares the winner's id (storage:name): it is the same
	// skill, not a second candidate. Dedupe by id so an explicit prefix
	// resolves uniquely (design.md §4); distinct locations stay ambiguous.
	const candidates = dedupeById(matches);
	if (candidates.length === 1) {
		return { storage: candidates[0].storage, name: candidates[0].name };
	}
	if (candidates.length > 1) {
		const ids = candidates
			.map((e) => formatSkillId(e.storage, e.name))
			.join(", ");
		const failure = createFailure("ID_AMBIGUOUS", {
			evidence: {
				kind: "candidates",
				candidates: candidates.map((e) => ({
					id: formatSkillId(e.storage, e.name),
					path: e.filePath,
				})),
			},
		});
		return {
			error: `skill id '${name}' is ambiguous (${candidates.length} matches); qualify with a storage prefix: ${ids}`,
			code: failure.code,
			evidence: failure.evidence,
		};
	}

	const scoped = entries.filter(
		(e) => storage === undefined || e.storage === storage,
	);
	const byName = new Map<string, number>();
	for (const e of scoped) {
		if (!byName.has(e.name)) byName.set(e.name, levenshtein(name, e.name));
	}
	const suggestions = Array.from(byName.entries())
		.filter(([, distance]) => distance <= 3)
		.sort((x, y) => x[1] - y[1] || x[0].localeCompare(y[0]))
		.slice(0, 3)
		.map(([n]) => n);

	const scope = storage === undefined ? "" : ` in '${storage}'`;
	const suffix =
		suggestions.length > 0
			? `; did you mean: ${suggestions.join(", ")}`
			: "";
	const failure = createFailure("ID_NOT_FOUND", {
		evidence:
			suggestions.length > 0
				? {
						kind: "candidates",
						candidates: suggestions
							.map((n) => scoped.find((e) => e.name === n))
							.filter(
								(e): e is { storage: SkillStorage; name: string; filePath: string } =>
									e !== undefined,
							)
							.map((e) => ({
								id: formatSkillId(e.storage, e.name),
								path: e.filePath,
							})),
					}
				: { kind: "none" },
	});
	return {
		error: `no skill named '${name}'${scope}${suffix}`,
		code: failure.code,
		evidence: failure.evidence,
	};

}
