/**
 * Helpers shared by create, rename, and remove.
 *
 * Writability is decided here once: a location the index does not know, or
 * one it knows as read-only, is the same refusal for all three operations.
 * The file walk and the line count live in `files/` and reach this module
 * through the ports, so neither is implemented twice.
 */
import path from "node:path";
import { createFailure, errorText } from "../failure/create";
import type { Failure } from "../failure/types";
import type { Index, RegistryLocation } from "../discovery/types";
import { locationLists } from "../discovery/skill-id";

export type LocationCheck =
	| {
			readonly ok: true;
			readonly location: RegistryLocation & { readonly path: string };
	  }
	| { readonly ok: false; readonly failure: Failure };

/** A location that can be written to; everything else is a failure. */
export function writableLocation(index: Index, id: string): LocationCheck {
	const location = index.locations.find((candidate) => candidate.id === id);
	if (location === undefined || location.disabled === true) {
		const { usable, disabled } = locationLists(index.locations);
		return {
			ok: false,
			failure: createFailure("ID_LOCATION_UNKNOWN", {
				kind: "locations",
				locations: usable,
				disabled,
			}),
		};
	}
	// A write lands in the first root: the one closest to the caller.
	const [root] = location.roots ?? [];
	if (!location.writable || root === undefined) {
		return {
			ok: false,
			failure: createFailure("LOCATION_READ_ONLY", {
				kind: "location",
				location: id,
			}),
		};
	}
	return { ok: true, location: { ...location, path: root } };
}

/** Whether a skill is one document rather than a directory. */
export function isSingleFileSkill(entry: { readonly filePath: string }): boolean {
	return path.basename(entry.filePath) !== "SKILL.md";
}

export function writeFailed(target: string, error: unknown): Failure {
	return createFailure("WRITE_FAILED", {
		kind: "pathError",
		path: target,
		error: errorText(error),
	});
}

export function pathNotFound(target: string): Failure {
	return createFailure("PATH_NOT_FOUND", { kind: "path", path: target });
}

export function targetExistsId(id: string): Failure {
	return createFailure("TARGET_EXISTS", {
		kind: "conflict",
		target: { kind: "id", id },
	});
}

export function targetExistsPath(target: string): Failure {
	return createFailure("TARGET_EXISTS", {
		kind: "conflict",
		target: { kind: "path", path: target },
	});
}

/** A new related-file name: one path segment, not a dot segment. */
export function isFileName(name: string): boolean {
	return (
		name.length > 0 &&
		!name.includes("/") &&
		!name.includes("\\") &&
		name !== "." &&
		name !== ".."
	);
}

/** Whether an index entry is part of the skill the id names. */
export function sameSkill(
	entry: { readonly location: string; readonly name: string },
	location: string,
	name: string,
): boolean {
	return entry.location === location && entry.name === name;
}
