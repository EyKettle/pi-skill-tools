/**
 * `search_skill`: the skills whose frontmatter matches every filter key.
 *
 * The filter grammar belongs to `discovery/frontmatter` and is compiled once,
 * so a bad pattern is one `FILTER_INVALID` failure rather than one per skill.
 * The frontmatter shown for a hit is the document's own text, as the document
 * requires.
 */
import { Type } from "typebox";
import {
	compileFilter,
	matchesFrontmatter,
	parseFrontmatterBlock,
} from "../discovery/frontmatter";
import { displaySkillId } from "../discovery/skill-id";
import { readSkillFile } from "../files/read";
import { searchSkillText } from "../model-channel/output";
import type { SearchHit } from "../model-channel/output";
import { buildSearchSkillPayload } from "../tui-channel/payload";
import { failureOutcome, successOutcome } from "./types";
import type { ToolDeps, ToolOutcome } from "./types";

const TOOL = "search_skill";

export function defineSearchSkillTool(deps: ToolDeps) {
	return {
		name: TOOL,
		label: "Search skill",
		description:
			"Find the skills whose frontmatter matches a filter, and show each hit's frontmatter verbatim. " +
			"`filter` maps a dotted frontmatter path to a value; keys are ANDed, and a missing or unparseable key never matches. " +
			"A value is a substring, a list of substrings where any one suffices, or a `/pattern/` regular expression. " +
			"Result: `[skill-id]` then the document's frontmatter, hits separated by a blank line, or `No matches`.",
		parameters: Type.Object({
			filter: Type.Record(
				Type.String(),
				Type.Union([Type.String(), Type.Array(Type.String())], {
					description:
						"A substring, a list of substrings, or a `/pattern/`.",
				}),
				{
					description:
						"Dotted frontmatter paths to the values they must match.",
				},
			),
			location: Type.Optional(
				Type.String({
					description:
						"A registered discovery location, such as global or project.",
				}),
			),
		}),
		execute(args: Record<string, unknown>): ToolOutcome {
			const raw = args.filter;
			if (!isFilterRecord(raw)) {
				// The schema requires a record, so a caller that bypasses it is an
				// unexpected error: throwing lets the framework report it rather than
				// matching every skill against an empty filter.
				throw new Error(
					"search_skill requires `filter` to be a record of frontmatter paths",
				);
			}
			const compiled = compileFilter(raw);
			if (!compiled.ok) {
				return failureOutcome(TOOL, compiled.failure);
			}

			const index = deps.index();
			const location =
				typeof args.location === "string" ? args.location : undefined;
			const hits: SearchHit[] = [];
			for (const entry of index.entries) {
				if (location !== undefined && entry.location !== location) continue;
				if (!matchesFrontmatter(entry.frontmatter, compiled.value)) continue;
				// A hit's frontmatter is shown verbatim, so the file is read again:
				// a file that became unreadable is reported, not silently dropped
				// and not replaced by invented text.
				const read = readSkillFile(entry.filePath);
				if (!read.ok) {
					return failureOutcome(TOOL, read.failure);
				}
				const raw = parseFrontmatterBlock(read.text).raw;
				if (raw === undefined) {
					// A document without a frontmatter block cannot match any filter
					// key, so this is unreachable through a real match.
					continue;
				}
				hits.push({ displayId: displaySkillId(index, entry), frontmatter: raw });
			}
			return successOutcome(
				searchSkillText(hits),
				buildSearchSkillPayload({ location, count: hits.length }),
			);
		},
	};
}

function isFilterRecord(
	value: unknown,
): value is Record<string, string | readonly string[]> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

