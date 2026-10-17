/**
 * The transport payload family: what the card reads from a tool result.
 *
 * One variant per tool, closed and discriminated. A payload carries the facts
 * the card and the model text both state, never a rendered sentence: each
 * channel projects the same data into its own reader's form.
 */
import type { Failure } from "../failure/types";

export const TRANSPORT_VERSION = 1 as const;

export type ToolName =
	| "list_skills"
	| "list_skill_tags"
	| "list_skill_files"
	| "preview_skill"
	| "search_skill"
	| "import_skill"
	| "cancel_skill"
	| "create_skill"
	| "rename_skill"
	| "remove_skill";

/**
 * What a card reads from `details`: the numbers it prints as `{answer}` and
 * `{info}`. The text itself is the tool result's `content`, so no payload
 * repeats it.
 */
export interface ListSkillsData {
	readonly location?: string;
	readonly count: number;
}

export interface ListSkillTagsData {
	readonly location?: string;
	readonly count: number;
}

export interface ListSkillFilesData {
	readonly count: number;
}

export interface PreviewSkillData {
	readonly totalLines: number;
	/** The projected section's line count; absent when none was asked for. */
	readonly sectionLines?: number;
}

export interface SearchSkillData {
	readonly location?: string;
	readonly count: number;
}

export interface ImportSkillData {
	/** The display id of each changed skill, in the order the change reported. */
	readonly displayIds: readonly string[];
}

export interface CancelSkillData {
	readonly displayIds: readonly string[];
}

/**
 * `create_skill` is the one card whose `{output}` is not the model text: the
 * document states the block it shows, so the path and the written body ride
 * the payload.
 */
export interface CreateSkillData {
	readonly path: string;
	readonly content: string;
	readonly lines: number;
	readonly bytes: number;
}

export interface RenameSkillData {
	readonly from: string;
	readonly to: string;
	readonly kind: "skill" | "file";
	readonly fileCount: number;
}

export interface RemoveSkillData {
	readonly displayId: string;
	readonly kind: "skill" | "file";
	readonly fileCount: number;
}

/** A successful tool result: populated, or one of the documented empty states. */
export interface Payload<T extends ToolName, D> {
	readonly version: typeof TRANSPORT_VERSION;
	readonly tool: T;
	readonly outcome: "success" | "empty";
	readonly data: D;
}

export interface FailurePayload {
	readonly version: typeof TRANSPORT_VERSION;
	readonly tool: ToolName;
	readonly outcome: "failure";
	readonly failure: Failure;
}

export type TransportPayload =
	| Payload<"list_skills", ListSkillsData>
	| Payload<"list_skill_tags", ListSkillTagsData>
	| Payload<"list_skill_files", ListSkillFilesData>
	| Payload<"preview_skill", PreviewSkillData>
	| Payload<"search_skill", SearchSkillData>
	| Payload<"import_skill", ImportSkillData>
	| Payload<"cancel_skill", CancelSkillData>
	| Payload<"create_skill", CreateSkillData>
	| Payload<"rename_skill", RenameSkillData>
	| Payload<"remove_skill", RemoveSkillData>
	| FailurePayload;

export type ListSkillsPayload = Payload<"list_skills", ListSkillsData>;
export type ListSkillTagsPayload = Payload<"list_skill_tags", ListSkillTagsData>;
export type ListSkillFilesPayload = Payload<"list_skill_files", ListSkillFilesData>;
export type PreviewSkillPayload = Payload<"preview_skill", PreviewSkillData>;
export type SearchSkillPayload = Payload<"search_skill", SearchSkillData>;
export type ImportSkillPayload = Payload<"import_skill", ImportSkillData>;
export type CancelSkillPayload = Payload<"cancel_skill", CancelSkillData>;
export type CreateSkillPayload = Payload<"create_skill", CreateSkillData>;
export type RenameSkillPayload = Payload<"rename_skill", RenameSkillData>;
export type RemoveSkillPayload = Payload<"remove_skill", RemoveSkillData>;

/** A role the card paints a run of text with. */
export type CardRole =
	| "toolTitle"
	| "customMessageLabel"
	| "text"
	| "muted"
	| "toolOutput"
	| "error"
	| "success";

/** One run of card text and the role that paints it. */
export interface CardSpan {
	readonly text: string;
	readonly role: CardRole;
}

/** A card's two slots, as the caller's render functions receive them. */
export interface CardProjection {
	/** The call slot's one line: title and arguments, or title and info. */
	readonly call: readonly CardSpan[];
	/** Expanded only: the full argument list, one line per entry. */
	readonly fullArgs: readonly string[];
	/** The result slot: one line per output line, or the answer line. */
	readonly result: readonly (readonly CardSpan[])[];
	/** A load/unload card: its labels replace both slots. */
	readonly labels?: readonly CardSpan[];
}
