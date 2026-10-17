/**
 * `import_skill`: load a skill, or several, into the tree.
 *
 * The load is the tree's use case; the tool hands it the index and the ids,
 * then renders the rows it returns onto both channels.
 */
import { Type } from "typebox";
import { changeSkillText } from "../model-channel/output";
import { buildImportSkillPayload } from "../tui-channel/payload";
import { batchIds } from "./common";
import { failureOutcome, successOutcome } from "./types";
import type { ToolDeps, ToolOutcome } from "./types";

const TOOL = "import_skill";

export function defineImportSkillTool(deps: ToolDeps) {
	return {
		name: TOOL,
		label: "Import skill",
		description:
			"Load a skill, or several, so its body joins the context once and stays addressable. " +
			"A load refreshes what the same id already holds; loading a skill does not load its related files. " +
			"`id` takes one skill ID or a list, and a related-file suffix loads that one file. " +
			"A batch is atomic: one failing id leaves the whole set untouched. " +
			"Result: the action and the ids it applied to, such as `Loaded [git][pi]`.",
		parameters: Type.Object({
			id: Type.Union([Type.String(), Type.Array(Type.String())], {
				description: "One skill ID, or a list of them.",
			}),
		}),
		execute(args: Record<string, unknown>): ToolOutcome {
			const batch = batchIds(args.id);
			if (!batch.ok) {
				return failureOutcome(TOOL, batch.failure);
			}
			const result = deps.tree.importSkills(deps.index(), batch.ids);
			if (!result.ok) {
				return failureOutcome(TOOL, result.failure);
			}
			return successOutcome(
				changeSkillText(result.results),
				buildImportSkillPayload({
					displayIds: result.results.map((row) => row.displayId),
				}),
			);
		},
	};
}
