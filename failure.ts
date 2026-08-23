/**
 * The shared failure vocabulary for the six tools (plan Task 1).
 *
 * One closed set of failure codes covers every failure origin the tools own;
 * every failure carries a code, an actionable recovery text, and typed
 * evidence. Later layers read a `Failure` instead of reconstructing meaning
 * from formatted error text. Evidence is machine-readable value, never a
 * preformatted display string.
 */

/** Closed set of failure codes, one per owned failure origin. */
export const FAILURE_CODES = [
	// Identity parsing (skill-id.ts parseSkillId)
	"ID_EMPTY_NAME",
	"ID_INVALID_NAME",
	"ID_INVALID_STORAGE",
	// Identity resolution (skill-id.ts resolveSkillId)
	"ID_AMBIGUOUS",
	"ID_NOT_FOUND",
	// Path containment (skill-file.ts resolveSkillFile)
	"PATH_ABSOLUTE_REF",
	"PATH_ESCAPE",
	"PATH_UNRESOLVABLE",
	// File reading (skill-file.ts readSkillFile)
	"FILE_UNREADABLE",
	"FILE_NOT_TEXT",
	"FILE_NO_FRONTMATTER",
	// Directory listing (skill-files.ts listSkillFiles)
	"DIR_UNREADABLE",
	// Creation (skill-create.ts createSkill)
	"INDEX_EMPTY",
	"CREATE_PACKAGE_REJECTED",
	"CREATE_NAME_REJECTED",
	"CREATE_NAME_EXISTS",
	"CREATE_TARGET_EXISTS",
	"CREATE_WRITE_FAILED",
	"CREATE_VERIFY_FAILED",
	// Tool seam (tools/*.ts)
	"TOOL_REF_PATH_UNSUPPORTED",
	"ENTRY_UNREACHABLE",
] as const;

export type FailureCode = (typeof FAILURE_CODES)[number];

/** A candidate pairing an identity with its verified path. */
export interface CandidateEntry {
	id: string;
	path: string;
}

/** Typed, machine-readable failure evidence. */
export type FailureEvidence =
	| { kind: "none" }
	| { kind: "candidates"; candidates: readonly CandidateEntry[] }
	| { kind: "suggestions"; suggestions: readonly string[] };

/** A structured failure: code, actionable recovery, typed evidence. */
export interface Failure {
	readonly code: FailureCode;
	readonly recovery: string;
	readonly evidence: FailureEvidence;
}

/** Thrown by `createFailure` when a guard rejects a malformed argument. */
export class FailureGuardError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "FailureGuardError";
	}
}

/** Fixed, actionable recovery text per code (model-channel guidance). */
const RECOVERY_BY_CODE: Record<FailureCode, string> = {
	ID_EMPTY_NAME: "Provide a skill name: '<storage>:<name>' or '<name>'.",
	ID_INVALID_NAME:
		"Use a name matching /^[a-z0-9-]+$/ (lowercase letters, digits, hyphens).",
	ID_INVALID_STORAGE:
		"Qualify with a valid storage prefix: global, project, package.",
	ID_AMBIGUOUS: "Qualify the name with a storage prefix to pick one location.",
	ID_NOT_FOUND:
		"Check the spelling with list_skills; a bare name resolves across all locations.",
	PATH_ABSOLUTE_REF: "Use a ref path relative to the skill directory.",
	PATH_ESCAPE:
		"Keep ref paths inside the skill directory; escaping roots are rejected.",
	PATH_UNRESOLVABLE: "Check that the skill directory exists and is readable.",
	FILE_UNREADABLE: "Check the file's existence and read permissions.",
	FILE_NOT_TEXT: "Request a text file; binary content is not supported.",
	FILE_NO_FRONTMATTER: "Add a leading '---' frontmatter block to the file.",
	DIR_UNREADABLE: "Check the skill directory's existence and read permissions.",
	INDEX_EMPTY:
		"Restart pi or run /reload so the before_agent_start hook captures the skill index.",
	CREATE_PACKAGE_REJECTED:
		"Create in global or project storage; package directories are npm-managed.",
	CREATE_NAME_REJECTED:
		"Use a single name segment without path separators or dot segments.",
	CREATE_NAME_EXISTS:
		"Pick a different name; create_skill never overwrites existing skills.",
	CREATE_TARGET_EXISTS:
		"Pick a different name; the target directory already exists.",
	CREATE_WRITE_FAILED: "Check write permissions on the target directory.",
	CREATE_VERIFY_FAILED:
		"Re-run create_skill; the written file did not round-trip.",
	TOOL_REF_PATH_UNSUPPORTED:
		"Pass a skill name only; create_skill does not accept a ref path.",
	ENTRY_UNREACHABLE:
		"Re-run the tool; the resolved skill is missing from the index.",
};

/** True when `value` is one of the closed failure codes. */
export function isFailureCode(value: unknown): value is FailureCode {
	return (
		typeof value === "string" &&
		(FAILURE_CODES as readonly string[]).includes(value)
	);
}

/** The fixed recovery text for a code. */
export function recoveryFor(code: FailureCode): string {
	return RECOVERY_BY_CODE[code];
}

/**
 * Build a structured failure from a closed code. `recovery` defaults to the
 * vocabulary's fixed text; `evidence` defaults to the none kind.
 */
export function createFailure(
	code: FailureCode,
	options: { recovery?: string; evidence?: FailureEvidence } = {},
): Failure {
	if (!isFailureCode(code)) {
		throw new FailureGuardError(
			`unknown failure code '${String(code)}' is not in the closed set`,
		);
	}
	const recovery = options.recovery ?? recoveryFor(code);
	if (recovery.trim().length === 0) {
		throw new FailureGuardError(
			`failure code '${code}' requires a non-empty recovery text`,
		);
	}
	const evidence = options.evidence ?? { kind: "none" };
	assertWellFormedEvidence(code, evidence);
	return { code, recovery, evidence };
}

/** Reject evidence that is malformed for its kind (deny by default). */
function assertWellFormedEvidence(
	code: FailureCode,
	evidence: FailureEvidence,
): void {
	switch (evidence.kind) {
		case "none":
			return;
		case "candidates":
			if (evidence.candidates.length === 0) {
				throw new FailureGuardError(
					`candidates evidence for '${code}' must be a non-empty list`,
				);
			}
			for (const candidate of evidence.candidates) {
				if (candidate.id.length === 0) {
					throw new FailureGuardError(
						`candidate evidence for '${code}' requires a non-empty id`,
					);
				}
				if (candidate.path.length === 0) {
					throw new FailureGuardError(
						`candidate evidence for '${code}' requires a non-empty path`,
					);
				}
			}
			return;
		case "suggestions":
			if (evidence.suggestions.length === 0) {
				throw new FailureGuardError(
					`suggestions evidence for '${code}' must be a non-empty list`,
				);
			}
			for (const suggestion of evidence.suggestions) {
				if (suggestion.length === 0) {
					throw new FailureGuardError(
						`suggestion evidence for '${code}' must not contain empty names`,
					);
				}
			}
			return;
		default:
			throw new FailureGuardError(
				`unsupported evidence kind '${String((evidence as { kind: string }).kind)}' for '${code}'`,
			);
	}
}
