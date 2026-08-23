/**
 * Write-like skill creation with conflict interception (design.md §5.6).
 *
 * `createSkill` writes `<root>/<name>/SKILL.md` with the model-supplied
 * content verbatim — frontmatter included; no frontmatter and no skeleton
 * are generated here. The storage marker comes ONLY from the id prefix: no
 * separate location parameter, a bare name defaults to `global`. Before any
 * write the call is checked — in order — against an empty index, same-name
 * registry entries (active AND shadowed), and an existing target directory;
 * every failure is a structured `{ error, code, evidence }`, never an
 * exception (fail-closed, matching the sibling modules). The write itself is
 * atomic: a temp file in the same directory, `renameSync` over the target,
 * then a post-write re-read comparison.
 */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import type { Registry, RegistryEntry } from "./registry";
import type { SkillStorage } from "./skill-id";
import { createFailure } from "./failure";
import type { FailureCode, FailureEvidence } from "./failure";

export interface CreateSkillInput {
	/** Storage marker from the id prefix; a missing prefix defaults to `global`. */
	storage?: SkillStorage;
	name: string;
	/** Complete SKILL.md content, written verbatim (frontmatter included). */
	content: string;
}

export interface CreateSkillDeps {
	registry: Registry;
	agentDir: string;
	configDirName: string;
	cwd: string;
	/** Mutation-queue hook; defaults to direct invocation (plan Task 8). */
	runExclusive?: <T>(fn: () => Promise<T>) => Promise<T>;
}

export interface CreateSkillSuccess {
	path: string;
	/** The exact text written, for rendering and line counting. */
	content: string;
	error?: undefined;
}

export interface CreateSkillFailure {
	error: string;
	code: FailureCode;
	evidence: FailureEvidence;
	path?: undefined;
}

export type CreateSkillResult = CreateSkillSuccess | CreateSkillFailure;

const EMPTY_INDEX_ERROR =
	"skill index is not yet populated; create_skill cannot run conflict interception against an empty index";

/**
 * Create a new skill. Returns the absolute written path on success or a
 * structured error otherwise; never throws. The write runs inside
 * `deps.runExclusive` when supplied so `index.ts` can serialize it through
 * pi's `withFileMutationQueue` (design §5.6).
 */
export async function createSkill(
	input: CreateSkillInput,
	deps: CreateSkillDeps,
): Promise<CreateSkillResult> {
	const storage = input.storage ?? "global";
	if (storage === "package") {
		return {
			...coded(
				"package storage is rejected: package directories are npm-managed; a write there is erased by the next install",
				"CREATE_PACKAGE_REJECTED",
			),
		};
	}
	const nameError = validateName(input.name);
	if (nameError !== undefined) {
		return { ...coded(nameError, "CREATE_NAME_REJECTED") };
	}
	if (deps.registry.indexEmpty) {
		return { ...coded(EMPTY_INDEX_ERROR, "INDEX_EMPTY") };
	}
	const existing = deps.registry.entries.filter((e) => e.name === input.name);
	if (existing.length > 0) {
		return {
			...coded(describeDuplicates(input.name, existing), "CREATE_NAME_EXISTS"),
		};
	}

	const skillDir = path.join(writeRoot(storage, deps), input.name);
	if (existsSync(skillDir)) {
		return {
			...coded(
				`target directory already exists: '${skillDir}'; create_skill never overwrites`,
				"CREATE_TARGET_EXISTS",
			),
		};
	}

	const targetPath = path.join(skillDir, "SKILL.md");
	const run = deps.runExclusive ?? runDirect;
	return await run(async () => {
		const writeError = writeSkillFileAtomic(targetPath, input.content);
		if (writeError !== undefined) {
			return { ...coded(writeError.error, writeError.code) };
		}
		return { path: targetPath, content: input.content };
	});
}

// ---------------------------------------------------------------------------
// helpers

function runDirect<T>(fn: () => Promise<T>): Promise<T> {
	return fn();
}

/** Write root per design §5.6: global → agentDir/skills, project → cwd/<configDirName>/skills. */
function writeRoot(storage: SkillStorage, deps: CreateSkillDeps): string {
	switch (storage) {
		case "project":
			return path.join(deps.cwd, deps.configDirName, "skills");
		default:
			return path.join(deps.agentDir, "skills");
	}
}

/** Reject names that could escape the skills root; names are `/^[a-z0-9-]+$/` upstream. */
function validateName(name: string): string | undefined {
	if (name.length === 0) {
		return "skill name is empty";
	}
	const segments = name.split(/[\\/]/);
	if (
		segments.some(
			(segment) => segment === "" || segment === "." || segment === "..",
		)
	) {
		return `invalid skill name '${name}': path separators and dot segments are not allowed`;
	}
	return undefined;
}

/**
 * Conflict interception (design §5.6): every same-name registry entry —
 * active or shadowed — is listed by full prefixed id and absolute path.
 */
function describeDuplicates(
	name: string,
	existing: ReadonlyArray<RegistryEntry>,
): string {
	const occurrences = existing
		.map((entry) => `  - ${entry.id} at ${entry.filePath}`)
		.join("\n");
	return `skill name '${name}' already exists (${existing.length} occurrence${existing.length === 1 ? "" : "s"} in the index):\n${occurrences}\nuse a different name`;
}

/**
 * Atomic write: same-directory temp file, rename over the target, then a
 * re-read comparison (design §5.6). Returns a structured error carrying the
 * vocabulary code on any failure, never throws.
 */
function writeSkillFileAtomic(
	targetPath: string,
	content: string,
): { error: string; code: FailureCode } | undefined {
	const tempPath = path.join(
		path.dirname(targetPath),
		`.SKILL.md.tmp-${process.pid}-${tempCounter++}`,
	);
	try {
		mkdirSync(path.dirname(targetPath), { recursive: true });
		writeFileSync(tempPath, content);
		renameSync(tempPath, targetPath);
	} catch (err) {
		try {
			rmSync(tempPath, { force: true });
		} catch {
			// best-effort cleanup of the temp file
		}
		return {
			error: `cannot write skill file '${targetPath}': ${errMessage(err)}`,
			code: "CREATE_WRITE_FAILED",
		};
	}
	try {
		if (readFileSync(targetPath, "utf8") !== content) {
			return {
				error: `post-write verification failed for '${targetPath}': the written file does not round-trip`,
				code: "CREATE_VERIFY_FAILED",
			};
		}
	} catch (err) {
		return {
			error: `cannot re-read written skill file '${targetPath}': ${errMessage(err)}`,
			code: "CREATE_VERIFY_FAILED",
		};
	}
	return undefined;
}

let tempCounter = 0;

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
