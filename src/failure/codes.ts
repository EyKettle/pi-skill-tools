/**
 * The closed failure-code set and the one recovery each code owns.
 *
 * A code names an exception class, never an incident: the incident's details
 * go into evidence, and the recovery is the next executable step. The table
 * that defines this set is `docs_zh-CN/architecture.md` → 闭集错误码体系;
 * adding or dropping a code is a design change.
 */
import type { FailureCode } from "./types";

/** Every code in the closed set. */
export const FAILURE_CODES: readonly FailureCode[] = [
	"ID_NAME_INVALID",
	"ID_LOCATION_UNKNOWN",
	"ID_NOT_FOUND",
	"ID_AMBIGUOUS",
	"REF_PATH_INVALID",
	"PATH_NOT_FOUND",
	"READ_FAILED",
	"FILE_NOT_TEXT",
	"SECTION_NOT_FOUND",
	"FILTER_INVALID",
	"BATCH_EMPTY",
	"NOT_LOADED",
	"LOCATION_READ_ONLY",
	"TARGET_EXISTS",
	"WRITE_FAILED",
];

/**
 * One recovery per code. The map is total by type: a code added to
 * `FailureCode` without a recovery text fails compilation.
 */
const RECOVERY_BY_CODE: Record<FailureCode, string> = {
	ID_NAME_INVALID:
		"Use a name of lowercase letters, digits, and hyphens only.",
	ID_LOCATION_UNKNOWN:
		"Drop the location prefix when the name is unique, or use a registered location.",
	ID_NOT_FOUND: "Find the name with list_skills or search_skill.",
	ID_AMBIGUOUS: "Retry with the full ID, including its location prefix.",
	REF_PATH_INVALID: "Use a relative path inside the skill directory.",
	PATH_NOT_FOUND: "Confirm the available files with list_skill_files.",
	READ_FAILED:
		"Check permissions on that path; the skill is unavailable while it cannot be read.",
	FILE_NOT_TEXT:
		"Read a text file instead; binary content is not readable with this tool.",
	SECTION_NOT_FOUND:
		"Omit section to read the whole file, or choose another section name.",
	FILTER_INVALID: "Fix the pattern, or use a plain string.",
	BATCH_EMPTY: "Provide at least one ID.",
	NOT_LOADED: "Confirm with /skill:loaded, then cancel an ID it lists.",
	LOCATION_READ_ONLY:
		"Use a writable location, or mark that location writable in the configuration.",
	TARGET_EXISTS: "Choose another name, or remove the existing object first.",
	WRITE_FAILED: "Check permissions and free space, then retry.",
};

/** True when `value` is one of the closed set's codes. */
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
