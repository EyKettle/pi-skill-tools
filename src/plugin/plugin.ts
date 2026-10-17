/**
 * The plugin: the one module that knows the host.
 *
 * Everything it takes from `@earendil-works/pi-coding-agent` arrives through a
 * dynamic import inside this file, so the rest of the tree compiles and tests
 * without the host. What it builds is wiring: configuration, the index
 * snapshot, the loaded set and its ports, the tool layer's deps, the ten
 * tools with their cards, the four commands, the status bar, and the mount
 * segment.
 */
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { buildIndex, resolveLocations } from "../discovery/registry";
import type { Index, RegistryEntry } from "../discovery/types";
import { readSkillFile, resolveSkillFile } from "../files/read";
import { walkFiles } from "../files/list";
import type { ManagementPorts } from "../management/types";
import { GUIDANCE_TEXT } from "../model-channel/guidance";
import { createSkillTree } from "../skill-tree/assembly";
import type {
	CommitEntry,
	PathCommit,
	SkillTree,
	SkillTreeReport,
} from "../skill-tree/types";
import { renderCard } from "../tui-channel/cards";
import { isTransportPayload } from "../tui-channel/payload";
import { presentRow } from "../tui-channel/presentation";
import { renderStatus } from "../tui-channel/status";
import type { TransportPayload } from "../tui-channel/types";
import { buildSkillToolsSegment } from "../deps/tail-prompt";
import { defineCancelSkillTool } from "../tools/cancel-skill";
import { defineCreateSkillTool } from "../tools/create-skill";
import { defineImportSkillTool } from "../tools/import-skill";
import { defineListSkillFilesTool } from "../tools/list-skill-files";
import { defineListSkillsTool } from "../tools/list-skills";
import { defineListSkillTagsTool } from "../tools/list-skill-tags";
import { definePreviewSkillTool } from "../tools/preview-skill";
import { defineRemoveSkillTool } from "../tools/remove-skill";
import { defineRenameSkillTool } from "../tools/rename-skill";
import { defineSearchSkillTool } from "../tools/search-skill";
import type { ToolDeps } from "../tools/types";
import { runCommand } from "./commands";
import type { CommandName } from "./commands";
import { appendGuidance, installContextHooks } from "./hooks";
import type { EventSource } from "./hooks";
import { resolveConfig } from "./settings";
import type { ResolvedConfig } from "./settings";

/** The `customType` the commit entries ride. */
export const COMMIT_ENTRY_TYPE = "skill-tools-commit";

/** The key the status bar segment registers under. */
export const STATUS_KEY = "skill-tools";

/** The tail prompt's two events, as that extension publishes them. */
const TAIL_PROMPT_REGISTER_EVENT = "tail-prompt:register";
const TAIL_PROMPT_READY_EVENT = "tail-prompt:ready";

/** The tools whose call changes what is on disk. */
const WRITES: ReadonlySet<string> = new Set([
	"create_skill",
	"rename_skill",
	"remove_skill",
]);

/** The tools whose card is its labels, without the default shell. */
const LABEL_ONLY: ReadonlySet<string> = new Set(["import_skill", "cancel_skill"]);

export async function createPlugin(pi: ExtensionAPI): Promise<void> {
	const host = await import("@earendil-works/pi-coding-agent");
	const { openSessionState } = await import("pi-session-state");
	const agentDir = host.getAgentDir();
	const configDirName = host.CONFIG_DIR_NAME;

	// --- configuration and the index snapshot --------------------------------

	let cwd = process.cwd();
	let config: ResolvedConfig = resolveConfig({ agentDir, cwd, configDirName });
	let index: Index = buildSnapshot(config, agentDir, cwd, host);

	function refreshIndex(at?: string): Index {
		if (at !== undefined) cwd = at;
		config = resolveConfig({ agentDir, cwd, configDirName });
		index = buildSnapshot(config, agentDir, cwd, host);
		return index;
	}

	// --- the loaded set ------------------------------------------------------

	const sessionState = openSessionState<unknown>({
		pluginId: "skill-tools",
		scope: "session",
	});

	/** The context the ports act on, carried across events. */
	let current: ExtensionContext | undefined;

	const pathCommits = (): readonly PathCommit[] => {
		if (current === undefined) return [];
		const commits: PathCommit[] = [];
		for (const entry of current.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== COMMIT_ENTRY_TYPE) {
				continue;
			}
			commits.push({ id: entry.id, entry: entry.data as CommitEntry });
		}
		return commits;
	};

	const tree: SkillTree = createSkillTree({
		readCopy: () =>
			current === undefined ? undefined : sessionState.read(current),
		writeCopy: (copy) => {
			if (current !== undefined) sessionState.write(current, copy);
		},
		readPath: pathCommits,
		leafId: () => current?.sessionManager.getLeafId() ?? "",
		appendEntry: (entry) => pi.appendEntry(COMMIT_ENTRY_TYPE, entry),
		registerSegment: (text) =>
			pi.events.emit(
				TAIL_PROMPT_REGISTER_EVENT,
				buildSkillToolsSegment(text),
			),
		report: (reason) => {
			if (ctxHasUi(current)) current.ui.notify(reportText(reason), "warning");
		},
		historyEnabled: () => config.historyEnabled,
		readBody: (entry, refPath) => bodyOf(entry, refPath),
	});

	// --- the status bar ------------------------------------------------------

	function refreshStatus(): void {
		if (!ctxHasUi(current)) return;
		const text = renderStatus(tree.state.length);
		current.ui.setStatus(STATUS_KEY, text.length === 0 ? undefined : text);
	}

	// --- the tool layer ------------------------------------------------------

	const management = (): ManagementPorts => ({
		index,
		defaultLocation: config.defaultLocation,
		listFiles: (root) => {
			const walked = walkFiles(root, {
				skipHidden: false,
				ignoredDirectories: new Set<string>(),
				minDepth: 0,
			});
			return walked.ok
				? { ok: true, files: walked.files.map((file) => file.path) }
				: walked;
		},
		resolveRef: (baseDir, refPath) => {
			const resolved = resolveSkillFile(baseDir, refPath);
			return resolved.ok
				? { ok: true, path: resolved.path }
				: { ok: false, failure: resolved.failure };
		},
	});

	const deps: ToolDeps = { index: () => index, tree, management };

	const tools = [
		defineListSkillsTool(deps),
		defineListSkillTagsTool(deps),
		defineListSkillFilesTool(deps),
		definePreviewSkillTool(deps),
		defineSearchSkillTool(deps),
		defineImportSkillTool(deps),
		defineCancelSkillTool(deps),
		defineCreateSkillTool(deps),
		defineRenameSkillTool(deps),
		defineRemoveSkillTool(deps),
	];

	for (const tool of tools) {
		pi.registerTool({
			name: tool.name,
			label: tool.label,
			description: tool.description,
			parameters: tool.parameters,
			renderShell: LABEL_ONLY.has(tool.name) ? "self" : "default",
			async execute(_id, params, _signal, _onUpdate, ctx) {
				current = ctx;
				const outcome = tool.execute(params as Record<string, unknown>);
				if (WRITES.has(tool.name)) refreshIndex(ctx.cwd);
				refreshStatus();
				return {
					content: [{ type: "text" as const, text: outcome.content }],
					details: outcome.details,
					isError: outcome.isError,
				};
			},
			renderCall(args, theme, context) {
				return renderCard(
					presentRow(undefined, {
						tool: tool.name,
						args: args as Record<string, unknown>,
						expanded: context.expanded,
					}),
					theme,
				);
			},
			renderResult(result, options, theme, context) {
				return renderCard(
					presentRow(payloadOf(result.details), {
						tool: tool.name,
						args: context.args as Record<string, unknown>,
						expanded: options.expanded,
						content: textOf(result.content),
					}),
					theme,
				);
			},
		});
	}

	// --- the four commands ---------------------------------------------------

	const commands: readonly { name: CommandName; description: string }[] = [
		{ name: "loaded", description: "Show the loaded skill set" },
		{ name: "import", description: "Load or refresh skills by ID" },
		{ name: "cancel", description: "Unload skills by ID" },
		{ name: "clear", description: "Unload every loaded skill" },
	];

	for (const command of commands) {
		pi.registerCommand(`skill:${command.name}`, {
			description: command.description,
			async handler(args, ctx) {
				current = ctx;
				const message = runCommand(
					{
						tree,
						index: () => index,
						historyEnabled: () => config.historyEnabled,
						afterChange: refreshStatus,
					},
					command.name,
					args,
				);
				if (ctx.hasUI) ctx.ui.notify(message, "info");
			},
		});
	}

	// --- the session hooks ---------------------------------------------------

	// SAFETY: pi's `on` is overloaded per event name, so one structural
	// interface cannot describe it. Every name in `ContextEvent` exists on the
	// host with a (event, ctx) handler, and the handlers below ignore the event.
	const events = pi as unknown as EventSource<ExtensionContext>;
	installContextHooks<ExtensionContext>(events, {
		start(ctx) {
			current = ctx;
			refreshIndex(ctx.cwd);
			reportLocationIssues(ctx, agentDir, config);
			tree.start();
			refreshStatus();
		},
		navigate(ctx) {
			current = ctx;
			tree.navigate();
			refreshStatus();
		},
		shutdown() {
			current = undefined;
		},
	});

	pi.on("before_agent_start", (event, ctx) => {
		current = ctx;
		refreshIndex(ctx.cwd);
		return {
			systemPrompt: appendGuidance(event.systemPrompt, GUIDANCE_TEXT),
		};
	});

	pi.events.on(TAIL_PROMPT_READY_EVENT, () => {
		tree.start();
		refreshStatus();
	});
}

// ---------------------------------------------------------------------------
// helpers

function ctxHasUi(ctx: ExtensionContext | undefined): ctx is ExtensionContext {
	return ctx !== undefined && ctx.hasUI;
}

function reportText(reason: SkillTreeReport): string {
	return reason.kind === "fold-aborted"
		? `skill-tools: the commit log could not be folded (${reason.error}); using the stored copy.`
		: "skill-tools: history recording is off; changes enter no commit log.";
}

/** One index snapshot: the scanned locations plus the host's own skills. */
function buildSnapshot(
	config: ResolvedConfig,
	agentDir: string,
	cwd: string,
	host: typeof import("@earendil-works/pi-coding-agent"),
): Index {
	const loaded = host.loadSkills({
		cwd,
		agentDir,
		skillPaths: [],
		includeDefaults: true,
	});
	const inherited = loaded.skills.map((skill) => ({
		name: skill.name,
		filePath: skill.filePath,
		baseDir: skill.baseDir,
		origin: skill.sourceInfo.origin,
		scope: skill.sourceInfo.scope,
	}));
	return buildIndex({
		agentDir,
		cwd,
		registry: { disable: config.disable, paths: config.paths },
		inherited: {
			package: inherited.filter((skill) => skill.origin === "package"),
			temp: inherited.filter(
				(skill) => skill.scope === "temporary" && skill.origin !== "package",
			),
		},
	});
}

/** A skill's body, read whole and contained in its directory. */
function bodyOf(entry: RegistryEntry, refPath: string | undefined) {
	const resolved = resolveSkillFile(entry.baseDir, refPath);
	if (!resolved.ok) return { ok: false as const, failure: resolved.failure };
	const read = readSkillFile(resolved.path);
	if (!read.ok) return { ok: false as const, failure: read.failure };
	return { ok: true as const, path: resolved.path, text: read.text };
}

/** The card's payload, if the result carries one this build understands. */
function payloadOf(details: unknown): TransportPayload | undefined {
	return isTransportPayload(details) ? details : undefined;
}

/** The model text a result carries, joined for the card. */
function textOf(
	content: readonly { readonly type: string; readonly text?: string }[],
): string {
	const texts: string[] = [];
	for (const part of content) {
		if (part.type === "text" && typeof part.text === "string") {
			texts.push(part.text);
		}
	}
	return texts.join("\n");
}

/** Report every configured path that could not become a location, once. */
function reportLocationIssues(
	ctx: ExtensionContext,
	agentDir: string,
	config: ResolvedConfig,
): void {
	if (!ctx.hasUI) return;
	const { issues } = resolveLocations({
		agentDir,
		cwd: ctx.cwd,
		registry: { disable: config.disable, paths: config.paths },
	});
	if (issues.length === 0) return;
	const lines = issues.map((issue) =>
		issue.reason === "reserved"
			? `${issue.id}: reserved by a built-in location`
			: `${issue.id}: not a valid location id`,
	);
	ctx.ui.notify(
		`skill-tools: ignoring configured discovery paths\n${lines.join("\n")}`,
		"warning",
	);
}
