/**
 * `search_skills` tool definition (design.md §5.3).
 *
 * Filters skill registry entries by a frontmatter filter record (dotted
 * paths, AND across keys) and renders a headerless list: blank-line-
 * separated entries, each starting with the display id plus the absolute
 * path, then the matched filter parameters with their values (matched items
 * wrapped in asterisks when a parameter has multiple values), or an
 * explicit `no matches`.
 */

import type { ToolDeps, ToolTextResult } from "./shared";
import {
	failEmptyIndex,
	resolveCallPayload,
	textResult,
} from "./shared";
import { presentRow } from "../presentation";
import type { ProjectInput, SlotComponents } from "../presentation";
import { buildSearchSkillsPayload } from "../transport";
import type { TransportPayload } from "../transport";
import { matchesFrontmatter, matchedValues } from "../frontmatter";
import type { FrontmatterMatch } from "../frontmatter";

/** One search match row (design §5.3): display id, bare name, path, matched keys. */
export interface RenderSearchMatch {
	id: string;
	filePath: string;
	/** Un-prefixed skill name; the row's leading id unless the name is in conflict. */
	name: string;
	/** Per-filter-key match detail for the matched frontmatter values. */
	matchedKeys: { key: string; values: FrontmatterMatch[] }[];
}

/**
 * Headerless match list: entries separated by blank lines. Line one of each
 * entry is the display id (prefixed only for globally conflicted names) plus
 * the absolute path; following lines render each matched filter key with its
 * values, asterisks marking the matched items. Empty → `no matches`.
 */
export function buildSearchOutput(
	matches: readonly RenderSearchMatch[],
	options: {
		conflicts?: readonly { name: string; participants: readonly string[] }[];
	} = {},
): string {
	if (matches.length === 0) {
		return "no matches";
	}
	const conflictNames = new Set(
		(options.conflicts ?? []).map((conflict) => conflict.name),
	);
	return matches
		.map((match) =>
			[
				`${conflictNames.has(match.name) ? match.id : match.name} ${match.filePath}`,
				...match.matchedKeys.map(({ key, values }) =>
					formatMatchedKey(key, values),
				),
			].join("\n"),
		)
		.join("\n\n");
}

/** One `key: values` line: bare when single-valued, asterisks on matched items. */
function formatMatchedKey(key: string, values: FrontmatterMatch[]): string {
	if (values.length === 1) {
		return `${key}: ${values[0].value}`;
	}
	return `${key}: ${values
		.map((match) => (match.matched ? `*${match.value}*` : match.value))
		.join(", ")}`;
}


interface SearchRenderState {
	payload?: TransportPayload;
}

interface SearchRenderContext {
	args?: {
		frontmatter?: Record<string, unknown>;
		location?: "global" | "project" | "package";
	};
	toolCallId: string;
	state: SearchRenderState;
	expanded: boolean;
	isError: boolean;
	isPartial?: boolean;
}

function presentSearch(
	deps: ToolDeps,
	input: ProjectInput,
	theme: unknown,
) {
	return presentRow(
		input,
		theme as { fg(role: string, text: string): string },
		{ Text: deps.Text, Container: deps.Container },
	);
}

function asSearchContext(context: unknown): SearchRenderContext {
	// SAFETY: pi ToolRenderContext and the test harness both supply these fields.
	const ctx = context as SearchRenderContext;
	if (ctx.state === undefined) {
		ctx.state = {};
	}
	return ctx;
}

function searchProjectInput(
	context: SearchRenderContext,
	phase: ProjectInput["phase"],
	payload: TransportPayload | undefined,
	keyHint: ProjectInput["keyHint"],
): ProjectInput {
	return {
		tool: "search_skills",
		phase,
		payload,
		args: {
			location: context.args?.location,
			frontmatter: context.args?.frontmatter,
		},
		keyHint,
	};
}

export function defineSearchSkills(deps: ToolDeps) {
	const Type = deps.Type as ToolDeps["Type"];
	const locationSchema = Type.Union([
		Type.Literal("global"),
		Type.Literal("project"),
		Type.Literal("package"),
	]);

	return {
		name: "search_skills",
		label: "Search skills",
		description:
			"Search skills by frontmatter. frontmatter: required filter record; keys accept dotted " +
			"paths, scalar equality and array intersection per key, AND across keys; a missing key " +
			"or unparsable frontmatter never matches. location: global|project|package, omitted for " +
			"all. Returns a headerless list of blank-line-separated entries: line one is the skill " +
			"name (id-prefixed only when the same name exists in more than one location) plus the " +
			"absolute path, " +
			"then the matched filter parameters with their values, asterisks marking which values " +
			"matched when a parameter has multiple values; explicit 'no matches' when none.",
		parameters: Type.Object({
			frontmatter: Type.Record(Type.String(), Type.Unknown(), {
				description:
					"Filter record keyed by dotted frontmatter path (AND across keys)",
			}),
			location: Type.Optional(locationSchema),
		}),
		async execute(
			toolCallId: string,
			params: {
				frontmatter: Record<string, unknown>;
				location?: "global" | "project" | "package";
			},
			_signal: unknown,
			_onUpdate: unknown,
			ctx: { cwd: string; isProjectTrusted(): boolean },
		): Promise<ToolTextResult> {
			const registry = deps.registryDeps(ctx);
			if (registry.indexEmpty) {
				return failEmptyIndex(toolCallId, "search_skills");
			}
			const matches = registry
				.filter(params.location)
				.filter((entry) =>
					matchesFrontmatter(entry.frontmatter, params.frontmatter),
				);
			const rows = matches.map((entry) => ({
				id: entry.id,
				filePath: entry.filePath,
				name: entry.name,
				matchedKeys: Object.entries(params.frontmatter)
					.map(([key, filterValue]) => ({
						key,
						values: matchedValues(entry.frontmatter, key, filterValue),
					}))
					.filter(({ values }) => values.length > 0),
			}));
			const text = buildSearchOutput(rows, {
				conflicts: registry.conflicts,
			});
			const conflictNames = new Set(
				(registry.conflicts ?? []).map((conflict) => conflict.name),
			);
			const matchRows = rows.map((row) => ({
				id: conflictNames.has(row.name) ? row.id : row.name,
				filePath: row.filePath,
			}));
			const payload = buildSearchSkillsPayload(
				rows.length,
				params.location ?? null,
				params.frontmatter,
				matchRows,
			);
			return textResult(text, {
				location: params.location ?? "all",
				matches: rows.length,
				payload,
			});
		},
		renderCall: (
			args: {
				frontmatter?: Record<string, unknown>;
				location?: "global" | "project" | "package";
			},
			theme: unknown,
			context: unknown,
		) => {
			const ctx = asSearchContext(context);
			ctx.args = args;
			// Settled redraws invoke renderCall before renderResult; an empty
			// call slot keeps identity in the projected row that renderResult paints.
			if (ctx.isPartial === false || ctx.isError) {
				return new deps.Container();
			}
			return presentSearch(
				deps,
				searchProjectInput(ctx, "pending", undefined, deps.expandKeyHint),
				theme,
			);
		},
		renderResult: (
			result: {
				content: ReadonlyArray<{ type: string; text?: string }>;
				details?: Record<string, unknown>;
			},
			options: { expanded: boolean },
			theme: unknown,
			context: unknown,
		) => {
			const ctx = asSearchContext(context);
			const payload = resolveCallPayload({
				tool: "search_skills",
				details: result.details,
				retained: ctx.state.payload,
				isError: ctx.isError,
				toolCallId: ctx.toolCallId,
			});
			if (payload !== undefined) {
				ctx.state.payload = payload;
			}
			const phase = options.expanded ? "expanded" : "collapsed";
			return presentSearch(
				deps,
				searchProjectInput(ctx, phase, payload, deps.expandKeyHint),
				theme,
			);
		},
	};
}
