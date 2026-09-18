/**
 * `list_skill_tags` tool definition (design.md §5.2).
 *
 * Aggregates `metadata.tags` from the registry's per-entry frontmatter into a
 * tag set. Model-channel output is an alphabetically sorted comma-separated
 * line; the TUI row is projected from presentation.ts.
 */

import type { ToolDeps, ToolTextResult } from "./shared";
import type { SkillStorage } from "../skill-id";
import {
	failEmptyIndex,
	parseSkillLocation,
	resolveCallPayload,
	skillLocationSchema,
	SKILL_LOCATION_LIST,
	textResult,
	themeLike,
} from "./shared";
import {
	presentRow,
	renderedComponent,
	type ProjectInput,
	type SlotComponents,
	type ThemeFg,
} from "../presentation";
import {
	buildListSkillTagsPayload,
	type TransportPayload,
} from "../transport";
import { collectTags } from "../registry";

/**
 * Tag → sorted prefixed ids map; the source of `list_skill_tags`.
 * Produced by the registry's `collectTags` (design §3.4, §5.2).
 */
export type TagsByTag = ReadonlyMap<string, readonly string[]>;

/**
 * The `list_skill_tags` output: alphabetically sorted tag names joined with
 * ", " on a single line. The empty map is an explicit message.
 */
export function buildTagsOutput(byTag: TagsByTag): string {
	if (byTag.size === 0) {
		return "no tags";
	}
	return [...byTag.keys()].sort().join(", ");
}


type TagsRowState = {
	settled?: boolean;
	payload?: TransportPayload;
};

type RenderContext = {
	lastComponent?: unknown;
	state?: TagsRowState;
	expanded?: boolean;
	args?: unknown;
	isError?: boolean;
	toolCallId?: string;
};

function locationFrom(
	args: unknown,
): ReturnType<typeof parseSkillLocation> {
	if (typeof args !== "object" || args === null) return undefined;
	return parseSkillLocation((args as { location?: unknown }).location);
}

function tagsInput(
	phase: ProjectInput["phase"],
	payload: TransportPayload | undefined,
	args: unknown,
	keyHint: ProjectInput["keyHint"],
): ProjectInput {
	const location = locationFrom(args);
	return {
		tool: "list_skill_tags",
		phase,
		payload,
		args: location === undefined ? undefined : { location },
		keyHint,
	};
}

function paintSlot(
	input: ProjectInput,
	theme: ThemeFg,
	Text: SlotComponents["Text"],
	which: "call" | "result",
	width: number,
): string[] {
	let latest: Array<{ render(width: number): string[] }> = [];
	class CollectingContainer {
		private readonly mine: Array<{ render(width: number): string[] }> = [];
		addChild(component: unknown) {
			this.mine.push(component as { render(width: number): string[] });
			latest = this.mine;
		}
		render(w: number): string[] {
			return this.mine.flatMap((child) => child.render(w));
		}
	}
	presentRow(input, theme, { Text, Container: CollectingContainer }).render(
		width,
	);
	const child = latest[which === "call" ? 0 : 1];
	return child === undefined ? [] : child.render(width);
}

export function defineListSkillTags(deps: ToolDeps) {
	const Type = deps.Type as ToolDeps["Type"];
	const locationSchema = skillLocationSchema(Type);
	const Text = deps.Text;

	return {
		name: "list_skill_tags",
		label: "List skill tags",
		description:
			`List metadata.tags aggregated across skill frontmatter. location: ${SKILL_LOCATION_LIST}, omitted for all. ` +
			"Output is an alphabetically sorted comma-separated list of tags, useful " +
			"for discovering searchable tags and spotting duplicate or near-synonym tags. Explicit 'no skills " +
			"carry metadata.tags' when none.",
		parameters: Type.Object({
			location: Type.Optional(locationSchema),
		}),
		async execute(
			toolCallId: string,
			params: { location?: SkillStorage },
			_signal: unknown,
			_onUpdate: unknown,
			ctx: { cwd: string; isProjectTrusted(): boolean },
		): Promise<ToolTextResult> {
			const registry = deps.registryDeps(ctx);
			if (registry.indexEmpty) {
				return failEmptyIndex(toolCallId, "list_skill_tags");
			}
			const byTag = collectTags(
				registry.filter(params.location) as Parameters<typeof collectTags>[0],
			);
			const text = buildTagsOutput(byTag);
			return textResult(text, {
				location: params.location ?? "all",
				tags: byTag.size,
				payload: buildListSkillTagsPayload(
					byTag.size,
					params.location ?? null,
					[...byTag.keys()].sort(),
				),
			});
		},
		renderCall: (args: unknown, theme: unknown, context: RenderContext) => {
			const state = (context.state ??= {});
			const like = themeLike(theme);
			return renderedComponent((width) => {
				const phase: ProjectInput["phase"] = state.settled
					? context.expanded === true
						? "expanded"
						: "collapsed"
					: "pending";
				return paintSlot(
					tagsInput(phase, state.payload, args, deps.expandKeyHint),
					like,
					Text,
					"call",
					width,
				);
			});
		},
		renderResult: (
			result: {
				content: ReadonlyArray<{ type: string; text?: string }>;
				details?: Record<string, unknown>;
			},
			options: { expanded: boolean; isPartial?: boolean },
			theme: unknown,
			context: RenderContext,
		) => {
			const state = (context.state ??= {});
			state.settled = true;
			state.payload = resolveCallPayload({
				tool: "list_skill_tags",
				details: result.details,
				retained: state.payload,
				isError: context.isError === true,
				toolCallId: context.toolCallId,
			});
			const like = themeLike(theme);
			const args = context.args ?? {};
			return renderedComponent((width) => {
				const phase: ProjectInput["phase"] =
					options.expanded ? "expanded" : "collapsed";
				return paintSlot(
					tagsInput(phase, state.payload, args, deps.expandKeyHint),
					like,
					Text,
					"result",
					width,
				);
			});
		},
	};
}
