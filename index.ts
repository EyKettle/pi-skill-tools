/**
 * skill-tools extension entry: registers the seven skill tools (list_skills,
 * list_skill_tags, search_skills, view_skill, peek_skill, list_skill_files, create_skill)
 * plus a `before_agent_start` hook that caches pi's loaded skill set and
 * appends the view_skill adoption guidance to the system prompt (design §5.7).
 *
 * Thin controller — each tool's `execute`/`renderCall`/`renderResult` and
 * model-channel output builder live in `tools/*.ts` under a `define*`
 * factory (e.g. `defineListSkills` in `tools/list-skills.ts`). This file only
 * owns the dynamic pi-runtime imports, the skill cache + system-prompt
 * append hook, the `registryDeps` wiring, and the assembly that hands those
 * runtime pieces to each factory before registering.
 *
 * Pi-runtime packages (@earendil-works/pi-coding-agent, @earendil-works/pi-tui,
 * typebox) are imported dynamically inside the default export so jiti hands
 * over the host instance rather than a vendored copy. Type-only imports and
 * test accessors may resolve from this package's node_modules. The error
 * signal is pi's throw-from-`execute` contract (extensions.md 2887-2891):
 * failures throw Error messages that carry the `error:` / `suggestions:`
 * framing inside the text, because that message becomes `content[0].text`
 * for the LLM.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import type {
	ExtensionAPI,
	ExtensionContext,
	Skill,
} from "@earendil-works/pi-coding-agent";
import { buildRegistry } from "./registry";
import type { Registry } from "./registry";
import { parseFrontmatterBlock } from "./frontmatter";
import { SHADOW_SCAN_SOURCE, clearThrownFailures } from "./tools/shared";
import type { ToolDeps } from "./tools/shared";
import { defineListSkills } from "./tools/list-skills";
import { defineListSkillTags } from "./tools/list-skill-tags";
import { defineSearchSkills } from "./tools/search-skills";
import { defineViewSkill } from "./tools/view-skill";
import { definePeekSkill } from "./tools/peek-skill";
import { defineListSkillFiles } from "./tools/list-skill-files";
import { defineCreateSkill } from "./tools/create-skill";
import { release, clear } from "./correlation";
import {
	buildSkillToolsSegment,
	TAIL_PROMPT_READY_EVENT,
	TAIL_PROMPT_REGISTER_EVENT,
} from "./deps/tail-prompt";
import { diffText } from "./delta";
import { cancel, EMPTY_SET, encode, load, tryDecode } from "./state";
import type {
	CancelFailure,
	EncodedState,
	LoadFailure,
	LoadedSet,
	LoadOutcome,
	StateEntry,
} from "./state";
import { copyIsCurrent, fold } from "./log";
import type { CommitEntry, CommitOperation } from "./log";
import { renderSkillBlock } from "./skill-block";
import { historyEnabled } from "./history-setting";
/** The customType the commit entries ride. */
export const COMMIT_ENTRY_TYPE = "skill-tools-commit";

/** The stored copy: the state and the marker it was settled at. */
export interface StoredCopy {
	marker?: string;
	state: EncodedState;
}

/** One commit entry with the session entry id it was appended as. */
export interface PathCommit {
	id: string;
	entry: CommitEntry;
}

/** A history-layer report reason; each reports once per session. */
export type ReportReason =
	| "fold-aborted"
	| "baseline-after-gap"
	| "no-log-coverage"
	| "history-off";

/** What the assembly reads and drives; the default export wires it to Pi. */
export interface AssemblyPorts {
	store: {
		read(ctx: ExtensionContext): unknown;
		write(ctx: ExtensionContext, value: StoredCopy): void;
	};
	historyEnabled(): boolean;
	pathCommits(ctx: ExtensionContext, fromId?: string | null): PathCommit[];
	leafId(ctx: ExtensionContext): string | undefined;
	appendCommit(entry: CommitEntry): void;
	registerSegment(text: string): void;
	notify(ctx: ExtensionContext, message: string): void;
}

/** One change: entries to load and ids to cancel. */
export interface SkillChangeRequest {
	loads?: readonly StateEntry[];
	cancels?: readonly string[];
}

export type ChangeResult =
	| { ok: true; outcomes: readonly LoadOutcome[]; removed: readonly StateEntry[] }
	| {
			ok: false;
			loadFailures: readonly LoadFailure[];
			cancelFailures: readonly CancelFailure[];
	  };

export interface SkillStateAssembly {
	start(ctx: ExtensionContext): void;
	navigate(ctx: ExtensionContext, newLeafId: string | null): void;
	change(ctx: ExtensionContext, request: SkillChangeRequest): ChangeResult;
	ready(): void;
	shutdown(): void;
	current(): LoadedSet;
}

/** The operations a change lands as, in the commit table's terms. */
function operationsOf(
	previous: LoadedSet,
	loads: readonly StateEntry[],
	outcomes: readonly LoadOutcome[],
	removed: readonly StateEntry[],
): CommitOperation[] {
	const operations: CommitOperation[] = [];
	const working: StateEntry[] = [...previous.entries];
	loads.forEach((entry, index) => {
		const outcome = outcomes[index];
		if (outcome === "added") {
			operations.push({ kind: "load", entry });
			working.push(entry);
			return;
		}
		if (outcome === "replaced") {
			const at = working.findIndex((existing) => existing.id === entry.id);
			operations.push({
				kind: "replace",
				id: entry.id,
				hunks: diffText(working[at].body, entry.body),
			});
			working[at] = entry;
		}
	});
	for (const entry of removed) {
		operations.push({ kind: "remove", id: entry.id });
	}
	return operations;
}

/** The copy a stored value carries, or undefined when it is not one. */
function decodeCopy(
	value: unknown,
): { marker: string | undefined; state: LoadedSet } | undefined {
	if (typeof value !== "object" || value === null) {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	if (record.marker !== undefined && typeof record.marker !== "string") {
		return undefined;
	}
	const state = tryDecode(record.state);
	if (state === undefined) {
		return undefined;
	}
	return { marker: record.marker, state };
}

/**
 * The session assembly: the loaded set in memory, its commit log on the
 * session tree, its copy in session-state, and its one segment on
 * tail-prompt. The write order is log first, copy second, republish third; a
 * refused copy write leaves memory and the log advanced.
 */
export function createAssembly(ports: AssemblyPorts): SkillStateAssembly {
	let state: LoadedSet = EMPTY_SET;
	let gapPending = false;
	const reported = new Set<ReportReason>();

	function notifyOnce(
		ctx: ExtensionContext,
		reason: ReportReason,
		message: string,
	): void {
		if (reported.has(reason)) {
			return;
		}
		reported.add(reason);
		ports.notify(ctx, message);
	}

	function writeCopy(
		ctx: ExtensionContext,
		next: LoadedSet,
		marker: string | undefined,
	): void {
		try {
			ports.store.write(ctx, { marker, state: encode(next) });
		} catch {
			// Memory and the log have advanced; the next successful write repairs.
		}
	}

	function republish(): void {
		ports.registerSegment(renderSkillBlock(state));
	}

	function start(ctx: ExtensionContext): void {
		const path = ports.pathCommits(ctx);
		const copy = decodeCopy(ports.store.read(ctx));
		const lastId = path.at(-1)?.id;
		if (copy !== undefined && copy.marker === undefined) {
			gapPending = true;
		}
		if (copy !== undefined && copyIsCurrent(copy, lastId)) {
			state = copy.state;
		} else {
			const folded = fold(path.map((commit) => commit.entry));
			if (folded.ok) {
				state = folded.state;
				writeCopy(ctx, state, lastId);
			} else {
				state = copy?.state ?? EMPTY_SET;
				notifyOnce(
					ctx,
					"fold-aborted",
					`skill-tools: the commit log could not be folded (${folded.error}); using the stored copy.`,
				);
			}
		}
		if (path.length === 0 && copy !== undefined) {
			notifyOnce(
				ctx,
				"no-log-coverage",
				"skill-tools: this path has no commit log; the loaded set rests on the stored copy.",
			);
		}
		republish();
	}

	function navigate(ctx: ExtensionContext, newLeafId: string | null): void {
		const path = ports.pathCommits(ctx, newLeafId);
		const folded = fold(path.map((commit) => commit.entry));
		if (folded.ok) {
			state = folded.state;
			writeCopy(ctx, state, path.at(-1)?.id);
		} else {
			const copy = decodeCopy(ports.store.read(ctx));
			state = copy?.state ?? state;
			notifyOnce(
				ctx,
				"fold-aborted",
				`skill-tools: the commit log could not be folded (${folded.error}); using the stored copy.`,
			);
		}
		republish();
	}

	function change(
		ctx: ExtensionContext,
		request: SkillChangeRequest,
	): ChangeResult {
		const loads = request.loads ?? [];
		const cancels = request.cancels ?? [];
		const loaded = load(state, loads);
		if (!loaded.ok) {
			return { ok: false, loadFailures: loaded.failures, cancelFailures: [] };
		}
		const cancelled = cancel(loaded.set, cancels);
		if (!cancelled.ok) {
			return { ok: false, loadFailures: [], cancelFailures: cancelled.failures };
		}
		const next = cancelled.set;
		const operations = operationsOf(state, loads, loaded.outcomes, cancelled.removed);
		if (operations.length === 0) {
			return { ok: true, outcomes: loaded.outcomes, removed: cancelled.removed };
		}
		if (ports.historyEnabled()) {
			if (gapPending) {
				ports.appendCommit({ kind: "baseline", entries: next.entries });
				gapPending = false;
				notifyOnce(
					ctx,
					"baseline-after-gap",
					"skill-tools: history recording resumed; the first commit entry is a baseline.",
				);
			} else {
				ports.appendCommit({ kind: "delta", operations });
			}
			writeCopy(ctx, next, ports.leafId(ctx));
		} else {
			writeCopy(ctx, next, undefined);
			gapPending = true;
			notifyOnce(
				ctx,
				"history-off",
				"skill-tools: history recording is off; changes are not entering the commit log.",
			);
		}
		state = next;
		republish();
		return { ok: true, outcomes: loaded.outcomes, removed: cancelled.removed };
	}

	function ready(): void {
		republish();
	}

	function shutdown(): void {
		state = EMPTY_SET;
		gapPending = false;
		reported.clear();
	}

	return {
		start,
		navigate,
		change,
		ready,
		shutdown,
		current: () => state,
	};
}
export default async function (pi: ExtensionAPI): Promise<void> {
	const piApi = await import("@earendil-works/pi-coding-agent");
	const { Type } = await import("typebox");
	const { Text, Box, Container } = await import("@earendil-works/pi-tui");
	const { keyHint, loadSkillsFromDir, withFileMutationQueue } = piApi;
	const agentDir = piApi.getAgentDir();
	const configDirName = piApi.CONFIG_DIR_NAME;

	// --- Skill cache + adoption-append hook (design §3.1, §5.7) ----------------

	/** pi's loaded skill set, captured on every before_agent_start. */
	let cachedSkills: Skill[] = [];

	/** view_skill adoption guidance (design §5.7; tail-prompt chaining shape). */
	const appendedSystemPrompt =
		"\n\nLoad skills with view_skill: pi's read tool truncates long files, so a " +
		"skill would arrive incomplete.";

	pi.on("before_agent_start", (event) => {
		cachedSkills = event.systemPromptOptions.skills ?? [];
		// The return chains with tail-prompt's own modification through the
		// runner's per-handler systemPrompt rebuild (design §5.7-5.8).
		return { systemPrompt: event.systemPrompt + appendedSystemPrompt };
	});

	// --- Failure-correlation lifecycle (plan Task 4) --------------------------
	// Association state is released when a tool execution ends and cleared
	// when the session shuts down (design.md §错误处理). The thrown-failure
	// stash must outlive tool_execution_end — that is why it exists — so it
	// is cleared here, not on release. Renderers recover through the stash
	// (`recoverThrownFailure`), not through `correlation.claim`.

	pi.on("tool_execution_end", (event) => {
		release(event.toolCallId);
	});

	pi.on("session_shutdown", () => {
		assembly.shutdown();
		clear();
		clearThrownFailures();
	});

	/** keyHint bound to pi's Keybindings lookup, as a plain string fn. */
	const expandKeyHint = (bindingKey: string, fallback: string): string =>
		keyHint(bindingKey as never, fallback);

	/** Build the skill index for one tool call (design §2.1, §3.3). */
	function registryDeps(ctx: {
		cwd: string;
		isProjectTrusted(): boolean;
	}): Registry {
		return buildRegistry({
			activeSkills: cachedSkills,
			scanDir: (dir) =>
				loadSkillsFromDir({ dir, source: SHADOW_SCAN_SOURCE }).skills,
			readFrontmatter: (filePath) =>
				parseFrontmatterBlock(readFileSync(filePath, "utf8")).data,
			agentDir,
			configDirName,
			cwd: ctx.cwd,
			homeDir: homedir(),
			isProjectTrusted: () => ctx.isProjectTrusted(),
		});
	}

	/** Runtime pieces handed to every per-tool factory. */
	const deps: ToolDeps = {
		registryDeps,
		Type: Type as ToolDeps["Type"],
		Text: Text as ToolDeps["Text"],
		Box: Box as ToolDeps["Box"],
		Container: Container as ToolDeps["Container"],
		expandKeyHint,
		withFileMutationQueue:
			withFileMutationQueue as ToolDeps["withFileMutationQueue"],
	};

	const config = { agentDir, configDirName };

	// --- Session assembly: copy, log, and mount --------------------------------

	const { openSessionState } = await import("pi-session-state");
	const sessionState = openSessionState<StoredCopy>({
		pluginId: "skill-tools",
		scope: "session",
	});

	/** The path's commit entries, in walk order. */
	const pathCommits = (
		ctx: ExtensionContext,
		fromId?: string | null,
	): PathCommit[] => {
		const commits: PathCommit[] = [];
		for (const entry of ctx.sessionManager.getBranch(fromId ?? undefined)) {
			if (entry.type !== "custom" || entry.customType !== COMMIT_ENTRY_TYPE) {
				continue;
			}
			commits.push({ id: entry.id, entry: entry.data as CommitEntry });
		}
		return commits;
	};

	const assembly = createAssembly({
		store: {
			read: (ctx) => sessionState.read(ctx),
			write: (ctx, value) => sessionState.write(ctx, value),
		},
		historyEnabled: () => historyEnabled(agentDir),
		pathCommits,
		leafId: (ctx) => ctx.sessionManager.getLeafId() ?? undefined,
		appendCommit: (entry) => pi.appendEntry(COMMIT_ENTRY_TYPE, entry),
		registerSegment: (text) =>
			pi.events.emit(TAIL_PROMPT_REGISTER_EVENT, buildSkillToolsSegment(text)),
		notify: (ctx, message) => {
			if (ctx.hasUI) {
				ctx.ui.notify(message, "warning");
			}
		},
	});

	pi.on("session_start", (_event, ctx) => {
		assembly.start(ctx);
	});

	pi.on("session_tree", (event, ctx) => {
		assembly.navigate(ctx, event.newLeafId);
	});

	pi.events.on(TAIL_PROMPT_READY_EVENT, () => {
		assembly.ready();
	});

	// --- Register the six tools -----------------------------------------------

	const register = pi.registerTool.bind(pi);
	register(
		defineListSkills(deps) as unknown as Parameters<typeof pi.registerTool>[0],
	);
	register(
		defineListSkillTags(deps) as unknown as Parameters<typeof pi.registerTool>[0],
	);
	register(
		defineSearchSkills(deps) as unknown as Parameters<typeof pi.registerTool>[0],
	);
	register(
		defineViewSkill(deps, config) as unknown as Parameters<
			typeof pi.registerTool
		>[0],
	);
	register(
		definePeekSkill(deps, config) as unknown as Parameters<
			typeof pi.registerTool
		>[0],
	);
	register(
		defineListSkillFiles(deps) as unknown as Parameters<
			typeof pi.registerTool
		>[0],
	);
	register(
		defineCreateSkill(deps, config) as unknown as Parameters<
			typeof pi.registerTool
		>[0],
	);
}
