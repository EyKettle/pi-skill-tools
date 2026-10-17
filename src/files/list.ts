/**
 * Directory traversal: one walk under the caller's policy, and the listing a
 * skill's related files uses.
 *
 * A skill's related files and a skill directory's whole contents are the same
 * traversal under different rules: what counts as hidden, which directories
 * are ignored, and how deep a file may sit. The walk never follows a link — a
 * link could point outside the directory being walked — and an unreadable
 * directory fails the walk instead of returning a partial list.
 *
 * Only files inside a type directory are addressable: the ID grammar names a
 * file as `{skill}/{type}/{filename.ext}`, so a loose file beside `SKILL.md`
 * has no address.
 */
import { lstatSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Failure } from "../failure/types";
import { failureForPath } from "./read";
import type { SkillFileFailure } from "./read";

export interface WalkPolicy {
	/** Skip entries whose name starts with a dot. */
	readonly skipHidden: boolean;
	/** Directory names never entered. */
	readonly ignoredDirectories: ReadonlySet<string>;
	/** Files at this depth or deeper are reported; 0 is the root itself. */
	readonly minDepth: number;
}

export interface WalkedFile {
	/** The path relative to the root, POSIX separators. */
	readonly refPath: string;
	/** The absolute path on disk. */
	readonly path: string;
	readonly bytes: number;
}

export type WalkResult =
	| { readonly ok: true; readonly files: readonly WalkedFile[] }
	| { readonly ok: false; readonly failure: Failure };

/** Walk `root` under `policy`, reporting every regular file that passes it. */
export function walkFiles(root: string, policy: WalkPolicy): WalkResult {
	const files: WalkedFile[] = [];
	const failure = visit(path.resolve(root), "", 0, policy, files);
	if (failure !== undefined) {
		return { ok: false, failure };
	}
	files.sort((a, b) =>
		a.refPath < b.refPath ? -1 : a.refPath > b.refPath ? 1 : 0,
	);
	return { ok: true, files };
}

/** Directory names never walked for a skill's related files. */
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
	const walked = walkFiles(baseDir, {
		skipHidden: true,
		ignoredDirectories: SKIPPED_DIRECTORIES,
		// Depth 0 holds the main document and loose files; both are unaddressed.
		minDepth: 1,
	});
	if (!walked.ok) {
		return { ok: false, failure: walked.failure };
	}
	return { ok: true, entries: walked.files };
}

function visit(
	directory: string,
	prefix: string,
	depth: number,
	policy: WalkPolicy,
	out: WalkedFile[],
): Failure | undefined {
	let names: string[];
	try {
		names = readdirSync(directory);
	} catch (error) {
		return failureForPath(directory, error);
	}

	for (const name of names) {
		if (policy.skipHidden && name.startsWith(".")) {
			continue;
		}
		if (policy.ignoredDirectories.has(name)) {
			continue;
		}
		const absolute = path.join(directory, name);
		let stats;
		try {
			stats = lstatSync(absolute);
		} catch (error) {
			return failureForPath(absolute, error);
		}
		if (stats.isSymbolicLink()) {
			continue;
		}

		const refPath = prefix === "" ? name : `${prefix}/${name}`;
		if (stats.isDirectory()) {
			const failure = visit(absolute, refPath, depth + 1, policy, out);
			if (failure !== undefined) {
				return failure;
			}
			continue;
		}
		if (depth >= policy.minDepth && stats.isFile()) {
			out.push({ refPath, path: absolute, bytes: stats.size });
		}
	}
	return undefined;
}
