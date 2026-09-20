/**
 * Versioned result transport for the six tools (plan Task 3).
 *
 * One discriminated, closed payload family carries each tool's success
 * outcome, its empty outcome, and a failure outcome nesting the structured
 * `Failure` from failure.ts. The presentation layer reads validated payload
 * data and never parses model text: every retained field has a consumer in
 * the render design (`## 工具渲染`, `## 标识说明`):
 *
 * - `count` / `location` — collapsed rows and titles, e.g. `listed {n}
 *   skills in {Position}`; `location: null` means no selection (the design's
 *   "omitted for all") and is distinguishable from a selected position.
 * - `skills` / `matches` — expanded `- {dynamic-skill-id} {/absolute/path}`
 *   rows for list_skills and search_skills.
 * - `tags` — the expanded tag stream `{tag-name}, {tag-name}, ...`.
 * - `filters` — search_skills' `{frontmatter-kv-list}` block.
 * - `files` — expanded `- {type/file-name} {/absolute/path/to/file}` rows.
 * - `name` / `storage` — list_skill_files' `[Skill] {dynamic-skill-id} ({n})` title:
 *   the design's `{dynamic-skill-id}` is the bare name unless the name is in
 *   conflict (then the storage-qualified id); `storage: null` means "all".
 * - `id` / `path` / `content` / `lines` / `bytes` — create_skill's
 *   `Wrote {n} lines ({m}B)` / `({n} lines · {m} B)` readouts and the
 *   expanded full content; the title `[NewSkill] {dynamic-skill-id}` uses
 *   the same bare-name-unless-conflict rule (`storage` marks the target).
 *
 * The family is closed: `assertValidPayload` rejects an unsupported version,
 * an unknown tool or outcome (wrong enum), an unknown data key, and a
 * malformed nested value. An empty collection is a success outcome, never a
 * transport failure; the builders derive the empty/success split from the
 * actual count, and counts derive from the content actually written.
 */
import { FAILURE_CODES } from "./failure";
import type { Failure, FailureEvidence } from "./failure";
import { SKILL_STORAGES } from "./skill-id";
import type { SkillStorage } from "./skill-id";

/** The only supported transport version. */
export const TRANSPORT_VERSION = 1 as const;
export type TransportVersion = typeof TRANSPORT_VERSION;

export type SkillPosition = SkillStorage;
/** `null` = no selection (design: location omitted for all). */
export type Scope = SkillPosition | null;

export type ToolName =
	| "list_skills"
	| "list_skill_tags"
	| "search_skills"
	| "list_skill_files"
	| "create_skill"
	| "view_skill"
	| "peek_skill";

/** One expanded skill row: `- {dynamic-skill-id} {/absolute/path}`. */
export interface SkillRow {
	id: string;
	filePath: string;
}

/** One expanded file row: `- {type/file-name} {/absolute/path}`. */
export interface FileRow {
	refId: string;
	path: string;
}

export interface ListSkillsData {
	count: number;
	location: Scope;
	skills: readonly SkillRow[];
}

export interface ListSkillTagsData {
	count: number;
	location: Scope;
	tags: readonly string[];
}

export interface SearchSkillsData {
	count: number;
	location: Scope;
	filters: Readonly<Record<string, unknown>>;
	matches: readonly SkillRow[];
}

export interface ListSkillFilesData {
	count: number;
	/** Display id per the design's `{dynamic-skill-id}`: bare name unless the
	 *  name is in conflict, then storage-qualified (e.g. `global:git`). */
	targetId: string;
	files: readonly FileRow[];
}

export interface CreateSkillData {
	/** Display id per `{dynamic-skill-id}`; always bare here — a same-name
	 *  conflict is intercepted before creation succeeds. */
	id: string;
	path: string;
	content: string;
	lines: number;
	bytes: number;
}

export interface ViewSkillData {
	/** Display id per `{dynamic-skill-id}`: bare name unless in conflict. */
	id: string;
	path: string;
	content: string;
}
export interface PeekSkillData {
	/** Display id per `{dynamic-skill-id}`: bare name unless in conflict. */
	id: string;
	path: string;
	content: string;
	lines: number;
	bytes: number;
}

/** The closed, discriminated payload family (one variant per tool + failure). */
export type TransportPayload =
	| {
			version: 1;
			tool: "list_skills";
			outcome: "success" | "empty";
			data: ListSkillsData;
	  }
	| {
			version: 1;
			tool: "list_skill_tags";
			outcome: "success" | "empty";
			data: ListSkillTagsData;
	  }
	| {
			version: 1;
			tool: "search_skills";
			outcome: "success" | "empty";
			data: SearchSkillsData;
	  }
	| {
			version: 1;
			tool: "list_skill_files";
			outcome: "success" | "empty";
			data: ListSkillFilesData;
	  }
	| {
			version: 1;
			tool: "create_skill";
			outcome: "success";
			data: CreateSkillData;
	  }
	| { version: 1; tool: "view_skill"; outcome: "success"; data: ViewSkillData }
	| { version: 1; tool: "peek_skill"; outcome: "success"; data: PeekSkillData }
	| { version: 1; tool: ToolName; outcome: "failure"; failure: Failure };

export type ListSkillsPayload = Extract<
	TransportPayload,
	{ tool: "list_skills" }
>;
export type ListSkillTagsPayload = Extract<
	TransportPayload,
	{ tool: "list_skill_tags" }
>;
export type SearchSkillsPayload = Extract<
	TransportPayload,
	{ tool: "search_skills" }
>;
export type ListSkillFilesPayload = Extract<
	TransportPayload,
	{ tool: "list_skill_files" }
>;
export type CreateSkillPayload = Extract<
	TransportPayload,
	{ tool: "create_skill" }
>;
export type ViewSkillPayload = Extract<
	TransportPayload,
	{ tool: "view_skill" }
>;
export type PeekSkillPayload = Extract<
	TransportPayload,
	{ tool: "peek_skill" }
>;
export type FailurePayload = Extract<TransportPayload, { outcome: "failure" }>;

/** Thrown by `assertValidPayload` when a guard rejects a malformed payload. */
export class TransportGuardError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TransportGuardError";
	}
}

const TOOL_NAMES: readonly string[] = [
	"list_skills",
	"list_skill_tags",
	"search_skills",
	"list_skill_files",
	"create_skill",
	"view_skill",
	"peek_skill",
];
const POSITIONS: readonly string[] = SKILL_STORAGES;
const LIST_OUTCOMES: readonly string[] = ["success", "empty"];

/**
 * Count the lines in written text: a trailing newline does not add a line
 * (shared.ts re-exports this as the single authoritative line counter).
 */
export function countTextLines(text: string): number {
	if (text.length === 0) return 0;
	return text.endsWith("\n")
		? text.split("\n").length - 1
		: text.split("\n").length;
}

/* ---------------------------------------------------------------------- */
/* Payload builders (pure; the tools' result construction calls these)     */
/* ---------------------------------------------------------------------- */

export function buildListSkillsPayload(
	count: number,
	location: Scope,
	skills: readonly SkillRow[],
): ListSkillsPayload {
	return {
		version: TRANSPORT_VERSION,
		tool: "list_skills",
		outcome: count === 0 ? "empty" : "success",
		data: { count, location, skills },
	};
}

export function buildListSkillTagsPayload(
	count: number,
	location: Scope,
	tags: readonly string[],
): ListSkillTagsPayload {
	return {
		version: TRANSPORT_VERSION,
		tool: "list_skill_tags",
		outcome: count === 0 ? "empty" : "success",
		data: { count, location, tags },
	};
}

export function buildSearchSkillsPayload(
	count: number,
	location: Scope,
	filters: Readonly<Record<string, unknown>>,
	matches: readonly SkillRow[],
): SearchSkillsPayload {
	return {
		version: TRANSPORT_VERSION,
		tool: "search_skills",
		outcome: count === 0 ? "empty" : "success",
		data: { count, location, filters, matches },
	};
}

export function buildListSkillFilesPayload(
	count: number,
	targetId: string,
	files: readonly FileRow[],
): ListSkillFilesPayload {
	return {
		version: TRANSPORT_VERSION,
		tool: "list_skill_files",
		outcome: count === 0 ? "empty" : "success",
		data: { count, targetId, files },
	};
}

export function buildCreateSkillPayload(
	id: string,
	path: string,
	content: string,
): CreateSkillPayload {
	return {
		version: TRANSPORT_VERSION,
		tool: "create_skill",
		outcome: "success",
		data: {
			id,
			path,
			content,
			lines: countTextLines(content),
			bytes: Buffer.byteLength(content, "utf8"),
		},
	};
}

export function buildViewSkillPayload(
	id: string,
	path: string,
	content: string,
): ViewSkillPayload {
	return {
		version: TRANSPORT_VERSION,
		tool: "view_skill",
		outcome: "success",
		data: { id, path, content },
	};
}
export function buildPeekSkillPayload(
	id: string,
	path: string,
	content: string,
): PeekSkillPayload {
	return {
		version: TRANSPORT_VERSION,
		tool: "peek_skill",
		outcome: "success",
		data: {
			id,
			path,
			content,
			lines: countTextLines(content),
			bytes: Buffer.byteLength(content, "utf8"),
		},
	};
}

/** The failure outcome nests the structured failure (wired by Task 4's seam). */
export function buildFailurePayload(
	tool: ToolName,
	failure: Failure,
): FailurePayload {
	return { version: TRANSPORT_VERSION, tool, outcome: "failure", failure };
}

/* ---------------------------------------------------------------------- */
/* Guards — the closed family rejects every malformed form                */
/* ---------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failGuard(message: string): never {
	throw new TransportGuardError(message);
}

function assertExactKeys(
	record: Record<string, unknown>,
	allowed: readonly string[],
	context: string,
): void {
	const keys = Object.keys(record);
	if (
		keys.length !== allowed.length ||
		keys.some((key) => !allowed.includes(key))
	) {
		failGuard(`${context} must have exactly the keys ${allowed.join(", ")}`);
	}
}

function assertNonNegativeInteger(value: unknown, context: string): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
		failGuard(`${context} must be a non-negative integer`);
	}
	return value;
}

function assertNonEmptyString(value: unknown, context: string): string {
	if (typeof value !== "string" || value.length === 0) {
		failGuard(`${context} must be a non-empty string`);
	}
	return value;
}

function assertString(value: unknown, context: string): string {
	if (typeof value !== "string") {
		failGuard(`${context} must be a string`);
	}
	return value;
}

function assertScope(value: unknown): Scope {
	if (value === null) {
		return null;
	}
	if (typeof value === "string" && POSITIONS.includes(value)) {
		return value as SkillPosition;
	}
	failGuard(`location must be ${SKILL_STORAGES.join(", ")}, or null`);
}

function assertSkillRows(value: unknown, context: string): readonly SkillRow[] {
	if (!Array.isArray(value)) {
		failGuard(`${context} must be an array`);
	}
	for (const row of value) {
		if (!isRecord(row)) {
			failGuard(`${context} entries must be objects`);
		}
		assertExactKeys(row, ["id", "filePath"], `${context} entry`);
		assertNonEmptyString(row.id, `${context} entry id`);
		assertNonEmptyString(row.filePath, `${context} entry filePath`);
	}
	return value as readonly SkillRow[];
}

function assertFileRows(value: unknown, context: string): readonly FileRow[] {
	if (!Array.isArray(value)) {
		failGuard(`${context} must be an array`);
	}
	for (const row of value) {
		if (!isRecord(row)) {
			failGuard(`${context} entries must be objects`);
		}
		assertExactKeys(row, ["refId", "path"], `${context} entry`);
		assertNonEmptyString(row.refId, `${context} entry refId`);
		assertNonEmptyString(row.path, `${context} entry path`);
	}
	return value as readonly FileRow[];
}

function assertStringArray(value: unknown, context: string): readonly string[] {
	if (!Array.isArray(value)) {
		failGuard(`${context} must be an array`);
	}
	for (const item of value) {
		if (typeof item !== "string" || item.length === 0) {
			failGuard(`${context} entries must be non-empty strings`);
		}
	}
	return value as readonly string[];
}

function assertEvidence(value: unknown): FailureEvidence {
	if (!isRecord(value) || typeof value.kind !== "string") {
		failGuard("evidence must be an object with a kind");
	}
	switch (value.kind) {
		case "none": {
			assertExactKeys(value, ["kind"], "none evidence");
			return { kind: "none" };
		}
		case "candidates": {
			assertExactKeys(value, ["kind", "candidates"], "candidates evidence");
			const candidates = value.candidates;
			if (!Array.isArray(candidates)) {
				failGuard("candidates must be an array");
			}
			for (const candidate of candidates) {
				if (!isRecord(candidate)) {
					failGuard("candidate must be an object");
				}
				assertExactKeys(candidate, ["id", "path"], "candidate");
				assertNonEmptyString(candidate.id, "candidate id");
				assertNonEmptyString(candidate.path, "candidate path");
			}
			return { kind: "candidates", candidates } as FailureEvidence;
		}
		case "suggestions": {
			assertExactKeys(value, ["kind", "suggestions"], "suggestions evidence");
			return {
				kind: "suggestions",
				suggestions: assertStringArray(value.suggestions, "suggestions"),
			};
		}
		default:
			failGuard(`unsupported evidence kind '${String(value.kind)}'`);
	}
}

function assertFailure(value: unknown): Failure {
	if (!isRecord(value)) {
		failGuard("failure must be an object");
	}
	assertExactKeys(value, ["code", "recovery", "evidence"], "failure");
	const code = value.code;
	if (
		typeof code !== "string" ||
		!(FAILURE_CODES as readonly string[]).includes(code)
	) {
		failGuard(`failure code '${String(code)}' is not in the closed set`);
	}
	const recovery = assertNonEmptyString(value.recovery, "failure recovery");
	const evidence = assertEvidence(value.evidence);
	return { code, recovery, evidence } as Failure;
}

/**
 * Fail-closed validation of the transport payload family. Rejects an
 * unsupported version, an unknown tool or outcome, an unknown data key
 * (the family is closed), and malformed nested values.
 */
export function assertValidPayload(
	value: unknown,
): asserts value is TransportPayload {
	if (!isRecord(value)) {
		failGuard("payload must be an object");
	}
	if (value.version !== TRANSPORT_VERSION) {
		failGuard(`unsupported transport version '${String(value.version)}'`);
	}
	const tool = value.tool;
	if (typeof tool !== "string" || !TOOL_NAMES.includes(tool)) {
		failGuard(`unknown tool '${String(tool)}'`);
	}
	if (value.outcome === "failure") {
		assertExactKeys(
			value,
			["version", "tool", "outcome", "failure"],
			"failure payload",
		);
		assertFailure(value.failure);
		return;
	}
	if (
		typeof value.outcome !== "string" ||
		!LIST_OUTCOMES.includes(value.outcome)
	) {
		failGuard(`unknown outcome '${String(value.outcome)}'`);
	}
	if (!isRecord(value.data)) {
		failGuard("data must be an object");
	}
	assertExactKeys(value, ["version", "tool", "outcome", "data"], "payload");
	switch (tool as ToolName) {
		case "list_skills": {
			const data = value.data;
			assertExactKeys(data, ["count", "location", "skills"], "list_skills data");
			const count = assertNonNegativeInteger(data.count, "count");
			assertScope(data.location);
			const skills = assertSkillRows(data.skills, "skills");
			assertOutcomeMatchesCount(value.outcome, count);
			if (count !== skills.length) {
				failGuard("count must match the number of skills");
			}
			return;
		}
		case "list_skill_tags": {
			const data = value.data;
			assertExactKeys(data, ["count", "location", "tags"], "list_skill_tags data");
			const count = assertNonNegativeInteger(data.count, "count");
			assertScope(data.location);
			const tags = assertStringArray(data.tags, "tags");
			assertOutcomeMatchesCount(value.outcome, count);
			if (count !== tags.length) {
				failGuard("count must match the number of tags");
			}
			return;
		}
		case "search_skills": {
			const data = value.data;
			assertExactKeys(
				data,
				["count", "location", "filters", "matches"],
				"search_skills data",
			);
			const count = assertNonNegativeInteger(data.count, "count");
			assertScope(data.location);
			if (!isRecord(data.filters)) {
				failGuard("filters must be an object");
			}
			const matches = assertSkillRows(data.matches, "matches");
			assertOutcomeMatchesCount(value.outcome, count);
			if (count !== matches.length) {
				failGuard("count must match the number of matches");
			}
			return;
		}
		case "list_skill_files": {
			const data = value.data;
			assertExactKeys(
				data,
				["count", "targetId", "files"],
				"list_skill_files data",
			);
			const count = assertNonNegativeInteger(data.count, "count");
			assertNonEmptyString(data.targetId, "targetId");
			const files = assertFileRows(data.files, "files");
			assertOutcomeMatchesCount(value.outcome, count);
			if (count !== files.length) {
				failGuard("count must match the number of files");
			}
			return;
		}
		case "create_skill": {
			if (value.outcome !== "success") {
				failGuard("create_skill has no empty outcome");
			}
			const data = value.data;
			assertExactKeys(
				data,
				["id", "path", "content", "lines", "bytes"],
				"create_skill data",
			);
			assertNonEmptyString(data.id, "id");
			assertNonEmptyString(data.path, "path");
			const content = assertString(data.content, "content");
			const lines = assertNonNegativeInteger(data.lines, "lines");
			const bytes = assertNonNegativeInteger(data.bytes, "bytes");
			if (lines !== countTextLines(content)) {
				failGuard("lines must match the written content");
			}
			if (bytes !== Buffer.byteLength(content, "utf8")) {
				failGuard("bytes must match the written content");
			}
			return;
		}
		case "view_skill": {
			if (value.outcome !== "success") {
				failGuard("view_skill has no empty outcome");
			}
			const data = value.data;
			assertExactKeys(data, ["id", "path", "content"], "view_skill data");
			assertNonEmptyString(data.id, "id");
			assertNonEmptyString(data.path, "path");
			assertString(data.content, "content");
			return;
		}
		case "peek_skill": {
			if (value.outcome !== "success") {
				failGuard("peek_skill has no empty outcome");
			}
			const data = value.data;
			assertExactKeys(
				data,
				["id", "path", "content", "lines", "bytes"],
				"peek_skill data",
			);
			assertNonEmptyString(data.id, "id");
			assertNonEmptyString(data.path, "path");
			const content = assertString(data.content, "content");
			const lines = assertNonNegativeInteger(data.lines, "lines");
			const bytes = assertNonNegativeInteger(data.bytes, "bytes");
			if (lines !== countTextLines(content)) {
				failGuard("lines must match the written content");
			}
			if (bytes !== Buffer.byteLength(content, "utf8")) {
				failGuard("bytes must match the written content");
			}
			return;
		}
	}
}

/** The empty outcome exists exactly when the collection count is zero. */
function assertOutcomeMatchesCount(outcome: string, count: number): void {
	if ((outcome === "empty") !== (count === 0)) {
		failGuard("the empty outcome requires a zero count");
	}
}
