/**
 * `rename_skill`: rename a skill inside its location, or one related file
 * inside its type directory.
 *
 * The move is management's; the tool renders whichever of the two shapes the
 * result names.
 */
import { Type } from "typebox";
import { displaySkillId } from "../discovery/skill-id";
import { renameSkill } from "../management/rename";
import {
	movedFileText,
	renameSkillText,
} from "../model-channel/output";
import { buildRenameSkillPayload } from "../tui-channel/payload";
import { invalidId, resolveTarget } from "./common";
import { failureOutcome, successOutcome } from "./types";
import type { ToolDeps, ToolOutcome } from "./types";

const TOOL = "rename_skill";

export function defineRenameSkillTool(deps: ToolDeps) {
	return {
		name: TOOL,
		label: "Rename skill",
		description:
			"Rename a skill inside its own location, or rename one of its related files inside its type directory. " +
			"The location never changes and the file text is not rewritten, so frontmatter keeps its own wording. " +
			"`id` names the existing skill or related file; `name` is the new basename. " +
			"A name the index already holds, or a target already on disk, is a failure. " +
			"Result: `Moved path:` with the files that moved, or `Moved: /path` for a related file.",
		parameters: Type.Object({
			id: Type.String({
				description: "The existing skill's ID, or its ID with a related-file suffix.",
			}),
			name: Type.String({
				description:
					"The new basename: a skill name, or a related file's file name.",
			}),
		}),
		execute(args: Record<string, unknown>): ToolOutcome {
			if (typeof args.id !== "string") {
				return failureOutcome(TOOL, invalidId(args.id));
			}
			if (typeof args.name !== "string") {
				return failureOutcome(TOOL, invalidId(args.name));
			}
			const index = deps.index();
			const target = resolveTarget(index, args.id);
			if (!target.ok) {
				return failureOutcome(TOOL, target.failure);
			}
			const result = renameSkill(deps.management(), args.id, args.name);
			if (!result.ok) {
				return failureOutcome(TOOL, result.failure);
			}
			// Both sides of the answer are ids a reader can type back: the old one
			// from the pre-move snapshot, the new one computed for the new name.
			const from = target.displayId;
			if (result.kind === "file") {
				const to = displaySkillId(
					index,
					target.entry,
					rebaseRef(target.refPath ?? "", args.name),
				);
				return successOutcome(
					movedFileText(result.to),
					buildRenameSkillPayload({
						from,
						to,
						kind: "file",
						fileCount: 1,
					}),
				);
			}
			return successOutcome(
				renameSkillText({ path: result.to, files: result.files }),
				buildRenameSkillPayload({
					from,
					to: displaySkillId(index, {
						location: target.entry.location,
						name: args.name,
					}),
					kind: "skill",
					fileCount: result.files.length,
				}),
			);
		},
	};
}

/** The ref path a rename produces: the same directory, the new file name. */
function rebaseRef(refPath: string, name: string): string {
	const at = refPath.lastIndexOf("/");
	return at === -1 ? name : `${refPath.slice(0, at)}/${name}`;
}
