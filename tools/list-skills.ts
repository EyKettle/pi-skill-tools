/**
 * `list_skills` tool definition (design.md §5.1).
 *
 * Renders one line per skill (`- {id} [{state}] {absolutePath}`, with an
 * optional description). A row shows the bare skill name unless that name
 * participates in a same-name conflict across locations, in which case the
 * prefixed id (e.g. `global:alpha`) disambiguates. The model-channel text is
 * built here (a pure string, so it stays unit-testable); the TUI row is
 * projected from the transport payload via presentation.ts. Pi-runtime pieces
 * (TypeBox schema, Text/Container) come from the injected `ToolDeps`.
 */

import type { ToolDeps, ToolTextResult } from "./shared";
import {
	failEmptyIndex,
	resolveCallPayload,
	textResult,
} from "./shared";
import type { ProjectInput, SlotComponents, ThemeFg } from "../presentation";
import { presentRow } from "../presentation";
import type { TransportPayload } from "../transport";
import { buildListSkillsPayload } from "../transport";

export type RenderEntryState = "active" | "hidden" | "shadowed";

/** One skill row for the list output (structural slice of RegistryEntry). */
export interface RenderListEntry {
	/** Un-prefixed skill name; the row id unless the name is in conflict. */
	name: string;
	/** Prefixed id (e.g. `global:alpha`), used only for conflicting names. */
	id: string;
	state: RenderEntryState;
	filePath: string;
	description?: string;
}

/** A same-name conflict; its name drives prefixed-id rendering in the rows. */
export interface RenderConflict {
	name: string;
	participants: readonly string[];
}

export interface BuildListOutputOptions {
	detail?: boolean;
	conflicts?: readonly RenderConflict[];
}

/**
 * One line per skill: id or bare name, `[state]` marker, absolute path. With
 * `detail` a collapsed ` — {description}` is appended. A row whose name is
 * among `options.conflicts` names is rendered with its prefixed id; an
 * unconflicted name stays bare.
 */
export function buildListOutput(
	entries: readonly RenderListEntry[],
	options: BuildListOutputOptions = {},
): string {
	const conflictNames = new Set(
		(options.conflicts ?? []).map((conflict) => conflict.name),
	);
	const lines = entries.map((entry) =>
		renderEntryLine(
			entry,
			conflictNames.has(entry.name),
			options.detail === true,
		),
	);
	if (lines.length === 0) {
		return "no skills";
	}
	return lines.join("\n");
}

function renderEntryLine(
	entry: RenderListEntry,
	prefixed: boolean,
	includeDescription: boolean,
): string {
	const id = prefixed ? entry.id : entry.name;
	const base = `- ${id} [${entry.state}] ${entry.filePath}`;
	const description = includeDescription
		? entry.description?.replace(/\s+/g, " ").trim()
		: undefined;
	return description === undefined || description === ""
		? base
		: `${base} — ${description}`;
}


function slotComponents(deps: ToolDeps): SlotComponents {
	return { Text: deps.Text, Container: deps.Container };
}

interface ListSkillsRowState {
	payload?: TransportPayload;
}

function rowState(context: { state?: unknown }): ListSkillsRowState {
	if (typeof context.state === "object" && context.state !== null) {
		return context.state as ListSkillsRowState;
	}
	const state: ListSkillsRowState = {};
	context.state = state;
	return state;
}

function locationArgs(args: unknown): ProjectInput["args"] {
	if (typeof args !== "object" || args === null) {
		return undefined;
	}
	// SAFETY: args are untyped tool parameters; only the three position
	// literals are kept, everything else is dropped.
	const location = (args as { location?: unknown }).location;
	if (
		location === "global" ||
		location === "project" ||
		location === "package"
	) {
		return { location };
	}
	return undefined;
}

export function defineListSkills(deps: ToolDeps) {
	const Type = deps.Type as ToolDeps["Type"];
	const paint = (input: ProjectInput, theme: unknown) =>
		presentRow(input, theme as ThemeFg, slotComponents(deps));
	const locationSchema = Type.Union([
		Type.Literal("global"),
		Type.Literal("project"),
		Type.Literal("package"),
	]);

	return {
		name: "list_skills",
		label: "List skills",
		description:
			"List skills from the pi skill index. location: global | project | package, omitted for all. " +
			"One line per skill: <name> [active|hidden|shadowed] <absolute path>; a name is id-prefixed " +
			"(e.g. global:name) only when the same name exists in more than one location; detail: true " +
			"appends the description. An unpopulated index is an explicit error, never a silent empty list.",
		parameters: Type.Object({
			location: Type.Optional(locationSchema),
			detail: Type.Optional(
				Type.Boolean({ description: "Append each skill's description" }),
			),
		}),
		async execute(
			toolCallId: string,
			params: { location?: "global" | "project" | "package"; detail?: boolean },
			_signal: unknown,
			_onUpdate: unknown,
			ctx: { cwd: string; isProjectTrusted(): boolean },
		): Promise<ToolTextResult> {
			const registry = deps.registryDeps(ctx);
			if (registry.indexEmpty) {
				return failEmptyIndex(toolCallId, "list_skills");
			}
			const entries = registry.filter(params.location);
			const text = buildListOutput(entries, {
				detail: params.detail,
				conflicts: registry.conflicts,
			});
			const conflictNames = new Set(
				(registry.conflicts ?? []).map((conflict) => conflict.name),
			);
			const skills = entries.map((entry) => ({
				id: conflictNames.has(entry.name) ? entry.id : entry.name,
				filePath: entry.filePath,
			}));
			return textResult(text, {
				location: params.location ?? "all",
				count: entries.length,
				payload: buildListSkillsPayload(
					entries.length,
					params.location ?? null,
					skills,
				),
			});
		},
		renderCall: (
			args: unknown,
			theme: unknown,
			context: { isPartial?: boolean },
		) => {
			// Settled redraws invoke renderCall before renderResult; an empty
			// call slot keeps identity in the projected row that renderResult paints.
			if (context.isPartial === false) {
				return new deps.Container();
			}
			return paint(
				{
					tool: "list_skills",
					phase: "pending",
					args: locationArgs(args),
					keyHint: deps.expandKeyHint,
				},
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
			context: {
				args?: unknown;
				isError?: boolean;
				state?: unknown;
				toolCallId?: string;
			},
		) => {
			const state = rowState(context);
			const payload = resolveCallPayload({
				tool: "list_skills",
				details: result.details,
				retained: state.payload,
				isError: context.isError === true,
				toolCallId: context.toolCallId,
			});
			if (payload !== undefined) {
				state.payload = payload;
			}
			return paint(
				{
					tool: "list_skills",
					phase: options.expanded ? "expanded" : "collapsed",
					payload,
					args: locationArgs(context.args),
					keyHint: deps.expandKeyHint,
				},
				theme,
			);
		},
	};
}
