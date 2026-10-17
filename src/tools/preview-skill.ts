/**
 * `preview_skill`: a skill file's size and timestamps, and one section of its
 * text when a section name is given.
 *
 * The file is read whole either way; `section` decides how much of it is
 * shown, never how much is read.
 */
import { Type } from "typebox";
import { readSkillFile, resolveSkillFile } from "../files/read";
import { previewSkillText } from "../model-channel/output";
import { buildPreviewSkillPayload } from "../tui-channel/payload";
import { invalidId, resolveTarget } from "./common";
import { failureOutcome, successOutcome } from "./types";
import type { ToolDeps, ToolOutcome } from "./types";

const TOOL = "preview_skill";

export function definePreviewSkillTool(deps: ToolDeps) {
	return {
		name: TOOL,
		label: "Preview skill",
		description:
			"Show a skill file's size, line count, and timestamps, and optionally one section of its text. " +
			"The file is read whole and nothing enters the context. " +
			"A related-file suffix on `id` previews that file. " +
			"`section` is a heading title alone, without the leading `#`; common sections are `When to Use` and `Overview`. " +
			"Result: the statistics, then the `======` framed section when one was asked for, " +
			"or `Nothing to view` for an empty file.",
		parameters: Type.Object({
			id: Type.String({
				description: "The skill's ID, or its ID with a related-file suffix.",
			}),
			section: Type.Optional(
				Type.String({
					description:
						"A heading title, without the leading `#`; omitted means statistics only.",
				}),
			),
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
			const resolved = resolveSkillFile(target.entry.baseDir, target.refPath);
			if (!resolved.ok) {
				return failureOutcome(TOOL, resolved.failure);
			}
			const section =
				typeof args.section === "string" ? args.section : undefined;
			const read = readSkillFile(resolved.path, { section });
			if (!read.ok) {
				return failureOutcome(TOOL, read.failure);
			}
			return successOutcome(
				previewSkillText({
					totalLines: read.lines,
					totalBytes: read.bytes,
					createdAt: read.createdAt.toISOString(),
					updatedAt: read.updatedAt.toISOString(),
					section: read.section?.content,
				}),
				buildPreviewSkillPayload({
					totalLines: read.lines,
					sectionLines: read.section?.lines,
				}),
			);
		},
	};
}
