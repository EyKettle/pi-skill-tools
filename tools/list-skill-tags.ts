/**
 * `list_skill_tags` tool definition (design.md §5.2).
 *
 * Aggregates `metadata.tags` from the registry's per-entry frontmatter into a
 * tag set. Model-channel output is an alphabetically sorted comma-separated
 * line; the TUI row is projected from presentation.ts.
 */

import type { ToolDeps, ToolTextResult } from "./shared";
import {
	failEmptyIndex,
	recoverThrownFailure,
	textResult,
	themeLike,
	unknownFailurePayload,
} from "./shared";
import {
	presentRow,
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
		return "no skills carry metadata.tags";
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
): "global" | "project" | "package" | undefined {
	if (typeof args !== "object" || args === null) return undefined;
	const location = (args as { location?: unknown }).location;
	if (
		location === "global" ||
		location === "project" ||
		location === "package"
	) {
		return location;
	}
	return undefined;
}

function payloadFromDetails(
	details: Record<string, unknown> | undefined,
): TransportPayload | undefined {
	if (details === undefined) return undefined;
	const payload = details.payload;
	if (typeof payload !== "object" || payload === null) return undefined;
	if (!("tool" in payload) || !("outcome" in payload) || !("version" in payload)) {
		return undefined;
	}
	return payload as TransportPayload;
}

function resolvePayload(
	context: RenderContext,
	details: Record<string, unknown> | undefined,
): TransportPayload | undefined {
	const found =
		payloadFromDetails(details) ??
		context.state?.payload ??
		(context.toolCallId === undefined
			? undefined
			: recoverThrownFailure(context.toolCallId, "list_skill_tags"));
	if (found !== undefined) {
		const state = (context.state ??= {});
		state.payload = found;
		return found;
	}
	if (context.isError === true) {
		const synthesized = unknownFailurePayload("list_skill_tags");
		const state = (context.state ??= {});
		state.payload = synthesized;
		return synthesized;
	}
	return undefined;
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

function slotView(paint: (width: number) => string[]): {
	render(width: number): string[];
	invalidate(): void;
} {
	return {
		render: paint,
		invalidate() {},
	};
}

export function defineListSkillTags(deps: ToolDeps) {
	const Type = deps.Type as ToolDeps["Type"];
	const locationSchema = Type.Union([
		Type.Literal("global"),
		Type.Literal("project"),
		Type.Literal("package"),
	]);
	// SAFETY: ToolDeps.Text is the structural vitest-safe ctor; runtime is pi-tui Text with render().
	const Text = deps.Text as unknown as SlotComponents["Text"];

	return {
		name: "list_skill_tags",
		label: "List skill tags",
		description:
			"List metadata.tags aggregated across skill frontmatter (design §5.2). location: global|project|" +
			"package, omitted for all. Output is an alphabetically sorted comma-separated list of tags, useful " +
			"for discovering searchable tags and spotting duplicate or near-synonym tags. Explicit 'no skills " +
			"carry metadata.tags' when none.",
		parameters: Type.Object({
			location: Type.Optional(locationSchema),
		}),
		async execute(
			toolCallId: string,
			params: { location?: "global" | "project" | "package" },
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
			return slotView((width) => {
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
			state.payload = resolvePayload(context, result.details);
			const like = themeLike(theme);
			const args = context.args ?? {};
			return slotView((width) => {
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
