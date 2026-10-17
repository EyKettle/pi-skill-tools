/**
 * `cancel_skill`: unload a skill, or several, from the tree.
 *
 * Cancelling a skill takes every related file it holds; cancelling one related
 * file takes only that file. The use case is the tree's, shared with the
 * commands.
 */
import { Type } from "typebox";
import { changeSkillText } from "../model-channel/output";
import { buildCancelSkillPayload } from "../tui-channel/payload";
import { batchIds } from "./common";
import { failureOutcome, successOutcome } from "./types";
import type { ToolDeps, ToolOutcome } from "./types";

const TOOL = "cancel_skill";

export function defineCancelSkillTool(deps: ToolDeps) {
	return {
		name: TOOL,
		label: "Cancel skill",
		description:
			"Unload a skill, or several, so its body leaves the context. " +
			"Cancelling a skill unloads every related file it holds; cancelling one related file unloads only that file. " +
			"`id` takes one skill ID or a list. " +
			"A batch is atomic: one id that is not loaded leaves the whole set untouched. " +
			"Result: `Unloaded` and the ids it applied to.",
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
			const result = deps.tree.cancelSkills(deps.index(), batch.ids);
			if (!result.ok) {
				return failureOutcome(TOOL, result.failure);
			}
			return successOutcome(
				changeSkillText(result.results),
				buildCancelSkillPayload({
					displayIds: result.results.map((row) => row.displayId),
				}),
			);
		},
	};
}
