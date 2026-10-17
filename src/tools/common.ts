/**
 * Composition every tool performs on its arguments, kept here so no tool
 * re-derives it: resolving an `id` to the entry it names and its display form,
 * and normalizing a batch argument to a list.
 *
 * Both are compositions of `discovery` and `failure` — no rule of their own.
 */
import { displaySkillId, resolveSkillId } from "../discovery/skill-id";
import type { Index, RegistryEntry } from "../discovery/types";
import { createFailure } from "../failure/create";
import type { Failure } from "../failure/types";

export type Resolved =
	| {
			readonly ok: true;
			readonly entry: RegistryEntry;
			/** The id as a reader sees it: the prefix folds when unique. */
			readonly displayId: string;
			readonly refPath?: string;
	  }
	| { readonly ok: false; readonly failure: Failure };

/** Resolve an `id` argument against the index. */
export function resolveTarget(index: Index, id: string): Resolved {
	const resolved = resolveSkillId(index, id);
	if (!resolved.ok) {
		return { ok: false, failure: resolved.failure };
	}
	return {
		ok: true,
		entry: resolved.entry,
		displayId: displaySkillId(index, resolved.entry, resolved.refPath),
		refPath: resolved.refPath,
	};
}

export type Batch =
	| { readonly ok: true; readonly ids: readonly string[] }
	| { readonly ok: false; readonly failure: Failure };

/**
 * Normalize a batch argument. A single string is a batch of one; a list must
 * hold only strings, because dropping a bad member would silently load a
 * different set than the caller asked for.
 */
export function batchIds(value: unknown): Batch {
	if (typeof value === "string") {
		return value.length === 0
			? { ok: false, failure: emptyBatch() }
			: { ok: true, ids: [value] };
	}
	if (!Array.isArray(value) || value.length === 0) {
		return { ok: false, failure: emptyBatch() };
	}
	if (!value.every((item) => typeof item === "string" && item.length > 0)) {
		return {
			ok: false,
			failure: createFailure("ID_NAME_INVALID", {
				kind: "input",
				input: value.map((item) => String(item)).join(", "),
			}),
		};
	}
	return { ok: true, ids: value as readonly string[] };
}

/**
 * A missing or non-string `id` argument: unusable input, not a missing skill.
 * The host enforces the schema before `execute` runs, so this guards a caller
 * that bypasses it.
 */
export function invalidId(value: unknown): Failure {
	return createFailure("ID_NAME_INVALID", {
		kind: "input",
		input: String(value),
	});
}

function emptyBatch(): Failure {
	return createFailure("BATCH_EMPTY", { kind: "none" });
}
