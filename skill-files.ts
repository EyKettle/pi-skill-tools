import { lstatSync, readdirSync } from "node:fs";
import type { Stats } from "node:fs";
import { join } from "node:path";
import { formatSkillId } from "./skill-id";
import type { SkillStorage } from "./skill-id";
import { createFailure } from "./failure";
import type { FailureCode, FailureEvidence } from "./failure";

export interface SkillFileEntry {
	refId: string;
	path: string;
	bytes: number;
}

export interface SkillFilesListed {
	entries: SkillFileEntry[];
	error?: undefined;
}

export interface SkillFilesError {
	error: string;
	code: FailureCode;
	evidence: FailureEvidence;
	entries?: undefined;
}

export type SkillFilesListing = SkillFilesListed | SkillFilesError;

/** Directory names that are never walked, regardless of their rank. */
const SKIPPED_DIRECTORY_NAMES = new Set(["node_modules", ".git"]);

/**
 * Display order for conventional directories (design.md §5.5); every other
 * directory ranks below them.
 */
const CONVENTIONAL_DIR_RANK: Record<string, number> = {
	references: 0,
	scripts: 1,
	templates: 2,
};

/**
 * Recursively collect every file under `baseDir` except `SKILL.md`. Skips
 * `node_modules`, `.git`, anything whose name starts with a dot, and symlinks
 * (`lstatSync` + `isSymbolicLink`, never followed). `relDir` is the POSIX
 * relative path of the directory being walked, built up as the walk descends.
 */
function collectFiles(
	storage: SkillStorage,
	name: string,
	baseDir: string,
	relDir: string,
	out: Array<{ refId: string; path: string; bytes: number; rel: string }>,
): string | undefined {
	let names: string[];
	try {
		names = readdirSync(baseDir);
	} catch (err) {
		return `cannot read skill directory '${baseDir}': ${errMessage(err)}`;
	}
	for (const entryName of names) {
		if (SKIPPED_DIRECTORY_NAMES.has(entryName) || entryName.startsWith(".")) {
			continue;
		}
		const abs = join(baseDir, entryName);
		const rel = relDir === "" ? entryName : `${relDir}/${entryName}`;
		let stats: Stats;
		try {
			stats = lstatSync(abs);
		} catch (err) {
			return `cannot inspect '${abs}': ${errMessage(err)}`;
		}
		if (stats.isSymbolicLink()) {
			continue;
		}
		if (stats.isDirectory()) {
			const subError = collectFiles(storage, name, abs, rel, out);
			if (subError !== undefined) return subError;
			continue;
		}
		if (rel === "SKILL.md") {
			continue;
		}
		out.push({
			refId: formatSkillId(storage, name, rel),
			path: abs,
			bytes: stats.size,
			rel,
		});
	}
	return undefined;
}

/**
 * List every non-SKILL.md file under a skill's `baseDir` as a ready-to-use
 * ref id (design.md §5.5). Conventional directories sort first (`references`
 * 0, `scripts` 1, `templates` 2), then everything else, each group ordered by
 * POSIX relative path. Fail-closed like the sibling modules: a missing or
 * unreadable directory yields a structured `{ error, code, evidence }`
 * result, never an exception.
 */
export function listSkillFiles(
	storage: SkillStorage,
	name: string,
	baseDir: string,
): SkillFilesListing {
	const out: Array<{
		refId: string;
		path: string;
		bytes: number;
		rel: string;
	}> = [];
	const walkError = collectFiles(storage, name, baseDir, "", out);
	if (walkError !== undefined) {
		return { ...coded(walkError, "DIR_UNREADABLE") };
	}
	out.sort((a, b) => {
		const rankA = CONVENTIONAL_DIR_RANK[a.rel.split("/")[0]] ?? 3;
		const rankB = CONVENTIONAL_DIR_RANK[b.rel.split("/")[0]] ?? 3;
		return rankA - rankB || (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0);
	});
	return { entries: out };
}

function errMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/** Attach the vocabulary's closed code and evidence to a domain error. */
function coded(
	error: string,
	code: FailureCode,
	evidence: FailureEvidence = { kind: "none" },
): { error: string; code: FailureCode; evidence: FailureEvidence } {
	const failure = createFailure(code, { evidence });
	return { error, code: failure.code, evidence: failure.evidence };
}
