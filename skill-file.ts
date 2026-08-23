/**
 * Verbatim, untruncated skill file reads with a realpath containment guard
 * (design.md §5.4, §7). `resolveSkillFile` canonicalizes both `baseDir` and
 * the target — or its nearest existing ancestor, so missing files still
 * surface a clean not-found — and rejects anything that escapes the skill
 * root, whether via `..` or via a symlink pointing outside. `readSkillFile`
 * never truncates: the 2000-line / 50KB cap of pi's native read does not
 * apply here (design §5.4). Binary content is rejected by a NUL-byte sniff
 * over the first 8000 bytes. Both functions are fail-closed: every failure
 * is a structured `{ error, code, evidence }` result, never an exception.
 */
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { parseFrontmatterBlock } from "./frontmatter";
import { createFailure } from "./failure";
import type { FailureCode, FailureEvidence } from "./failure";

const NUL_SNIFF_BYTES = 8000;

export interface SkillFileResolved {
	path: string;
	error?: undefined;
}

export interface SkillFilePathError {
	error: string;
	code: FailureCode;
	evidence: FailureEvidence;
	path?: undefined;
}

export type SkillFileResolution = SkillFileResolved | SkillFilePathError;

export interface SkillFileReadOptions {
	frontmatterOnly?: boolean;
}

export interface SkillFileContent {
	text: string;
	bytes: number;
	lines: number;
	error?: undefined;
}

export interface SkillFileReadError {
	error: string;
	code: FailureCode;
	evidence: FailureEvidence;
	text?: undefined;
	bytes?: undefined;
	lines?: undefined;
}

export type SkillFileReadResult = SkillFileContent | SkillFileReadError;

/**
 * Resolve a ref path inside a skill directory to an absolute canonical path.
 * `refPath` is joined to `baseDir` (defaulting to `SKILL.md`), then both the
 * target — or its nearest existing ancestor — and `baseDir` are canonicalized
 * with `realpathSync`. The target must equal `baseDir` or start with
 * `baseDir + path.sep`. Absolute ref paths are rejected outright.
 */
export function resolveSkillFile(
	baseDir: string,
	refPath?: string,
): SkillFileResolution {
	if (refPath !== undefined && path.isAbsolute(refPath)) {
		return {
			...coded(
				`absolute ref path '${refPath}' is not allowed; use a path relative to the skill directory`,
				"PATH_ABSOLUTE_REF",
			),
		};
	}
	const target =
		refPath === undefined
			? path.join(baseDir, "SKILL.md")
			: path.join(baseDir, refPath);

	let baseReal: string;
	try {
		baseReal = realpathSync(baseDir);
	} catch (err) {
		return {
			...coded(
				`cannot resolve skill directory '${baseDir}': ${errMessage(err)}`,
				"PATH_UNRESOLVABLE",
			),
		};
	}

	const ancestor = nearestExistingReal(target);
	if (ancestor.error !== undefined) {
		return { ...coded(ancestor.error, ancestor.code) };
	}
	if (
		ancestor.real !== baseReal &&
		!ancestor.real.startsWith(baseReal + path.sep)
	) {
		return {
			...coded(
				`path '${target}' escapes skill directory '${baseDir}'`,
				"PATH_ESCAPE",
			),
		};
	}
	return { path: ancestor.real };
}

/**
 * Read a skill file verbatim and untruncated. Reports the byte size and line
 * count of the returned text so callers can see the volume received. When
 * `frontmatterOnly` is set, only the leading frontmatter block is returned;
 * a file without frontmatter is an error (design §5.4).
 */
export function readSkillFile(
	filePath: string,
	options: SkillFileReadOptions = {},
): SkillFileReadResult {
	let buf: Buffer;
	try {
		buf = readFileSync(filePath);
	} catch (err) {
		return {
			...coded(`cannot read '${filePath}': ${errMessage(err)}`, "FILE_UNREADABLE"),
		};
	}
	if (buf.subarray(0, NUL_SNIFF_BYTES).includes(0)) {
		return {
			...coded(
				`not a text file '${filePath}': contains a NUL byte within the first ${NUL_SNIFF_BYTES} bytes`,
				"FILE_NOT_TEXT",
			),
		};
	}

	let text = buf.toString("utf8");
	if (options.frontmatterOnly) {
		const parsed = parseFrontmatterBlock(text);
		if (parsed.raw === undefined) {
			return {
				...coded(`no frontmatter block in '${filePath}'`, "FILE_NO_FRONTMATTER"),
			};
		}
		text = text.slice(0, parsed.bodyStart);
	}
	return {
		text,
		bytes: Buffer.byteLength(text, "utf8"),
		lines: countLines(text),
	};
}

/**
 * Canonicalize `target`, walking up to the nearest existing ancestor when
 * parts of the path do not exist yet. The missing tail is re-appended to the
 * ancestor's real path so a not-found target still resolves to its eventual
 * absolute location (and still fails containment when it would escape). Each
 * existing tail component is lstat'ed: a dangling symlink looks like a missing
 * component to `realpathSync` but is rejected because following it could
 * escape the skill root.
 */
function nearestExistingReal(
	target: string,
): { real: string; error?: undefined } | { error: string; code: FailureCode; real?: undefined } {
	let node = target;
	const tail: string[] = [];
	for (;;) {
		try {
			const real = realpathSync(node);
			if (tail.length === 0) return { real };
			// realpathSync reports a DANGLING symlink (an entry whose target
			// does not exist) as ENOENT, so the walk above treats it as a
			// missing component and re-appends it to the canonical path — but
			// the link entry itself exists, and following it would escape the
			// skill root the moment its target materializes. Lstat every
			// existing component of the tail so the returned path is always
			// canonical (realpath-safe).
			const symlinkError = rejectTailSymlink(node, tail);
			if (symlinkError !== undefined) return symlinkError;
			return { real: path.join(real, ...tail.reverse()) };
		} catch (err) {
			if (!isNotFound(err)) {
				return {
					error: `cannot resolve path '${target}': ${errMessage(err)}`,
					code: "PATH_UNRESOLVABLE",
				};
			}
			const parent = path.dirname(node);
			if (parent === node) {
				return {
					error: `cannot resolve path '${target}'`,
					code: "PATH_UNRESOLVABLE",
				};
			}
			tail.push(path.basename(node));
			node = parent;
		}
	}
}

/**
 * Walk the missing tail from the deepest existing ancestor downward in the
 * original lexical namespace and lstat each existing component. The first
 * symlink found yields an escape rejection; a genuinely missing component
 * stops the walk (nothing below it can exist either). Non-ENOENT failures
 * (e.g. permission denied) are surfaced as resolve errors.
 */
function rejectTailSymlink(
	node: string,
	tail: string[],
): { error: string; code: FailureCode } | undefined {
	let probe = node;
	for (const part of [...tail].reverse()) {
		probe = path.join(probe, part);
		try {
			if (lstatSync(probe).isSymbolicLink()) {
				return {
					error: `path '${probe}' escapes the skill directory: symlink components in the target path are not followed`,
					code: "PATH_ESCAPE",
				};
			}
		} catch (err) {
			if (!isNotFound(err)) {
				return {
					error: `cannot resolve path '${probe}': ${errMessage(err)}`,
					code: "PATH_UNRESOLVABLE",
				};
			}
			return undefined;
		}
	}
	return undefined;
}

function countLines(text: string): number {
	if (text.length === 0) return 0;
	return text.endsWith("\n")
		? text.split("\n").length - 1
		: text.split("\n").length;
}

function isNotFound(err: unknown): boolean {
	return (
		typeof err === "object" &&
		err !== null &&
		(err as NodeJS.ErrnoException).code === "ENOENT"
	);
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
