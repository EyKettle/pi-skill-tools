/**
 * `list_skills`: every skill the index holds, optionally narrowed to one
 * location or carrying each skill's description.
 */
import { Type } from "typebox";
import { displaySkillId } from "../discovery/skill-id";
import type { Index, RegistryEntry } from "../discovery/types";
import { EMPTY_LIST_SKILLS, listSkillsText } from "../model-channel/output";
import { buildListSkillsPayload } from "../tui-channel/payload";
import { successOutcome } from "./types";
import type { ToolDeps, ToolOutcome } from "./types";

const TOOL = "list_skills";

export function defineListSkillsTool(deps: ToolDeps) {
	return {
		name: TOOL,
		label: "List skills",
		description:
			"List the skills reachable through the registered discovery locations, with each main document's path. " +
			"Every registered location is scanned, so a skill that another skill shadows is still listed. " +
			"Result: one `[skill-id] /path` line per skill, or `No skill found`.",
		parameters: Type.Object({
			location: Type.Optional(
				Type.String({
					description:
						"A registered discovery location, such as global or project.",
				}),
			),
			detail: Type.Optional(
				Type.Boolean({
					description: "Append each skill's description to its line.",
				}),
			),
		}),
		execute(args: Record<string, unknown>): ToolOutcome {
			const index = deps.index();
			const location =
				typeof args.location === "string" ? args.location : undefined;
			const detail = args.detail === true;
			const entries = index.entries.filter(
				(entry) => location === undefined || entry.location === location,
			);
			return successOutcome(
				listingText(index, entries, detail),
				buildListSkillsPayload({ location, count: entries.length }),
			);
		},
	};
}

/** The model text: one line per skill; `detail` appends the description. */
export function listingText(
	index: Index,
	entries: readonly RegistryEntry[],
	detail: boolean,
): string {
	if (entries.length === 0) {
		return EMPTY_LIST_SKILLS;
	}
	if (!detail) {
		return listSkillsText(
			entries.map((entry) => ({
				displayId: displaySkillId(index, entry),
				path: entry.filePath,
			})),
		);
	}
	return entries
		.map((entry) => {
			const line = `[${displaySkillId(index, entry)}] ${entry.filePath}`;
			const description = entry.frontmatter.description;
			return typeof description === "string" && description.length > 0
				? `${line} — ${description}`
				: line;
		})
		.join("\n");
}
