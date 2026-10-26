/**
 * Payload construction and the runtime guard.
 *
 * A builder derives the outcome from the data — an empty list is the empty
 * state — so a caller cannot mark a populated result empty. The guard exists
 * because a tool result's details can be re-read from a session: every shape
 * is closed, and an unknown key, version, tool, or nested value rejects the
 * whole payload.
 *
 * A payload carries only what the card prints as `{answer}` and `{info}`. The
 * text the reader sees is the tool result's `content`, so nothing here repeats
 * it.
 */
import { isFailureCode } from "../failure/codes";
import { isRecord } from "../shared/predicates";
import type { Failure } from "../failure/types";
import { TRANSPORT_VERSION } from "./types";
import type {
	CancelSkillData,
	CancelSkillPayload,
	CreateSkillData,
	CreateSkillPayload,
	FailurePayload,
	ImportSkillData,
	ImportSkillPayload,
	ListSkillFilesData,
	ListSkillFilesPayload,
	ListSkillsData,
	ListSkillsPayload,
	ListSkillTagsData,
	ListSkillTagsPayload,
	PreviewSkillData,
	PreviewSkillPayload,
	RemoveSkillData,
	RemoveSkillPayload,
	RenameSkillData,
	RenameSkillPayload,
	SearchSkillData,
	SearchSkillPayload,
	ToolName,
	TransportPayload,
} from "./types";

export function buildListSkillsPayload(data: ListSkillsData): ListSkillsPayload {
	return payload("list_skills", data, data.count === 0);
}

export function buildListSkillTagsPayload(
	data: ListSkillTagsData,
): ListSkillTagsPayload {
	return payload("list_skill_tags", data, data.count === 0);
}

export function buildListSkillFilesPayload(
	data: ListSkillFilesData,
): ListSkillFilesPayload {
	return payload("list_skill_files", data, data.count === 0);
}

export function buildPreviewSkillPayload(
	data: PreviewSkillData,
): PreviewSkillPayload {
	return payload("preview_skill", data, data.totalLines === 0);
}

export function buildSearchSkillPayload(
	data: SearchSkillData,
): SearchSkillPayload {
	return payload("search_skill", data, data.count === 0);
}

export function buildImportSkillPayload(
	data: ImportSkillData,
): ImportSkillPayload {
	return payload("import_skill", data, false);
}

export function buildCancelSkillPayload(
	data: CancelSkillData,
): CancelSkillPayload {
	return payload("cancel_skill", data, false);
}

export function buildCreateSkillPayload(
	data: CreateSkillData,
): CreateSkillPayload {
	return payload("create_skill", data, data.lines === 0);
}

export function buildRenameSkillPayload(
	data: RenameSkillData,
): RenameSkillPayload {
	return payload("rename_skill", data, false);
}

export function buildRemoveSkillPayload(
	data: RemoveSkillData,
): RemoveSkillPayload {
	return payload("remove_skill", data, false);
}

export function buildFailurePayload(
	tool: ToolName,
	failure: Failure,
): FailurePayload {
	return {
		version: TRANSPORT_VERSION,
		tool,
		outcome: "failure",
		failure,
	};
}

function payload<T extends ToolName, D>(
	tool: T,
	data: D,
	empty: boolean,
): {
	readonly version: typeof TRANSPORT_VERSION;
	readonly tool: T;
	readonly outcome: "success" | "empty";
	readonly data: D;
} {
	return {
		version: TRANSPORT_VERSION,
		tool,
		outcome: empty ? "empty" : "success",
		data,
	};
}

// ---------------------------------------------------------------------------
// guard

const TOOLS: readonly ToolName[] = [
	"list_skills",
	"list_skill_tags",
	"list_skill_files",
	"preview_skill",
	"search_skill",
	"import_skill",
	"cancel_skill",
	"create_skill",
	"rename_skill",
	"remove_skill",
];

/** Tools whose card carries a documented empty state. */
const EMPTY_CAPABLE = new Set<ToolName>([
	"list_skills",
	"list_skill_tags",
	"list_skill_files",
	"preview_skill",
	"search_skill",
	"create_skill",
]);

const EVIDENCE_KINDS = new Set([
	"none",
	"input",
	"locations",
	"suggestions",
	"candidates",
	"path",
	"pathError",
	"section",
	"filter",
	"loaded",
	"location",
	"conflict",
]);

/** Whether `value` is one payload of the closed family. */
export function isTransportPayload(value: unknown): value is TransportPayload {
	if (!isRecord(value)) {
		return false;
	}
	if (value.version !== TRANSPORT_VERSION) {
		return false;
	}
	if (typeof value.tool !== "string" || !isToolName(value.tool)) {
		return false;
	}
	if (value.outcome === "failure") {
		return (
			exactKeys(value, ["version", "tool", "outcome", "failure"]) &&
			isFailure(value.failure)
		);
	}
	if (value.outcome !== "success" && value.outcome !== "empty") {
		return false;
	}
	if (!exactKeys(value, ["version", "tool", "outcome", "data"])) {
		return false;
	}
	if (value.outcome === "empty" && !EMPTY_CAPABLE.has(value.tool)) {
		return false;
	}
	return dataIsValid(value.tool, value.data);
}

function dataIsValid(tool: ToolName, data: unknown): boolean {
	if (!isRecord(data)) {
		return false;
	}
	switch (tool) {
		case "list_skills":
		case "list_skill_tags":
		case "search_skill":
			return (
				keysAllowed(data, ["count"], ["location"]) &&
				optionalString(data.location) &&
				nonNegativeInteger(data.count)
			);
		case "list_skill_files":
			return (
				keysAllowed(data, ["count"], ["singleFile"]) &&
				nonNegativeInteger(data.count) &&
				(data.singleFile === undefined || typeof data.singleFile === "boolean")
			);
		case "preview_skill":
			return (
				keysAllowed(data, ["totalLines"], ["sectionLines"]) &&
				nonNegativeInteger(data.totalLines) &&
				(data.sectionLines === undefined ||
					nonNegativeInteger(data.sectionLines))
			);
		case "import_skill":
		case "cancel_skill":
			return exactKeys(data, ["displayIds"]) && stringArray(data.displayIds);
		case "create_skill":
			return (
				exactKeys(data, ["path", "content", "lines", "bytes"]) &&
				typeof data.path === "string" &&
				typeof data.content === "string" &&
				nonNegativeInteger(data.lines) &&
				nonNegativeInteger(data.bytes)
			);
		case "rename_skill":
			return (
				exactKeys(data, ["from", "to", "kind", "fileCount"]) &&
				typeof data.from === "string" &&
				typeof data.to === "string" &&
				(data.kind === "skill" || data.kind === "file") &&
				nonNegativeInteger(data.fileCount)
			);
		case "remove_skill":
			return (
				exactKeys(data, ["displayId", "kind", "fileCount"]) &&
				typeof data.displayId === "string" &&
				(data.kind === "skill" || data.kind === "file") &&
				nonNegativeInteger(data.fileCount)
			);
		default:
			return false;
	}
}

function isFailure(value: unknown): value is Failure {
	return (
		isRecord(value) &&
		exactKeys(value, ["code", "recovery", "evidence"]) &&
		typeof value.code === "string" &&
		isFailureCode(value.code) &&
		typeof value.recovery === "string" &&
		value.recovery.trim().length > 0 &&
		isRecord(value.evidence) &&
		typeof value.evidence.kind === "string" &&
		EVIDENCE_KINDS.has(value.evidence.kind)
	);
}

function isToolName(value: string): value is ToolName {
	return (TOOLS as readonly string[]).includes(value);
}



function exactKeys(
	value: Record<string, unknown>,
	keys: readonly string[],
): boolean {
	return keysAllowed(value, keys, []);
}

/**
 * A closed shape: every present key is named, and every required key is
 * present. Optional keys may be absent or `undefined` after a round trip.
 */
function keysAllowed(
	value: Record<string, unknown>,
	required: readonly string[],
	optional: readonly string[],
): boolean {
	const present = Object.keys(value);
	return (
		present.every((key) => required.includes(key) || optional.includes(key)) &&
		required.every((key) => Object.hasOwn(value, key))
	);
}

function optionalString(value: unknown): boolean {
	return value === undefined || typeof value === "string";
}

function stringArray(value: unknown): boolean {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function nonNegativeInteger(value: unknown): boolean {
	return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
