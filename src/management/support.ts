/**
 * Helpers shared by create, rename, and remove.
 *
 * Writability is decided here once: a location the index does not know, or
 * one it knows as read-only, is the same refusal for all three operations.
 */
import { lstatSync, readdirSync } from "node:fs";
import path from "node:path";
import { createFailure } from "../failure/create";
import type { Failure } from "../failure/types";
import type { Index, RegistryLocation } from "../discovery/types";

export type LocationCheck =
	| {
			readonly ok: true;
			readonly location: RegistryLocation & { readonly path: string };
	  }
	| { readonly ok: false; readonly failure: Failure };

/** A location that can be written to; everything else is a failure. */
export function writableLocation(index: Index, id: string): LocationCheck {
	const location = index.locations.find((candidate) => candidate.id === id);
	if (location === undefined) {
		return {
			ok: false,
			failure: createFailure("ID_LOCATION_UNKNOWN", {
				kind: "locations",
				locations: index.locations.map((candidate) => candidate.id),
			}),
		};
	}
	if (!location.writable || location.path === undefined) {
		return {
			ok: false,
			failure: createFailure("LOCATION_READ_ONLY", {
				kind: "location",
				location: id,
			}),
		};
	}
	return { ok: true, location: { ...location, path: location.path } };
}

export function writeFailed(target: string, error: unknown): Failure {
	return createFailure("WRITE_FAILED", {
		kind: "pathError",
		path: target,
		error: error instanceof Error ? error.message : String(error),
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

export type FileList =
	| { readonly ok: true; readonly files: readonly string[] }
	| { readonly ok: false; readonly failure: Failure };

/** Every regular file under `root`, absolute and sorted; links are not followed. */
export function listFiles(root: string): FileList {
	const files: string[] = [];
	const error = walk(root, files);
	if (error !== undefined) {
		return { ok: false, failure: error };
	}
	files.sort();
	return { ok: true, files };
}

function walk(directory: string, out: string[]): Failure | undefined {
	let names: string[];
	try {
		names = readdirSync(directory);
	} catch (error) {
		return writeFailed(directory, error);
	}
	for (const name of names) {
		const absolute = path.join(directory, name);
		let stats;
		try {
			stats = lstatSync(absolute);
		} catch (error) {
			return writeFailed(absolute, error);
		}
		if (stats.isSymbolicLink()) {
			continue;
		}
		if (stats.isDirectory()) {
			const failure = walk(absolute, out);
			if (failure !== undefined) {
				return failure;
			}
			continue;
		}
		if (stats.isFile()) {
			out.push(absolute);
		}
	}
	return undefined;
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

/** Count the lines in written text: a trailing newline does not add a line. */
export function countLines(text: string): number {
	if (text.length === 0) {
		return 0;
	}
	let lines = 1;
	for (const character of text) {
		if (character === "\n") {
			lines += 1;
		}
	}
	return text.endsWith("\n") ? lines - 1 : lines;
}
