/**
 * tail-prompt segment accessor — the adapter boundary for this extension.
 *
 * tail-prompt is an OPTIONAL integration: this module does not import it. It
 * mirrors the facts the published contract states
 * (`tail-prompt/docs_zh-CN/api.md`):
 *
 * - The two events: "tail-prompt:register" carries one segment; a
 *   "tail-prompt:ready" receipt re-registers, so load order does not matter.
 * - The segment payload: id (re-registration replaces by id), position, and a
 *   source that is either a path tail-prompt re-reads or text the contributor
 *   keeps fresh.
 *
 * This extension contributes one segment: id "skill-tools", position 1 (the
 * contributor default), source text — the frozen body rides the registration.
 * Registering is the assembly's act; this module only shapes the payload.
 */

export const TAIL_PROMPT_REGISTER_EVENT = "tail-prompt:register";
export const TAIL_PROMPT_READY_EVENT = "tail-prompt:ready";

/** A segment's content source, as the contract states it. */
export type SegmentSource =
	| { kind: "path"; path: string }
	| { kind: "text"; text: string };

/** One registered segment, as the contract states it. */
export interface Segment {
	id: string;
	position: number;
	source: SegmentSource;
}

const SKILL_TOOLS_SEGMENT_ID = "skill-tools";
const SKILL_TOOLS_SEGMENT_POSITION = 1;

/** The one segment this extension contributes: the loaded set's text. */
export function buildSkillToolsSegment(text: string): Segment {
	return {
		id: SKILL_TOOLS_SEGMENT_ID,
		position: SKILL_TOOLS_SEGMENT_POSITION,
		source: { kind: "text", text },
	};
}
