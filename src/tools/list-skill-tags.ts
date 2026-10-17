/**
 * `list_skill_tags`: every tag the indexed skills declare, so a search can
 * reuse an existing tag instead of guessing its spelling.
 */
import { Type } from "typebox";
import { collectTags } from "../discovery/registry";
import { listSkillTagsText } from "../model-channel/output";
import { buildListSkillTagsPayload } from "../tui-channel/payload";
import { successOutcome } from "./types";
import type { ToolDeps, ToolOutcome } from "./types";

const TOOL = "list_skill_tags";

export function defineListSkillTagsTool(deps: ToolDeps) {
	return {
		name: TOOL,
		label: "List skill tags",
		description:
			"List every tag the indexed skills declare in `metadata.tags`, so a search can reuse an existing tag. " +
			"Result: every tag on one line, separated by commas, or `No tag found`.",
		parameters: Type.Object({
			location: Type.Optional(
				Type.String({
					description:
						"A registered discovery location, such as global or project.",
				}),
			),
		}),
		execute(args: Record<string, unknown>): ToolOutcome {
			const index = deps.index();
			const location =
				typeof args.location === "string" ? args.location : undefined;
			const entries = index.entries.filter(
				(entry) => location === undefined || entry.location === location,
			);
			const tags = Array.from(collectTags(entries).keys());
			return successOutcome(
				listSkillTagsText(tags),
				buildListSkillTagsPayload({ location, count: tags.length }),
			);
		},
	};
}
