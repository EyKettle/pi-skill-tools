/**
 * `plugin.ts`'s wiring, driven by a recording host.
 *
 * The fake host is real about one thing only: how it calls a handler —
 * `(event, ctx)`. That arity is what a plugin can get wrong silently, so every
 * test here hands the handlers an event first and a context second.
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createPlugin, STATUS_KEY } from "../../src/plugin/plugin";
import type { CopyStore, PluginHost } from "../../src/plugin/plugin";
import { GUIDANCE_TEXT } from "../../src/model-channel/guidance";

const tmpDirs: string[] = [];

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
	branchReads: number;
}

function world(): { pi: unknown; world: World } {
	const w: World = {
		tools: [],
		commands: [],
		events: [],
		handlers: new Map(),
		statuses: [],
		notices: [],
		branchReads: 0,
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
		appendEntry() {},
		events: { on() {}, emit() {} },
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
			getLeafId: () => null,
		},
	};
}

function tempAgentDir(): string {
	const dir = mkdtempSync(path.join(tmpdir(), "plugin-"));
	tmpDirs.push(dir);
	mkdirSync(path.join(dir, "skills"), { recursive: true });
	return dir;
}

async function installed() {
	const agentDir = tempAgentDir();
	const { pi, world: w } = world();
	await createPlugin(pi as never, {
		host: hostFor(agentDir),
		sessionState: emptyStore(),
	});
	return { agentDir, w };
}

describe("createPlugin", () => {
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
			expect(() => handler!({ type: event }, ctx), event).not.toThrow();
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

	it("clears the status bar when the loaded set is empty", async () => {
		const { agentDir, w } = await installed();
		w.handlers.get("session_start")!(
			{ type: "session_start" },
			contextFor(agentDir, w),
		);
		expect(w.statuses.at(-1)).toBeUndefined();
	});
});
