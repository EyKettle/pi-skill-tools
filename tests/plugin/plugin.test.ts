/**
 * `plugin.ts`'s wiring, driven by a recording host.
 *
 * The fake host is real about one thing only: how it calls a handler —
 * `(event, ctx)`. That arity is what a plugin can get wrong silently, so every
 * test here hands the handlers an event first and a context second.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createPlugin, STATUS_KEY } from "../../src/plugin/plugin";
import type { CopyStore, PluginHost } from "../../src/plugin/plugin";
import { GUIDANCE_TEXT, PREVIEW_GUIDANCE_TEXT } from "../../src/model-channel/guidance";

const tmpDirs: string[] = [];

const resources = vi.hoisted(() => ({
	treeCreations: 0,
	storeOpens: 0,
	copyReads: 0,
	copyWrites: 0,
	copyDrops: 0,
}));

vi.mock(import("../../src/skill-tree/assembly"), async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...actual,
		createSkillTree(ports: Parameters<typeof actual.createSkillTree>[0]) {
			resources.treeCreations++;
			return actual.createSkillTree(ports);
		},
	};
});

vi.mock(import("pi-session-state"), () => ({
	openSessionState() {
		resources.storeOpens++;
		return {
			read() {
				resources.copyReads++;
				return undefined;
			},
			write() {
				resources.copyWrites++;
			},
			drop() {
				resources.copyDrops++;
			},
		};
	},
}));

beforeEach(() => {
	Object.assign(resources, {
		treeCreations: 0,
		storeOpens: 0,
		copyReads: 0,
		copyWrites: 0,
		copyDrops: 0,
	});
});

afterAll(() => {
	for (const dir of tmpDirs) {
		rmSync(dir, { recursive: true, force: true });
	}
});

interface World {
	readonly tools: string[];
	readonly commands: string[];
	readonly events: string[];
	readonly handlers: Map<
		string,
		(event: unknown, ctx: unknown) => unknown
	>;
	readonly statuses: (string | undefined)[];
	readonly notices: string[];
	readonly tailHandlers: Map<string, () => void>;
	readonly segments: { event: string; value: unknown }[];
	readonly entries: { type: string; value: unknown }[];
	branchReads: number;
	leafReads: number;
}

function world(): { pi: unknown; world: World } {
	const w: World = {
		tools: [],
		commands: [],
		events: [],
		handlers: new Map(),
		statuses: [],
		notices: [],
		tailHandlers: new Map(),
		segments: [],
		entries: [],
		branchReads: 0,
		leafReads: 0,
	};
	const pi = {
		on(event: string, handler: (e: unknown, ctx: unknown) => unknown) {
			w.events.push(event);
			w.handlers.set(event, handler);
		},
		registerTool(tool: { name: string }) {
			w.tools.push(tool.name);
		},
		registerCommand(name: string) {
			w.commands.push(name);
		},
		appendEntry(type: string, value: unknown) {
			w.entries.push({ type, value });
		},
		events: {
			on(event: string, handler: () => void) {
				w.tailHandlers.set(event, handler);
			},
			emit(event: string, value: unknown) {
				w.segments.push({ event, value });
			},
		},
	};
	return { pi, world: w };
}

function hostFor(agentDir: string): PluginHost {
	return {
		getAgentDir: () => agentDir,
		CONFIG_DIR_NAME: ".pi",
	};
}

function emptyStore(): CopyStore {
	return { read: () => undefined, write: () => {} };
}

/** A context whose session manager and UI record what reached them. */
function contextFor(cwd: string, w: World) {
	return {
		cwd,
		hasUI: true,
		ui: {
			setStatus(key: string, text: string | undefined) {
				if (key === STATUS_KEY) w.statuses.push(text);
			},
			notify(message: string) {
				w.notices.push(message);
			},
		},
		sessionManager: {
			getBranch() {
				w.branchReads += 1;
				return [];
			},
			getLeafId() {
				w.leafReads++;
				return null;
			},
		},
	};
}

function tempAgentDir(): string {
	const dir = mkdtempSync(path.join(tmpdir(), "plugin-"));
	tmpDirs.push(dir);
	mkdirSync(path.join(dir, "skills"), { recursive: true });
	return dir;
}

async function installed(enabled?: boolean, useDefaultStore = false) {
	const agentDir = tempAgentDir();
	if (enabled !== undefined) {
		writeFileSync(
			path.join(agentDir, "settings.json"),
			JSON.stringify({ skills: { skillTree: { enabled } } }),
		);
	}
	const { pi, world: w } = world();
	await createPlugin(pi as never, {
		host: hostFor(agentDir),
		...(useDefaultStore ? {} : { sessionState: emptyStore() }),
	});
	await w.handlers.get("session_start")!({ type: "session_start" }, contextFor(agentDir, w));
	return { agentDir, w };
}

describe("createPlugin", () => {
	it("waits for a session context before registering entry points or opening storage", async () => {
		const agentDir = tempAgentDir();
		const { pi, world: w } = world();
		await createPlugin(pi as never, { host: hostFor(agentDir) });

		expect(w.tools).toEqual([]);
		expect(w.commands).toEqual([]);
		expect(resources.treeCreations).toBe(0);
		expect(resources.storeOpens).toBe(0);
		expect(w.tailHandlers.size).toBe(0);
	});

	it.each([
		{ enabled: false, guidance: PREVIEW_GUIDANCE_TEXT, creations: 0 },
		{ enabled: true, guidance: GUIDANCE_TEXT, creations: 1 },
	])("initializes from the session project instead of the factory directory: $enabled", async ({ enabled, guidance, creations }) => {
		const agentDir = tempAgentDir();
		const projectDir = mkdtempSync(path.join(tmpdir(), "session-project-"));
		tmpDirs.push(projectDir);
		mkdirSync(path.join(projectDir, ".pi"));
		writeFileSync(
			path.join(agentDir, "settings.json"),
			JSON.stringify({ skills: { skillTree: { enabled: !enabled } } }),
		);
		writeFileSync(
			path.join(projectDir, ".pi", "settings.json"),
			JSON.stringify({ skills: { skillTree: { enabled } } }),
		);
		const { pi, world: w } = world();
		await createPlugin(pi as never, { host: hostFor(agentDir) });
		const ctx = contextFor(projectDir, w);
		await w.handlers.get("session_start")!({ type: "session_start" }, ctx);
		const options = { appendSystemPrompt: "host text" };
		w.handlers.get("before_agent_start")!({ systemPromptOptions: options }, ctx);

		expect(w.tools.includes("import_skill")).toBe(enabled);
		expect(w.tools.includes("cancel_skill")).toBe(enabled);
		expect(w.commands.length).toBe(creations * 4);
		expect(resources.treeCreations).toBe(creations);
		expect(resources.storeOpens).toBe(creations);
		expect(options.appendSystemPrompt).toBe(`host text\n\n${guidance}`);
	});
	it("registers the ten tools", async () => {
		const { w } = await installed();
		expect(w.tools).toEqual([
			"list_skills",
			"list_skill_tags",
			"list_skill_files",
			"preview_skill",
			"search_skill",
			"import_skill",
			"cancel_skill",
			"create_skill",
			"rename_skill",
			"remove_skill",
		]);
	});

	it("registers the four commands", async () => {
		const { w } = await installed();
		expect(w.commands).toEqual([
			"skill:loaded",
			"skill:import",
			"skill:cancel",
			"skill:clear",
		]);
	});

	it("exposes only ordinary entry points when the skill tree is disabled", async () => {
		const { w } = await installed(false);
		expect(w.tools).toEqual([
			"list_skills",
			"list_skill_tags",
			"list_skill_files",
			"preview_skill",
			"search_skill",
			"create_skill",
			"rename_skill",
			"remove_skill",
		]);
		expect(w.commands).toEqual([]);
	});

	it("assembles and settles the real tree when enabled", async () => {
		const { agentDir, w } = await installed(true, true);
		const ctx = contextFor(agentDir, w);
		await w.handlers.get("session_start")!({ type: "session_start" }, ctx);
		await w.handlers.get("session_tree")!({ type: "session_tree" }, ctx);
		w.tailHandlers.get("tail-prompt:ready")!();

		expect(resources.treeCreations).toBe(1);
		expect(resources.storeOpens).toBe(1);
		expect(resources.copyReads).toBeGreaterThan(0);
		expect(w.branchReads).toBeGreaterThan(0);
		expect(w.segments.length).toBeGreaterThan(0);
		expect(w.statuses.length).toBeGreaterThan(0);
	});

	it("keeps tree resources untouched throughout the disabled lifecycle", async () => {
		const { agentDir, w } = await installed(false, true);
		const ctx = contextFor(agentDir, w);
		await w.handlers.get("session_start")!({ type: "session_start" }, ctx);
		await w.handlers.get("session_tree")!({ type: "session_tree" }, ctx);
		await w.handlers.get("session_shutdown")!({ type: "session_shutdown" }, ctx);

		expect(resources).toEqual({
			treeCreations: 0,
			storeOpens: 0,
			copyReads: 0,
			copyWrites: 0,
			copyDrops: 0,
		});
		expect(w.branchReads).toBe(0);
		expect(w.leafReads).toBe(0);
		expect(w.entries).toEqual([]);
		expect(w.tailHandlers.size).toBe(0);
		expect(w.segments).toEqual([]);
		expect(w.statuses).toEqual([]);
	});

	it("subscribes to the three context events and to before_agent_start", async () => {
		const { w } = await installed();
		expect(w.events).toEqual([
			"session_start",
			"session_tree",
			"session_shutdown",
			"before_agent_start",
		]);
	});

	it("gives every context handler the context, not the event", async () => {
		const { agentDir, w } = await installed();
		const ctx = contextFor(agentDir, w);

		for (const event of ["session_start", "session_tree", "session_shutdown"]) {
			const handler = w.handlers.get(event);
			expect(handler, event).toBeDefined();
			// The host calls (event, ctx); a handler taking the event as the
			// context throws on the first context member it reads.
			await expect(Promise.resolve().then(() => handler!({ type: event }, ctx)), event)
				.resolves.toBeUndefined();
		}
		// Both of these live on the context alone.
		expect(w.branchReads).toBeGreaterThan(0);
		expect(w.statuses.length).toBeGreaterThan(0);
	});

	it("appends the guidance to the prompt section and forces no prompt", async () => {
		const { agentDir, w } = await installed();
		const options = { appendSystemPrompt: "host text" };

		const result = w.handlers.get("before_agent_start")!(
			{
				type: "before_agent_start",
				systemPrompt: "whole",
				systemPromptOptions: options,
			},
			contextFor(agentDir, w),
		);

		expect(options.appendSystemPrompt).toBe(`host text\n\n${GUIDANCE_TEXT}`);
		expect(result).toBeUndefined();
	});

	it.each([
		{ enabled: false, guidance: PREVIEW_GUIDANCE_TEXT, creations: 0 },
		{ enabled: true, guidance: GUIDANCE_TEXT, creations: 1 },
	])("keeps the assembly mode after configuration rereads: $enabled", async ({ enabled, guidance, creations }) => {
		const { agentDir, w } = await installed(enabled, true);
		const ctx = contextFor(agentDir, w);
		const initialTools = [...w.tools];
		const initialCommands = [...w.commands];
		const initialOptions = { appendSystemPrompt: "host text" };
		w.handlers.get("before_agent_start")!({ systemPromptOptions: initialOptions }, ctx);
		expect(initialOptions.appendSystemPrompt).toBe(`host text\n\n${guidance}`);

		writeFileSync(
			path.join(agentDir, "settings.json"),
			JSON.stringify({ skills: { skillTree: { enabled: !enabled } } }),
		);
		await w.handlers.get("session_start")!({ type: "session_start" }, ctx);
		await w.handlers.get("session_tree")!({ type: "session_tree" }, ctx);
		await w.handlers.get("session_shutdown")!({ type: "session_shutdown" }, ctx);
		await w.handlers.get("session_start")!({ type: "session_start" }, ctx);
		const rereadOptions = { appendSystemPrompt: "host text" };
		const result = w.handlers.get("before_agent_start")!({ systemPromptOptions: rereadOptions }, ctx);

		expect(rereadOptions.appendSystemPrompt).toBe(`host text\n\n${guidance}`);
		expect(result).toBeUndefined();
		expect(w.tools).toEqual(initialTools);
		expect(w.commands).toEqual(initialCommands);
		expect(w.tools.includes("import_skill")).toBe(enabled);
		expect(w.tools.includes("cancel_skill")).toBe(enabled);
		expect(resources.treeCreations).toBe(creations);
		expect(resources.storeOpens).toBe(creations);
		expect(w.tailHandlers.has("tail-prompt:ready")).toBe(enabled);
		expect(w.branchReads > 0).toBe(enabled);
		expect(w.statuses.length > 0).toBe(enabled);
	});

	it("clears the status bar when the loaded set is empty", async () => {
		const { agentDir, w } = await installed();
		await w.handlers.get("session_start")!(
			{ type: "session_start" },
			contextFor(agentDir, w),
		);
		expect(w.statuses.at(-1)).toBeUndefined();
	});
});
