/**
 * `preview_skill`: a skill file's size and timestamps, and the sections of its
 * text.
 *
 * The file is read whole either way; `section` decides how much of it is
 * shown, never how much is read. Every selector stands on its own: the ones
 * that reach a heading are shown, and the ones that reach none are reported
 * beside them, so one bad selector never hides the rest.
 */
import { Type } from "typebox";
import type { SectionSelector } from "../failure/types";
import { projectSections, selectSections, SUBSECTION_VISIBILITIES } from "../files/section";
import type { SectionProjection, SubsectionVisibility } from "../files/section";
import { readSkillFile, resolveSkillFile } from "../files/read";
import { previewSkillText } from "../model-channel/output";
import type { PreviewContent } from "../model-channel/output";
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
			"Show a skill file's size, line count, and timestamps, and read the sections of its text. " +
			"`id` is the skill's ID, or its ID with a related-file suffix. " +
			"`section` is a heading title without the leading `#`, the line a heading stands at, or a list of them; " +
			"omit it to list the file's section tree. " +
			"Every selector stands on its own: the sections that resolve are shown, and the ones that do not are reported beside them. " +
			"The file is read whole; its content is returned in the tool result, and the call neither loads nor mounts the skill. " +
			"Result: one line naming the resolved skill and the file's absolute path, then the statistics, " +
			"then the sections or the section tree between separators, " +
			"and a warning list for the selections that reached no heading.",
		parameters: Type.Object({
			id: Type.String({
				description: "The skill's ID, or its ID with a related-file suffix.",
			}),
			section: Type.Optional(
				Type.Union(
					[
						Type.String({
							description: "A heading title, without the leading `#`.",
						}),
						Type.Number({
							description: "The line a heading stands at.",
						}),
						Type.Array(Type.Union([Type.String(), Type.Number()]), {
							description: "One or more sections: heading titles and heading lines.",
						}),
					],
					{
						description:
							"The section to read: a heading title, the line a heading stands at, or a list of them. " +
							"Omit it to list the file's section tree.",
					},
				),
			),
			subsectionVisibility: Type.Optional(
				Type.Union(
					SUBSECTION_VISIBILITIES.choices.map((visibility) => Type.Literal(visibility)),
					{
						default: SUBSECTION_VISIBILITIES.default,
						description:
							"Control the subsections of selected sections: hide omits them; " +
							"tree lists all descendant headings; expand shows every descendant heading and body without line numbers. " +
							"Ignored when section is omitted or an empty list.",
					},
				),
			),
		}),
		execute(args: Record<string, unknown>): ToolOutcome {
			if (typeof args.id !== "string") {
				return failureOutcome(TOOL, invalidId(args.id));
			}
			// The argument is read before the file is: an argument the schema
			// forbids must not spend a read to find out.
			const selectors = sectionSelectors(args.section);
			const subsectionVisibility = subsectionVisibilityOf(args.subsectionVisibility);
			const index = deps.index();
			const target = resolveTarget(index, args.id);
			if (!target.ok) {
				return failureOutcome(TOOL, target.failure);
			}
			const resolved = resolveSkillFile(target.entry.baseDir, target.refPath);
			if (!resolved.ok) {
				return failureOutcome(TOOL, resolved.failure);
			}
			const read = readSkillFile(resolved.path);
			if (!read.ok) {
				return failureOutcome(TOOL, read.failure);
			}
			const selection =
				selectors === undefined
					? undefined
					: selectSections(read.sections, selectors);
			const projection = projectSections(read.sections, selection, subsectionVisibility);
			return successOutcome(
				previewSkillText({
					source: { displayId: target.displayId, path: resolved.path },
					totalLines: read.lines,
					totalBytes: read.bytes,
					createdAt: read.createdAt.toISOString(),
					updatedAt: read.updatedAt.toISOString(),
					content: previewContent(projection),
					issues:
						selection === undefined
							? []
							: selection.issues.map((issue) => issue.failure),
				}),
				buildPreviewSkillPayload({
					totalLines: read.lines,
					viewedLines: projection.viewedLines,
					issues: selection === undefined ? [] : selection.issues,
				}),
			);
		},
	};
}

function subsectionVisibilityOf(value: unknown): SubsectionVisibility {
	if (value === undefined) {
		return SUBSECTION_VISIBILITIES.default;
	}
	const visibility = SUBSECTION_VISIBILITIES.choices.find((choice) => choice === value);
	if (visibility !== undefined) {
		return visibility;
	}
	throw new Error(
		`preview_skill requires \`subsectionVisibility\` to be one of: ${SUBSECTION_VISIBILITIES.choices.join(", ")}`,
	);
}

/**
 * The selectors a `section` argument names. None means the caller wants the
 * tree. An argument the schema forbids throws: reading it as a request for the
 * tree would answer a question nobody asked.
 */
function sectionSelectors(value: unknown): readonly SectionSelector[] | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (Array.isArray(value)) {
		const selectors = value.map((item) => selectorOf(item));
		return selectors.length === 0 ? undefined : selectors;
	}
	return [selectorOf(value)];
}

function selectorOf(value: unknown): SectionSelector {
	if (typeof value === "string") {
		return { kind: "name", name: value };
	}
	if (typeof value === "number" && Number.isFinite(value)) {
		return { kind: "line", line: value };
	}
	throw new Error(
		"preview_skill requires `section` to name a heading title or a heading line",
	);
}

/** The projection as the model channel states it. */
function previewContent(projection: SectionProjection): PreviewContent {
	if (projection.mode === "tree") {
		return { mode: "tree", tree: projection.headings };
	}
	return {
		mode: "sections",
		sections: projection.sections.map((section) => ({
			heading: section.heading,
			content: section.content,
			subSections: section.subSections,
		})),
	};
}
