/**
 * `create_skill` tool definition (design.md §5.6).
 *
 * Write-like scaffold: `<root>/<name>/SKILL.md` is written with the
 * model-supplied content verbatim — frontmatter included, no generated
 * skeleton. Storage comes only from the id prefix (global default);
 * `package` is rejected; conflicts and existing dirs are intercepted; the
 * write goes through pi's file-mutation queue.
 *
 * The TUI row is projected from presentation.ts. Live line/byte counts
 * come from Channel A (argument stream in renderCall). Execute emits one
 * eager Channel B update so the pending form survives the write, then
 * never updates after the promise settles.
 */

import * as path from "node:path";
import type { FailureSource, ToolDeps, ToolTextResult } from "./shared";
import {
	countTextLines,
	failError,
	failureSource,
	resolveCallPayload,
	textResult,
	themeLike,
} from "./shared";
import { presentRow } from "../presentation";
import type { ProjectInput, SlotComponents } from "../presentation";
import { buildCreateSkillPayload } from "../transport";
import type { TransportPayload } from "../transport";
import { formatSkillId, parseSkillId } from "../skill-id";
import type { SkillStorage } from "../skill-id";
import { createSkill } from "../skill-create";


interface StreamProgress {
	length: number;
	newlines: number;
	bytes: number;
	/** Cumulative UTF-8 bytes `scanChunk` actually walked. */
	visited: number;
}

interface CreateRenderState {
	progress?: StreamProgress;
	payload?: TransportPayload;
}

interface RenderContext {
	lastComponent?: unknown;
	state?: CreateRenderState;
	executionStarted?: boolean;
	isPartial?: boolean;
	expanded?: boolean;
	toolCallId?: string;
	isError?: boolean;
	args?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function stringArg(args: unknown, key: string): string {
	if (!isRecord(args)) {
		return "";
	}
	const value = args[key];
	return typeof value === "string" ? value : "";
}

function scanChunk(text: string): { newlines: number; bytes: number } {
	let newlines = 0;
	for (let i = 0; i < text.length; i++) {
		if (text.charCodeAt(i) === 10) {
			newlines++;
		}
	}
	return { newlines, bytes: Buffer.byteLength(text, "utf8") };
}

/** O(delta) append scan; full rescan only when the argument shrinks. */
function accumulateProgress(
	content: string,
	prior: StreamProgress | undefined,
): StreamProgress {
	if (prior === undefined || content.length < prior.length) {
		const scanned = scanChunk(content);
		return {
			length: content.length,
			newlines: scanned.newlines,
			bytes: scanned.bytes,
			visited: (prior?.visited ?? 0) + scanned.bytes,
		};
	}
	const suffix = content.slice(prior.length);
	if (suffix.length === 0) {
		return prior;
	}
	const scanned = scanChunk(suffix);
	return {
		length: content.length,
		newlines: prior.newlines + scanned.newlines,
		bytes: prior.bytes + scanned.bytes,
		visited: prior.visited + scanned.bytes,
	};
}

function lineCount(content: string, newlines: number): number {
	if (content.length === 0) {
		return 0;
	}
	return newlines + (content.endsWith("\n") ? 0 : 1);
}

function rowState(context: RenderContext): CreateRenderState {
	const state = (context.state ?? {}) as CreateRenderState;
	context.state = state;
	return state;
}

function isPending(context: RenderContext): boolean {
	return context.executionStarted !== true || context.isPartial === true;
}

function notifyUnsettled(onUpdate: unknown): void {
	if (typeof onUpdate !== "function") {
		return;
	}
	onUpdate({
		content: [{ type: "text", text: "" }],
		details: {},
	});
}

export function defineCreateSkill(
	deps: ToolDeps,
	config: { agentDir: string; configDirName: string },
) {
	const Type = deps.Type as ToolDeps["Type"];
	const components: SlotComponents = {
		Text: deps.Text,
		Container: deps.Container,
	};

	function failCreate(toolCallId: string, source: FailureSource): never {
		return failError(toolCallId, "create_skill", source);
	}

	function paint(input: ProjectInput, theme: unknown) {
		return presentRow(input, themeLike(theme), components);
	}

	function emptySlot() {
		return new deps.Container();
	}

	function pendingInput(args: unknown, progress: StreamProgress): ProjectInput {
		const content = stringArg(args, "content");
		return {
			tool: "create_skill",
			phase: "pending",
			args: { id: stringArg(args, "id") },
			progress: {
				lines: lineCount(content, progress.newlines),
				bytes: progress.bytes,
			},
			keyHint: deps.expandKeyHint,
		};
	}

	return {
		name: "create_skill",
		label: "Create skill",
		description:
			"Scaffold a new skill file as <root>/<name>/SKILL.md with the model-supplied content " +
			"written verbatim (frontmatter included). Storage comes only from the id prefix: global: → " +
			"agentDir/skills, project: → cwd/<configDirName>/skills; a bare name defaults to global; " +
			"package is rejected. Conflict interception rejects names already in the index (any location) " +
			"and existing directories; the tool never overwrites. Parameters: id, content.",
		parameters: Type.Object({
			id: Type.String({
				description: "Skill name, optionally prefixed with 'global:' or 'project:'",
			}),
			content: Type.String({
				description:
					"Complete SKILL.md content written verbatim (frontmatter included)",
			}),
		}),
		executionMode: "sequential",
		async execute(
			toolCallId: string,
			params: { id: string; content: string },
			_signal: unknown,
			onUpdate: unknown,
			ctx: { cwd: string; isProjectTrusted(): boolean },
		): Promise<ToolTextResult> {
			notifyUnsettled(onUpdate);
			const registry = deps.registryDeps(ctx);
			const parsedId = parseSkillId(params.id);
			if (parsedId.error !== undefined) {
				return failCreate(
					toolCallId,
					failureSource(parsedId),
				);
			}
			if (parsedId.refPath !== undefined) {
				return failCreate(toolCallId, {
					error:
						"create_skill takes a skill name only; a ref path in the id is not accepted",
					code: "TOOL_REF_PATH_UNSUPPORTED",
					evidence: { kind: "none" },
				});
			}
			const storage: SkillStorage = parsedId.storage ?? "global";
			const writeRoot =
				storage === "project"
					? path.join(ctx.cwd, config.configDirName, "skills")
					: path.join(config.agentDir, "skills");
			const targetPath = path.join(writeRoot, parsedId.name, "SKILL.md");
			const runExclusive = <T>(fn: () => Promise<T>) =>
				// SAFETY: pi's queue is generic over the exclusive callback's return; the runtime preserves T.
				deps.withFileMutationQueue!(
					targetPath,
					fn as () => Promise<unknown>,
				) as unknown as Promise<T>;
			const result = await createSkill(
				{
					storage,
					name: parsedId.name,
					content: params.content,
				},
				{
					registry,
					agentDir: config.agentDir,
					configDirName: config.configDirName,
					cwd: ctx.cwd,
					runExclusive,
				},
			);
			if (result.error !== undefined) {
				return failCreate(
					toolCallId,
					failureSource(result),
				);
			}
			return textResult(
				`created skill '${formatSkillId(storage, parsedId.name)}' at ${result.path}`,
				{
					storage,
					name: parsedId.name,
					path: result.path,
					lines: countTextLines(result.content),
					content: result.content,
					payload: buildCreateSkillPayload(
						parsedId.name,
						result.path,
						result.content,
					),
				},
			);
		},
		renderCall: (args: unknown, theme: unknown, context: RenderContext) => {
			const state = (context.state ?? {}) as CreateRenderState;
			context.state = state;
			const content = stringArg(args, "content");
			state.progress = accumulateProgress(content, state.progress);
			if (!isPending(context)) {
				return emptySlot();
			}
			return paint(pendingInput(args, state.progress), theme);
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
			if (options.isPartial === true) {
				return emptySlot();
			}
			const state = rowState(context);
			const payload = resolveCallPayload({
				tool: "create_skill",
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
					tool: "create_skill",
					phase: options.expanded ? "expanded" : "collapsed",
					payload,
					args: { id: stringArg(context.args, "id") },
					keyHint: deps.expandKeyHint,
				},
				theme,
			);
		},
	};
}
