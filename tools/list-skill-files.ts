/**
 * `list_skill_files` tool definition (design.md §5.5).
 *
 * Lists a skill's non-SKILL.md files as one row per file: the ref-id suffix
 * (the "{storage}:{name}/" prefix and the id itself are omitted) plus the
 * absolute path; recombining the suffix with the requested id yields the
 * full ref id. Conventional dirs (references/scripts/templates) sort first;
 * node_modules/.git/dot-dirs/symlinks skipped. Keeps the default
 * tool-execution shell (no custom renderShell) so the background is painted
 * automatically. The call/result slots draw from presentation.ts.
 */

import type { ToolDeps, ToolTextResult } from "./shared";
import {
	failEmptyIndex,
	failError,
	failureSource,
	resolveCallPayload,
	textResult,
	themeLike,
} from "./shared";
import { presentRow, renderedComponent } from "../presentation";
import type { ProjectInput, SlotComponents, ThemeFg } from "../presentation";
import { buildListSkillFilesPayload } from "../transport";
import type { TransportPayload } from "../transport";
import { formatSkillId, parseSkillId, resolveSkillId } from "../skill-id";
import { listSkillFiles } from "../skill-files";

const TOOL = "list_skill_files" as const;

/** One skill-file row (matches SkillFileEntry); refId + path + bytes. */
export interface RenderFileEntry {
	refId: string;
	path: string;
	bytes: number;
}

/** Shared per-row renderer state (Pi's ToolRenderContext.state). */
interface FilesRowState {
	input?: ProjectInput;
}

/**
 * Display suffix of a skill-file ref id: everything after the first `/`.
 * A refId without a `/` is kept as-is. Matches `{type/file-name}`.
 */
function fileRefSuffix(refId: string): string {
	const slashAt = refId.indexOf("/");
	return slashAt === -1 ? refId : refId.slice(slashAt + 1);
}

/**
 * One row per file for `list_skill_files`: the ref-id suffix plus the
 * absolute path. Empty list is the explicit message.
 */
export function buildFilesOutput(entries: readonly RenderFileEntry[]): string {
	if (entries.length === 0) {
		return "no files";
	}
	return entries
		.map((entry) => `- ${fileRefSuffix(entry.refId)} ${entry.path}`)
		.join("\n");
}


function slotsOf(deps: ToolDeps): SlotComponents {
	return { Text: deps.Text, Container: deps.Container };
}

function themeFg(theme: unknown): ThemeFg {
	const like = themeLike(theme);
	return { fg: (role, text) => like.fg(role, text) };
}

function argId(args: unknown): string | undefined {
	if (typeof args !== "object" || args === null) {
		return undefined;
	}
	const id = (args as { id?: unknown }).id;
	return typeof id === "string" ? id : undefined;
}

function pendingInput(
	args: unknown,
	keyHint: ProjectInput["keyHint"],
): ProjectInput {
	return { tool: TOOL, phase: "pending", args: { id: argId(args) }, keyHint };
}

function settledInput(opts: {
	result: { details?: unknown };
	expanded: boolean;
	args: unknown;
	isError: boolean;
	toolCallId?: string;
	previous?: TransportPayload;
	keyHint: ProjectInput["keyHint"];
}): ProjectInput {
	const phase = opts.expanded ? "expanded" : "collapsed";
	const payload = resolveCallPayload({
		tool: TOOL,
		details: opts.result.details,
		retained: opts.previous,
		isError: opts.isError,
		toolCallId: opts.toolCallId,
	});
	const args = { id: argId(opts.args) };
	if (payload !== undefined) {
		return { tool: TOOL, phase, payload, args, keyHint: opts.keyHint };
	}
	return { tool: TOOL, phase, args, keyHint: opts.keyHint };
}

function rowState(context: { state?: unknown }): FilesRowState {
	if (typeof context.state === "object" && context.state !== null) {
		return context.state as FilesRowState;
	}
	const state: FilesRowState = {};
	context.state = state;
	return state;
}

export function defineListSkillFiles(deps: ToolDeps) {
	const Type = deps.Type as ToolDeps["Type"];
	const components = slotsOf(deps);

	return {
		name: "list_skill_files",
		label: "List skill files",
		description:
			"List every file under a skill directory (SKILL.md itself is not listed), one row per file: " +
			"a skill-id suffix (the '{storage}:{name}/' prefix and the id itself are omitted) plus the " +
			"absolute path; recombining the suffix with the requested id yields the full ref id, e.g. " +
			"global:git-utils/references/GUIDE.md. Conventional directories (references/, scripts/, " +
			"templates/) sort first, then everything else; node_modules/, .git/, dot-directories, and " +
			"symlinks are skipped. Explicit 'no files' when empty.",
		parameters: Type.Object({
			id: Type.String({
				description: "Skill id, e.g. 'coding' or 'global:git'",
			}),
		}),
		async execute(
			toolCallId: string,
			params: { id: string },
			_signal: unknown,
			_onUpdate: unknown,
			ctx: { cwd: string; isProjectTrusted(): boolean },
		): Promise<ToolTextResult> {
			const registry = deps.registryDeps(ctx);
			if (registry.indexEmpty) {
				return failEmptyIndex(toolCallId, "list_skill_files");
			}
			const parsedId = parseSkillId(params.id);
			if (parsedId.error !== undefined) {
				return failError(
					toolCallId,
					"list_skill_files",
					failureSource(parsedId),
				);
			}
			const resolved = resolveSkillId(
				registry.entries,
				parsedId.storage,
				parsedId.name,
			);
			if (resolved.error !== undefined) {
				return failError(
					toolCallId,
					"list_skill_files",
					failureSource(resolved),
				);
			}
			const entry = registry.entries.find(
				(e) => e.storage === resolved.storage && e.name === resolved.name,
			);
			if (entry === undefined) {
				return failError(toolCallId, "list_skill_files", {
					error: `skill '${formatSkillId(resolved.storage, resolved.name)}' resolved but has no registry entry`,
					code: "ENTRY_UNREACHABLE",
					evidence: { kind: "none" },
				});
			}
			const listing = listSkillFiles(entry.storage, entry.name, entry.baseDir);
			if (listing.error !== undefined) {
				return failError(
					toolCallId,
					"list_skill_files",
					failureSource(listing),
				);
			}
			const text = buildFilesOutput(listing.entries);
			const conflictNames = new Set(
				(registry.conflicts ?? []).map((conflict) => conflict.name),
			);
			const targetId = conflictNames.has(entry.name) ? entry.id : entry.name;
			return textResult(text, {
				id: entry.id,
				files: listing.entries.length,
				payload: buildListSkillFilesPayload(
					listing.entries.length,
					targetId,
					listing.entries.map((file) => ({
						refId: fileRefSuffix(file.refId),
						path: file.path,
					})),
				),
			});
		},
		renderCall: (
			args: unknown,
			theme: unknown,
			context: { state?: unknown },
		) => {
			const state = rowState(context);
			// Streamed args refresh while pending; freeze once renderResult has settled.
			if (state.input === undefined || state.input.phase === "pending") {
				state.input = pendingInput(args, deps.expandKeyHint);
			}
			return renderedComponent((width) =>
				presentRow(
					state.input ?? pendingInput(args, deps.expandKeyHint),
					themeFg(theme),
					components,
				).render(width),
			);
		},
		renderResult: (
			result: {
				content: ReadonlyArray<{ type: string; text?: string }>;
				details?: Record<string, unknown>;
			},
			options: { expanded: boolean },
			_theme: unknown,
			context: {
				state?: unknown;
				args?: unknown;
				isError?: boolean;
				toolCallId?: string;
			},
		) => {
			const state = rowState(context);
			state.input = settledInput({
				result,
				expanded: options.expanded,
				args: context.args,
				isError: context.isError === true,
				toolCallId: context.toolCallId,
				previous: state.input?.payload,
				keyHint: deps.expandKeyHint,
			});
			return new deps.Container();
		},
	};
}
