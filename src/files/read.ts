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
import { createFailure, errorText } from "../failure/create";
import type { Failure } from "../failure/types";
import { parseSections } from "./section";
import type { SectionDocument } from "./section";

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
	/** The headings of the file, with the positions they stand at. */
	readonly sections: SectionDocument;
}

export type SkillFileRead = SkillFileContent | SkillFileFailure;


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
		return { ok: false, failure: failureForPath(base, error) };
	}

	const target = path.resolve(base, requested);
	try {
		const real = realpathSync(target);
		return inside(baseReal, real)
			? { ok: true, path: real }
			: invalid(requested);
	} catch (error) {
		if (!isMissing(error)) {
			return { ok: false, failure: failureForPath(target, error) };
		}
	}

	const located = locate(target);
	if ("error" in located) {
		return { ok: false, failure: failureForPath(located.path, located.error) };
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
			return { ok: false, failure: failureForPath(probe, error) };
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
 * Read a file whole. The read carries the text and the heading representation
 * of that same text, so every question about the file's sections is answered
 * from one read.
 */
export function readSkillFile(filePath: string): SkillFileRead {
	let buffer: Buffer;
	try {
		buffer = readFileSync(filePath);
	} catch (error) {
		return { ok: false, failure: failureForPath(filePath, error) };
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
		return { ok: false, failure: failureForPath(filePath, error) };
	}

	const text = buffer.toString("utf8");
	return {
		ok: true,
		text,
		bytes: buffer.length,
		lines: countLines(text),
		createdAt: stats.birthtime,
		updatedAt: stats.mtime,
		sections: parseSections(text, filePath),
	};
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

/**
 * The failure a filesystem error becomes: a missing target is its own code,
 * anything else is a read failure carrying the underlying message. The one
 * mapping for every read and walk in this module tree.
 */
export function failureForPath(filePath: string, error: unknown): Failure {
	if (isMissing(error)) {
		return createFailure("PATH_NOT_FOUND", { kind: "path", path: filePath });
	}
	return createFailure("READ_FAILED", {
		kind: "pathError",
		path: filePath,
		error: errorText(error),
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



/**
 * Count the lines in text: a trailing newline does not add a line, so the
 * count matches what an editor shows. The one definition in the tree.
 */
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
