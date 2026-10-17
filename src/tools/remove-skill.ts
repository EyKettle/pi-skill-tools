/**
 * `remove_skill`: remove a skill directory, or one related file.
 *
 * A skill's main document names the whole skill; a related-file id names that
 * one file. The deletion is management's; the tool renders the list it
 * returns.
 */
import { Type } from "typebox";
import { removeSkill } from "../management/remove";
import { removedFileText, removeSkillText } from "../model-channel/output";
import { buildRemoveSkillPayload } from "../tui-channel/payload";
import { invalidId, resolveTarget } from "./common";
import { failureOutcome, successOutcome } from "./types";
import type { ToolDeps, ToolOutcome } from "./types";

const TOOL = "remove_skill";

export function defineRemoveSkillTool(deps: ToolDeps) {
	return {
		name: TOOL,
		label: "Remove skill",
		description:
			"Remove a skill, or one of its related files, from a writable location. " +
			"Removing a skill's main document deletes its whole directory; a related-file id deletes that one file. " +
			"`id` names the skill or the related file. " +
			"Result: `Removed folder:` with the files that left, or `Removed: /path` for a related file.",
		parameters: Type.Object({
			id: Type.String({
				description:
					"The skill's ID, or its ID with a related-file suffix.",
			}),
		}),
		execute(args: Record<string, unknown>): ToolOutcome {
			if (typeof args.id !== "string") {
				return failureOutcome(TOOL, invalidId(args.id));
			}
			const index = deps.index();
			// The card names the skill, so the display id is read before the removal
			// takes the entry out of the index.
			const target = resolveTarget(index, args.id);
			if (!target.ok) {
				return failureOutcome(TOOL, target.failure);
			}
			const result = removeSkill(deps.management(), args.id);
			if (!result.ok) {
				return failureOutcome(TOOL, result.failure);
			}
			if (result.kind === "file") {
				return successOutcome(
					removedFileText(result.path),
					buildRemoveSkillPayload({
						displayId: target.displayId,
						kind: "file",
						fileCount: 1,
					}),
				);
			}
			return successOutcome(
				removeSkillText({ path: result.path, files: result.files }),
				buildRemoveSkillPayload({
					displayId: target.displayId,
					kind: "skill",
					fileCount: result.files.length,
				}),
			);
		},
	};
}
