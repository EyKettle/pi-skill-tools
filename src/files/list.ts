/**
 * Listing of a skill's related files.
 *
 * Only files inside a type directory are listed: the ID grammar names a file
 * as `{skill}/{type}/{filename.ext}`, so a loose file beside `SKILL.md` has
 * no address. Hidden entries, vendor trees, and links are never followed —
 * a link could point outside the skill directory, and the read path would
 * reject it anyway.
 *
 * An unreadable directory fails the listing instead of returning a partial
 * one: a missing file the reader cannot see is worse than a stated error.
 */
import { lstatSync, readdirSync } from "node:fs";
import path from "node:path";
import { createFailure } from "../failure/create";
import type { Failure } from "../failure/types";
import type { SkillFileFailure } from "./read";

/** Directory names never walked, whatever their rank. */
const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git"]);

export interface ListedSkillFile {
	/** The path relative to the skill directory, POSIX separators. */
	readonly refPath: string;
	/** The absolute path on disk. */
	readonly path: string;
	readonly bytes: number;
}

export interface SkillFilesListing {
	readonly ok: true;
	readonly entries: readonly ListedSkillFile[];
}

export type SkillFilesList = SkillFilesListing | SkillFileFailure;

/** List the files a skill keeps under its type directories. */
export function listSkillFiles(baseDir: string): SkillFilesList {
	const entries: ListedSkillFile[] = [];
	const failure = walk(path.resolve(baseDir), "", entries, 0);
	if (failure !== undefined) {
		return { ok: false, failure };
	}
	entries.sort((a, b) =>
		a.refPath < b.refPath ? -1 : a.refPath > b.refPath ? 1 : 0,
	);
	return { ok: true, entries };
}

/**
 * One directory level. `depth` 0 is the skill directory itself: its own files
 * are the main document and loose files, so only directories are entered.
 */
function walk(
	directory: string,
	prefix: string,
	out: ListedSkillFile[],
	depth: number,
): Failure | undefined {
	let names: string[];
	try {
		names = readdirSync(directory);
	} catch (error) {
		return failureFor(directory, error);
	}

	for (const name of names) {
		if (name.startsWith(".") || SKIPPED_DIRECTORIES.has(name)) {
			continue;
		}
		const absolute = path.join(directory, name);
		let stats;
		try {
			stats = lstatSync(absolute);
		} catch (error) {
			return failureFor(absolute, error);
		}
		if (stats.isSymbolicLink()) {
			continue;
		}

		const refPath = prefix === "" ? name : `${prefix}/${name}`;
		if (stats.isDirectory()) {
			const failure = walk(absolute, refPath, out, depth + 1);
			if (failure !== undefined) {
				return failure;
			}
			continue;
		}
		if (depth > 0 && stats.isFile()) {
			out.push({ refPath, path: absolute, bytes: stats.size });
		}
	}
	return undefined;
}

function failureFor(target: string, error: unknown): Failure {
	const code = (error as NodeJS.ErrnoException | null)?.code;
	if (code === "ENOENT" || code === "ENOTDIR") {
		return createFailure("PATH_NOT_FOUND", { kind: "path", path: target });
	}
	return createFailure("READ_FAILED", {
		kind: "pathError",
		path: target,
		error: error instanceof Error ? error.message : String(error),
	});
}
