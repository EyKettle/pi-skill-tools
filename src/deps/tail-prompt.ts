/**
 * The tail-prompt segment contract, mirrored.
 *
 * tail-prompt is an optional integration: this module does not import it.
 * The published contract states the two events, the segment payload (id,
 * position, source), and that the loaded set rides the registration as text.
 *
 * This extension contributes one segment: id "skill-tools", position 10, the
 * frozen body as text. Registering is the assembly's act; this module only
 * shapes the payload.
 */

export const TAIL_PROMPT_REGISTER_EVENT = "tail-prompt:register";
export const TAIL_PROMPT_READY_EVENT = "tail-prompt:ready";

/** A segment's content source, as the contract states it. */
export type SegmentSource =
	| { readonly kind: "path"; readonly path: string }
	| { readonly kind: "text"; readonly text: string };

/** One registered segment, as the contract states it. */
export interface Segment {
	readonly id: string;
	readonly position: number;
	readonly source: SegmentSource;
}

const SKILL_TOOLS_SEGMENT_ID = "skill-tools";
const SKILL_TOOLS_SEGMENT_POSITION = 10;

/** The one segment this extension contributes: the loaded set's text. */
export function buildSkillToolsSegment(text: string): Segment {
	return {
		id: SKILL_TOOLS_SEGMENT_ID,
		position: SKILL_TOOLS_SEGMENT_POSITION,
		source: { kind: "text", text },
	};
}
