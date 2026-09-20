/**
 * `peek_skill` tool definition.
 *
 * Reads only the 'When to Use' section of a skill's SKILL.md.
 * Wrapped in an attributed `<SKILL_PEEK name location>` block.
 * Ref paths are rejected outright.
 */

import type {
	FailureSource,
	PeekSkillDetails,
	ToolDeps,
	ToolTextResult,
} from "./shared";
import {
	failEmptyIndex,
	failError,
	failureSource,
	resolveCallPayload,
	textResult,
} from "./shared";
import type { ProjectInput, SlotComponents, ThemeFg } from "../presentation";
import { presentRow } from "../presentation";
import type { TransportPayload } from "../transport";
import { buildPeekSkillPayload } from "../transport";
import { formatSkillId, parseSkillId, resolveSkillId } from "../skill-id";
import { readSkillFile, resolveSkillFile } from "../skill-file";
import { extractSection } from "../skill-section";

/**
 * Model-channel wrapper: the extracted When to Use section inside an
 * attributed open/close pair. `location` is the resolved absolute path.
 */
export function wrapSkillPeekBlock(
	name: string,
	path: string,
	text: string,
): string {
	return `<SKILL_PEEK name="${name}" location="${path}">\n${text}\n</SKILL_PEEK>`;
}

function failPeekSkill(toolCallId: string, source: FailureSource): never {
	return failError(toolCallId, "peek_skill", source);
}

function slotComponents(deps: ToolDeps): SlotComponents {
	return { Text: deps.Text, Container: deps.Container };
}

export function definePeekSkill(
	deps: ToolDeps,
	_config: { agentDir: string; configDirName: string },
) {
	const Type = deps.Type as ToolDeps["Type"];
	const paint = (input: ProjectInput, theme: unknown) =>
		presentRow(input, theme as ThemeFg, slotComponents(deps));

	return {
		name: "peek_skill",
		label: "Peek skill",
		description:
			"Preview a skill's 'When to Use' section without loading the full file. " +
			"Helps determine whether a skill is relevant before loading it with view_skill. " +
			"Accepts a bare skill name or storage-prefixed id (e.g. 'git' or 'global:git'). Ref paths are rejected.",
		parameters: Type.Object({
			id: Type.String({
				description:
					"Skill id, e.g. 'git' or 'global:git'. Ref paths are not allowed.",
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
				return failEmptyIndex(toolCallId, "peek_skill");
			}
			const parsedId = parseSkillId(params.id);
			if (parsedId.error !== undefined) {
				return failPeekSkill(toolCallId, failureSource(parsedId));
			}
			if (parsedId.refPath !== undefined) {
				return failPeekSkill(toolCallId, {
					error: `skill ref path '${parsedId.refPath}' is not supported by peek_skill`,
					code: "TOOL_REF_PATH_UNSUPPORTED",
					evidence: { kind: "none" },
				});
			}
			const resolved = resolveSkillId(
				registry.entries,
				parsedId.storage,
				parsedId.name,
			);
			if (resolved.error !== undefined) {
				return failPeekSkill(toolCallId, failureSource(resolved));
			}
			const entry = registry.entries.find(
				(e) => e.storage === resolved.storage && e.name === resolved.name,
			);
			if (entry === undefined) {
				return failPeekSkill(toolCallId, {
					error: `skill '${formatSkillId(resolved.storage, resolved.name)}' resolved but has no registry entry`,
					code: "ENTRY_UNREACHABLE",
					evidence: { kind: "none" },
				});
			}
			const conflictNames = new Set(
				(registry.conflicts ?? []).map((conflict) => conflict.name),
			);
			const displayId = conflictNames.has(entry.name) ? entry.id : entry.name;
			const resolvedFile = resolveSkillFile(entry.baseDir);
			if (resolvedFile.error !== undefined) {
				return failPeekSkill(toolCallId, failureSource(resolvedFile));
			}
			const read = readSkillFile(resolvedFile.path);
			if (read.error !== undefined) {
				return failPeekSkill(toolCallId, failureSource(read));
			}
			const section = extractSection(read.text, "When to Use");
			if (section === undefined) {
				return failPeekSkill(toolCallId, {
					error: `skill '${resolvedFile.path}' does not contain a '## When to Use' section`,
					code: "SKILL_NO_WHEN_TO_USE",
					evidence: { kind: "none" },
				});
			}
			const content = wrapSkillPeekBlock(
				entry.name,
				resolvedFile.path,
				section.content,
			);
			return textResult(content, {
				name: entry.name,
				storage: entry.storage,
				path: resolvedFile.path,
				bytes: section.bytes,
				lines: section.lines,
				content,
				payload: buildPeekSkillPayload(
					displayId,
					resolvedFile.path,
					section.content,
				),
			} satisfies PeekSkillDetails);
		},
		renderCall: (
			args: { id?: string },
			theme: unknown,
			context: { isPartial?: boolean },
		) => {
			if (context.isPartial === false) {
				return new deps.Container();
			}
			return paint(
				{
					tool: "peek_skill",
					phase: "pending",
					args: typeof args?.id === "string" ? { id: args.id } : undefined,
					keyHint: deps.expandKeyHint,
				},
				theme,
			);
		},
		renderResult: (
			result: {
				content?: ReadonlyArray<{ type: string; text?: string }>;
				details?: unknown;
			},
			options: { expanded: boolean; isPartial?: boolean },
			theme: unknown,
			context: {
				args?: { id?: string };
				isError?: boolean;
				state?: { payload?: TransportPayload };
				toolCallId?: string;
			},
		) => {
			if (options.isPartial === true) {
				return new deps.Container();
			}
			const payload = resolveCallPayload({
				tool: "peek_skill",
				details: result.details,
				retained: context.state?.payload,
				isError: context.isError === true,
				toolCallId: context.toolCallId,
			});
			if (payload !== undefined && context.state !== undefined) {
				context.state.payload = payload;
			}
			const id = context.args?.id;
			return paint(
				{
					tool: "peek_skill",
					phase: options.expanded ? "expanded" : "collapsed",
					payload,
					args: typeof id === "string" ? { id } : undefined,
					keyHint: deps.expandKeyHint,
				},
				theme,
			);
		},
	};
}
