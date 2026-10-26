/**
 * `list_skill_files`: the files a skill keeps under its type directories, each
 * addressed the way an argument would spell it.
 */
import path from "node:path";
import { Type } from "typebox";
import { displaySkillId } from "../discovery/skill-id";
import { listSkillFiles } from "../files/list";
import {
	SINGLE_FILE_SKILL,
	listSkillFilesText,
} from "../model-channel/output";
import { buildListSkillFilesPayload } from "../tui-channel/payload";
import { invalidId, resolveTarget } from "./common";
import { failureOutcome, successOutcome } from "./types";
import type { ToolDeps, ToolOutcome } from "./types";

const TOOL = "list_skill_files";

export function defineListSkillFilesTool(deps: ToolDeps) {
	return {
		name: TOOL,
		label: "List skill files",
		description:
			"List the files a skill keeps under its type directories, such as references or scripts, with each file's path. " +
			"The skill's main document is not listed: it is the skill itself. " +
			"A related-file suffix on `id` is ignored. " +
			"Result: one `[skill-id] /path` line per file, " +
			"or `Single file skill has no related files` for a single-file skill.",
		parameters: Type.Object({
			id: Type.String({
				description: "The skill's ID; any related-file suffix is ignored.",
			}),
		}),
		execute(args: Record<string, unknown>): ToolOutcome {
			if (typeof args.id !== "string") {
				return failureOutcome(TOOL, invalidId(args.id));
			}
			const index = deps.index();
			const target = resolveTarget(index, args.id);
			if (!target.ok) {
				return failureOutcome(TOOL, target.failure);
			}
			// A single-file skill's directory is the discovery path, so walking
			// it would list every other skill under that path: the tool answers
			// the fixed sentence instead.
			if (path.basename(target.entry.filePath) !== "SKILL.md") {
				return successOutcome(
					SINGLE_FILE_SKILL,
					buildListSkillFilesPayload({ count: 0, singleFile: true }),
				);
			}
			const listed = listSkillFiles(target.entry.baseDir);
			if (!listed.ok) {
				return failureOutcome(TOOL, listed.failure);
			}
			const items = listed.entries.map((file) => ({
				displayId: displaySkillId(index, target.entry, file.refPath),
				path: file.path,
			}));
			return successOutcome(
				listSkillFilesText(items),
				buildListSkillFilesPayload({ count: items.length }),
			);
		},
	};
}
