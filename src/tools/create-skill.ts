/**
 * `create_skill`: write a new skill, or one related file under an existing
 * skill, from content the caller supplies whole.
 *
 * The write never overwrites and refuses a read-only location; the tool adds
 * the two channels and the line count the card prints.
 */
import { Type } from "typebox";
import { countLines } from "../files/read";
import { createSkill } from "../management/create";
import { EMPTY_CREATE, createSkillText } from "../model-channel/output";
import { buildCreateSkillPayload } from "../tui-channel/payload";
import { invalidId } from "./common";
import { failureOutcome, successOutcome } from "./types";
import type { ToolDeps, ToolOutcome } from "./types";

const TOOL = "create_skill";

export function defineCreateSkillTool(deps: ToolDeps) {
	return {
		name: TOOL,
		label: "Create skill",
		description:
			"Create a skill, or one related file under an existing skill, from the content given. " +
			"The content is written verbatim, frontmatter included; nothing is generated or repaired. " +
			"`id` names the new skill, or an existing skill plus a related-file path; `content` is the complete file text. " +
			"Creation never overwrites: a name the index already holds, or a path already on disk, is a failure. " +
			"Result: `Actual Wrote Path: /path`, or `Nothing to write` for empty content.",
		parameters: Type.Object({
			id: Type.String({
				description:
					"The new skill's ID, or an existing skill's ID plus a related-file path.",
			}),
			content: Type.String({
				description: "The complete file text, written verbatim.",
			}),
		}),
		execute(args: Record<string, unknown>): ToolOutcome {
			if (typeof args.id !== "string") {
				return failureOutcome(TOOL, invalidId(args.id));
			}
			// The schema requires a string, so a caller that bypasses it is an
			// unexpected error: throwing keeps this the one write path that never
			// changes the disk on a malformed argument.
			if (typeof args.content !== "string") {
				throw new Error("create_skill requires `content` to be a string");
			}
			const content = args.content;
			const result = createSkill(deps.management(), args.id, content);
			if (!result.ok) {
				return failureOutcome(TOOL, result.failure);
			}
			const lines = countLines(content);
			return successOutcome(
				lines === 0 ? EMPTY_CREATE : createSkillText(result.path),
				buildCreateSkillPayload({
					path: result.path,
					content,
					lines,
					bytes: result.bytes,
				}),
			);
		},
	};
}
