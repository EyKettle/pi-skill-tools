/**
 * File access for a skill directory: containment, whole reads, binary
 * rejection, and the section projection.
 *
 * Containment is judged on canonical paths, so a `..` segment and a symlink
 * that leaves the skill directory are the same failure. A target that does
 * not exist is still checked: the nearest existing ancestor must be inside
 * the skill directory, and a symlink component below it is rejected before
 * its target can materialize outside.
 *
 * Reads are whole and untruncated — the host's read cap does not apply here.
 * Binary content is refused by a NUL-byte sniff over the leading bytes.
 */
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { createFailure } from "../failure/create";
import type { Failure } from "../failure/types";
import { extractSection } from "./section";
import type { ExtractedSection } from "./section";

/** The leading window sniffed for a NUL byte. */
const NUL_SNIFF_BYTES = 8000;

export interface ResolvedSkillFile {
	readonly ok: true;
	readonly path: string;
}

export interface SkillFileFailure {
	readonly ok: false;
	readonly failure: Failure;
}

export type SkillFileResolution = ResolvedSkillFile | SkillFileFailure;

export interface SkillFileContent {
	readonly ok: true;
	readonly text: string;
	readonly bytes: number;
	readonly lines: number;
	readonly createdAt: Date;
	readonly updatedAt: Date;
	readonly section?: ExtractedSection;
}

export type SkillFileRead = SkillFileContent | SkillFileFailure;

export interface ReadSkillFileOptions {
	/** A heading title to project; without it the whole text is returned. */
	readonly section?: string;
}

/**
 * Resolve a reference inside `baseDir` to its canonical absolute path.
 * Without a reference the skill's main document is meant.
 */
export function resolveSkillFile(
	baseDir: string,
	refPath?: string,
): SkillFileResolution {
	const requested = refPath ?? "SKILL.md";
	if (path.isAbsolute(requested)) {
		return invalid(requested);
	}

	const base = path.resolve(baseDir);
	let baseReal: string;
	try {
		baseReal = realpathSync(base);
	} catch (error) {
		return { ok: false, failure: missingOrUnreadable(base, error) };
	}

	const target = path.resolve(base, requested);
	try {
		const real = realpathSync(target);
		return inside(baseReal, real)
			? { ok: true, path: real }
			: invalid(requested);
	} catch (error) {
		if (!isMissing(error)) {
			return { ok: false, failure: unreadable(target, error) };
		}
	}

	const located = locate(target);
	if ("error" in located) {
		return { ok: false, failure: unreadable(located.path, located.error) };
	}
	if (!inside(baseReal, located.real)) {
		return invalid(requested);
	}

	let probe = located.real;
	for (const part of [...located.missing].reverse()) {
		probe = path.join(probe, part);
		let stats;
		try {
			stats = lstatSync(probe);
		} catch (error) {
			if (isMissing(error)) {
				break;
			}
			return { ok: false, failure: unreadable(probe, error) };
		}
		if (stats.isSymbolicLink()) {
			return invalid(requested);
		}
	}
	return {
		ok: false,
		failure: createFailure("PATH_NOT_FOUND", {
			kind: "path",
			path: target,
		}),
	};
}

/**
 * Read a file whole. With `section`, the text is still read in full; the
 * projection is returned beside it, and a missing heading is a failure with
 * the section name and the file path as evidence.
 */
export function readSkillFile(
	filePath: string,
	options: ReadSkillFileOptions = {},
): SkillFileRead {
	let buffer: Buffer;
	try {
		buffer = readFileSync(filePath);
	} catch (error) {
		return { ok: false, failure: missingOrUnreadable(filePath, error) };
	}

	if (buffer.subarray(0, NUL_SNIFF_BYTES).includes(0)) {
		return {
			ok: false,
			failure: createFailure("FILE_NOT_TEXT", {
				kind: "path",
				path: filePath,
			}),
		};
	}

	let stats;
	try {
		stats = statSync(filePath);
	} catch (error) {
		return { ok: false, failure: missingOrUnreadable(filePath, error) };
	}

	const text = buffer.toString("utf8");
	const content: SkillFileContent = {
		ok: true,
		text,
		bytes: buffer.length,
		lines: countLines(text),
		createdAt: stats.birthtime,
		updatedAt: stats.mtime,
	};

	if (options.section === undefined) {
		return content;
	}
	const section = extractSection(text, options.section);
	if (section === undefined) {
		return {
			ok: false,
			failure: createFailure("SECTION_NOT_FOUND", {
				kind: "section",
				section: options.section,
				path: filePath,
			}),
		};
	}
	return { ...content, section };
}

// ---------------------------------------------------------------------------
// helpers

interface LocatedPath {
	/** The canonical path of the deepest existing ancestor. */
	readonly real: string;
	/** The components below it that do not exist, deepest first. */
	readonly missing: readonly string[];
}

/**
 * Find the deepest existing ancestor of `target`, or the error that kept the
 * walk from completing.
 */
function locate(
	target: string,
): LocatedPath | { readonly path: string; readonly error: unknown } {
	let node = target;
	const missing: string[] = [];
	for (;;) {
		try {
			return { real: realpathSync(node), missing };
		} catch (error) {
			if (!isMissing(error)) {
				return { path: node, error };
			}
			const parent = path.dirname(node);
			if (parent === node) {
				return { path: node, error };
			}
			missing.push(path.basename(node));
			node = parent;
		}
	}
}

function inside(baseReal: string, candidateReal: string): boolean {
	return (
		candidateReal === baseReal ||
		candidateReal.startsWith(baseReal + path.sep)
	);
}

function missingOrUnreadable(filePath: string, error: unknown): Failure {
	return isMissing(error)
		? createFailure("PATH_NOT_FOUND", { kind: "path", path: filePath })
		: unreadable(filePath, error);
}

function unreadable(filePath: string, error: unknown): Failure {
	return createFailure("READ_FAILED", {
		kind: "pathError",
		path: filePath,
		error: errorMessage(error),
	});
}

function invalid(input: string): SkillFileFailure {
	return {
		ok: false,
		failure: createFailure("REF_PATH_INVALID", { kind: "input", input }),
	};
}

function isMissing(error: unknown): boolean {
	const code = (error as NodeJS.ErrnoException | null)?.code;
	return code === "ENOENT" || code === "ENOTDIR";
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function countLines(text: string): number {
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
