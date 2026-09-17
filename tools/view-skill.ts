/**
 * `view_skill` tool definition (design.md §5.4, §6.1).
 *
 * Reads a skill file verbatim and untruncated. The model channel receives
 * the full file wrapped in an attributed `<SKILL name location>` block; the
 * TUI paints a self-drawn card from presentation.ts (renderShell "self" has
 * no auto background). pi-runtime pieces (TypeBox, Text/Box/Container) come
 * through `ToolDeps`.
 */

import type {
	FailureSource,
	ToolDeps,
	ToolTextResult,
	ViewSkillDetails,
} from "./shared";
import {
	countTextLines,
	failError,
	failEmptyIndex,
	failureSource,
	resolveCallPayload,
	textResult,
	themeLike,
} from "./shared";
import type { ThemeLike } from "../presentation";
import {
	presentRow,
	type ProjectInput,
	type SlotComponents,
} from "../presentation";
import type { TransportPayload } from "../transport";
import { buildViewSkillPayload } from "../transport";
import { formatSkillId, parseSkillId, resolveSkillId } from "../skill-id";
import { readSkillFile, resolveSkillFile } from "../skill-file";
import { parseFrontmatterBlock } from "../frontmatter";

/**
 * Model-channel wrapper: the complete file (or frontmatter) inside an
 * attributed open/close pair. `location` is the resolved absolute path.
 */
export function wrapSkillBlock(
	name: string,
	path: string,
	text: string,
): string {
	return `<SKILL name="${name}" location="${path}">\n${text}\n</SKILL>`;
}



interface ViewCardState {
	payload?: TransportPayload;
}

interface ViewRenderContext {
	args: { id?: string };
	toolCallId: string;
	state: ViewCardState;
	isPartial: boolean;
	isError: boolean;
}

function failViewSkill(toolCallId: string, source: FailureSource): never {
	return failError(toolCallId, "view_skill", source);
}

function cardBackground(
	payload: TransportPayload | undefined,
	isError: boolean,
): "customMessageBg" | "toolErrorBg" {
	// Local union: ThemeBg is not on the public entry.
	if (payload !== undefined && payload.outcome === "failure") {
		return "toolErrorBg";
	}
	if (payload === undefined && isError) {
		return "toolErrorBg";
	}
	return "customMessageBg";
}

function slotComponents(deps: ToolDeps): SlotComponents {
	return { Text: deps.Text, Container: deps.Container };
}

function paintSkillCard(
	input: ProjectInput,
	theme: ThemeLike,
	deps: ToolDeps,
	bgRole: "customMessageBg" | "toolErrorBg",
) {
	const presented = presentRow(input, theme, slotComponents(deps));
	const card = new deps.Box(1, 1, (text: string) => theme.bg(bgRole, text));
	card.addChild(presented);
	return card;
}

function pendingInput(
	args: { id?: string },
	keyHint: ProjectInput["keyHint"],
): ProjectInput {
	const id = typeof args.id === "string" ? args.id : undefined;
	return {
		tool: "view_skill",
		phase: "pending",
		args: id === undefined ? undefined : { id },
		keyHint,
	};
}

export function defineViewSkill(
	deps: ToolDeps,
	_config: { agentDir: string; configDirName: string },
) {
	const Type = deps.Type as ToolDeps["Type"];

	return {
		name: "view_skill",
		label: "View skill",
		description:
			"Read a skill's file verbatim and untruncated, " +
			'wrapped in an attributed <SKILL name="..." location="..."> block. ' +
			"id without " +
			"a ref path reads SKILL.md; an id with /<ref path> (e.g. global:git/references/GUIDE.md) reads " +
			"that file inside the skill directory. A bare name resolves across all locations and reports " +
			"ambiguity with every match. frontmatterOnly: true returns just the frontmatter block. " +
			"Absolute and escaping ref paths are rejected.",
		parameters: Type.Object({
			id: Type.String({
				description: "Skill id, e.g. 'git' or 'global:git/references/GUIDE.md'",
			}),
			frontmatterOnly: Type.Optional(
				Type.Boolean({
					description: "Return only the leading YAML frontmatter block",
				}),
			),
		}),
		renderShell: "self" as const,
		async execute(
			toolCallId: string,
			params: { id: string; frontmatterOnly?: boolean },
			_signal: unknown,
			_onUpdate: unknown,
			ctx: { cwd: string; isProjectTrusted(): boolean },
		): Promise<ToolTextResult> {
			const registry = deps.registryDeps(ctx);
			if (registry.indexEmpty) {
				return failEmptyIndex(toolCallId, "view_skill");
			}
			const parsedId = parseSkillId(params.id);
			if (parsedId.error !== undefined) {
				return failViewSkill(
					toolCallId,
					failureSource(parsedId),
				);
			}
			const resolved = resolveSkillId(
				registry.entries,
				parsedId.storage,
				parsedId.name,
			);
			if (resolved.error !== undefined) {
				return failViewSkill(
					toolCallId,
					failureSource(resolved),
				);
			}
			const entry = registry.entries.find(
				(e) => e.storage === resolved.storage && e.name === resolved.name,
			);
			if (entry === undefined) {
				return failViewSkill(toolCallId, {
					error: `skill '${formatSkillId(resolved.storage, resolved.name)}' resolved but has no registry entry`,
					code: "ENTRY_UNREACHABLE",
					evidence: { kind: "none" },
				});
			}
			const conflictNames = new Set(
				(registry.conflicts ?? []).map((conflict) => conflict.name),
			);
			const displayId = conflictNames.has(entry.name) ? entry.id : entry.name;
			const resolvedFile = resolveSkillFile(entry.baseDir, parsedId.refPath);
			if (resolvedFile.error !== undefined) {
				return failViewSkill(
					toolCallId,
					failureSource(resolvedFile),
				);
			}
			const read = readSkillFile(resolvedFile.path);
			if (read.error !== undefined) {
				return failViewSkill(toolCallId, failureSource(read));
			}
			if (params.frontmatterOnly === true) {
				const parsedBlock = parseFrontmatterBlock(read.text);
				if (parsedBlock.raw === undefined) {
					return failViewSkill(toolCallId, {
						error: `no frontmatter block in '${resolvedFile.path}'`,
						code: "FILE_NO_FRONTMATTER",
						evidence: { kind: "none" },
					});
				}
				const frontmatterText = read.text.slice(0, parsedBlock.bodyStart);
				const content = wrapSkillBlock(
					entry.name,
					resolvedFile.path,
					frontmatterText,
				);
				return textResult(content, {
					name: entry.name,
					storage: entry.storage,
					path: resolvedFile.path,
					bytes: Buffer.byteLength(frontmatterText, "utf8"),
					lines: countTextLines(frontmatterText),
					content,
					payload: buildViewSkillPayload(
						displayId,
						resolvedFile.path,
						frontmatterText,
					),
					format: "frontmatter",
				} satisfies ViewSkillDetails);
			}
			const content = wrapSkillBlock(entry.name, resolvedFile.path, read.text);
			return textResult(content, {
				name: entry.name,
				storage: entry.storage,
				path: resolvedFile.path,
				bytes: read.bytes,
				lines: read.lines,
				content,
				payload: buildViewSkillPayload(displayId, resolvedFile.path, read.text),
				format: "full",
			} satisfies ViewSkillDetails);
		},
		renderCall: (
			args: { id?: string },
			theme: unknown,
			context: ViewRenderContext,
		) => {
			if (context.isPartial !== true) {
				return new deps.Container();
			}
			return paintSkillCard(
				pendingInput(args, deps.expandKeyHint),
				themeLike(theme),
				deps,
				"customMessageBg",
			);
		},
		renderResult: (
			result: {
				content?: ReadonlyArray<{ type: string; text?: string }>;
				details?: unknown;
			},
			options: { expanded: boolean; isPartial?: boolean },
			theme: unknown,
			context: ViewRenderContext,
		) => {
			if (options.isPartial === true) {
				return new deps.Container();
			}
			const payload = resolveCallPayload({
				tool: "view_skill",
				details: result.details,
				retained: context.state.payload,
				isError: context.isError,
				toolCallId: context.toolCallId,
			});
			if (payload !== undefined) {
				context.state.payload = payload;
			}
			const id = context.args?.id;
			const input: ProjectInput = {
				tool: "view_skill",
				phase: options.expanded ? "expanded" : "collapsed",
				payload,
				args: typeof id === "string" ? { id } : undefined,
				keyHint: deps.expandKeyHint,
			};
			return paintSkillCard(
				input,
				themeLike(theme),
				deps,
				cardBackground(payload, context.isError),
			);
		},
	};
}
