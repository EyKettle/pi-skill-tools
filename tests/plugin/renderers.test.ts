/**
 * The two renderer slots, which must never both draw.
 *
 * The host repaints by calling `renderCall` and adding what it returns above
 * whatever `renderResult` returned, and it keeps the call slot after the result
 * arrives. A call slot that still draws then leaves a stale pending row above
 * the settled card, so each slot stays silent in the other's turn.
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createPlugin } from "../../src/plugin/plugin";
import type { CopyStore, PluginHost } from "../../src/plugin/plugin";
import {
	buildImportSkillPayload,
	buildListSkillsPayload,
} from "../../src/tui-channel/payload";
import { GUIDANCE_TEXT } from "../../src/model-channel/guidance";

const tmpDirs: string[] = [];

afterAll(() => {
	for (const dir of tmpDirs) {
		rmSync(dir, { recursive: true, force: true });
	}
});

/** A theme that marks a role by its name, so an assertion reads the role. */
const theme = {
	fg(role: string, text: string) {
		return `[${role}]${text}[/${role}]`;
	},
};

interface Component {
	render(width: number): string[];
	invalidate(): void;
}

interface RenderContext {
	readonly args: Record<string, unknown>;
	readonly expanded: boolean;
	readonly isPartial: boolean;
	/** The host's per-row state: one object across every repaint of a call. */
	readonly state: unknown;
}

interface ToolResult {
	readonly content: readonly { type: string; text: string }[];
	readonly details: unknown;
}

interface Definition {
	readonly name: string;
	renderCall?(
		args: Record<string, unknown>,
		theme: unknown,
		context: RenderContext,
	): Component;
	renderResult?(
		result: ToolResult,
		options: { readonly expanded: boolean; readonly isPartial: boolean },
		theme: unknown,
		context: RenderContext,
	): Component;
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

/** Install the plugin and keep the tool definitions it registered. */
async function definitions(): Promise<Map<string, Definition>> {
	const agentDir = mkdtempSync(path.join(tmpdir(), "renderers-"));
	tmpDirs.push(agentDir);
	mkdirSync(path.join(agentDir, "skills"), { recursive: true });

	const byName = new Map<string, Definition>();
	const pi = {
		on() {},
		registerTool(definition: Definition) {
			byName.set(definition.name, definition);
		},
		registerCommand() {},
		appendEntry() {},
		events: { on() {}, emit() {} },
	};
	await createPlugin(pi as never, {
		host: hostFor(agentDir),
		sessionState: emptyStore(),
	});
	return byName;
}

function contextFor(
	args: Record<string, unknown>,
	isPartial: boolean,
	state: unknown = {},
): RenderContext {
	return { args, expanded: false, isPartial, state };
}

const listedResult: ToolResult = {
	content: [{ type: "text", text: "[git] /skills/git/SKILL.md" }],
	details: buildListSkillsPayload({ count: 1 }),
};

const loadedResult: ToolResult = {
	content: [{ type: "text", text: "Loaded [git]" }],
	details: buildImportSkillPayload({ displayIds: ["git"] }),
};

describe("the renderer slots", () => {
	it("draws nothing in the call slot once the result is settled", async () => {
		const tool = (await definitions()).get("list_skills")!;
		const component = tool.renderCall!(
			{},
			theme,
			contextFor({}, false),
		);
		expect(component.render(120)).toEqual([]);
	});

	it("draws nothing in the result slot while the result is partial", async () => {
		const tool = (await definitions()).get("list_skills")!;
		const component = tool.renderResult!(
			listedResult,
			{ expanded: false, isPartial: true },
			theme,
			contextFor({}, true),
		);
		expect(component.render(120)).toEqual([]);
	});

	it("draws the call slot while the result is still running", async () => {
		const tool = (await definitions()).get("list_skills")!;
		const component = tool.renderCall!(
			{},
			theme,
			contextFor({}, true),
		);
		expect(component.render(120).join("\n")).toContain("List");
	});

	it("draws the result slot once the result is settled", async () => {
		const tool = (await definitions()).get("list_skills")!;
		const component = tool.renderResult!(
			listedResult,
			{ expanded: false, isPartial: false },
			theme,
			contextFor({}, false),
		);
		expect(component.render(120).join("\n")).toContain("Listed 1 skill");
	});

	it("never draws both slots for the same state", async () => {
		const tools = await definitions();
		const cases: readonly {
			tool: string;
			result: ToolResult;
			isPartial: boolean;
		}[] = [
			{ tool: "list_skills", result: listedResult, isPartial: true },
			{ tool: "list_skills", result: listedResult, isPartial: false },
			{ tool: "import_skill", result: loadedResult, isPartial: true },
			{ tool: "import_skill", result: loadedResult, isPartial: false },
		];

		for (const each of cases) {
			const tool = tools.get(each.tool)!;
			const callLines = tool
				.renderCall!({}, theme, contextFor({}, each.isPartial))
				.render(120);
			const resultLines = tool
				.renderResult!(
					each.result,
					{ expanded: false, isPartial: each.isPartial },
					theme,
					contextFor({}, each.isPartial),
				)
				.render(120);
			const drawn = [callLines.length > 0, resultLines.length > 0];
			expect(
				drawn.filter(Boolean).length,
				`${each.tool} partial=${each.isPartial}`,
			).toBeLessThanOrEqual(1);
		}
	});

	it("shows the settled title rather than the pending one", async () => {
		const tool = (await definitions()).get("list_skills")!;
		const component = tool.renderResult!(
			listedResult,
			{ expanded: false, isPartial: false },
			theme,
			contextFor({}, false),
		);
		const lines = component.render(120);
		// The pending call slot ends its title row with an ellipsis.
		expect(lines[0]).not.toContain("…");
		expect(lines[0]).toContain("List");
	});
});

describe("the guidance", () => {
	it("is appended to the prompt section", async () => {
		const agentDir = mkdtempSync(path.join(tmpdir(), "renderers-"));
		tmpDirs.push(agentDir);
		mkdirSync(path.join(agentDir, "skills"), { recursive: true });

		const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
		const pi = {
			on(event: string, handler: (event: unknown, ctx: unknown) => unknown) {
				handlers.set(event, handler);
			},
			registerTool() {},
			registerCommand() {},
			appendEntry() {},
			events: { on() {}, emit() {} },
		};
		await createPlugin(pi as never, {
			host: hostFor(agentDir),
			sessionState: emptyStore(),
		});

		const options = { appendSystemPrompt: "host text" };
		handlers.get("before_agent_start")!(
			{ type: "before_agent_start", systemPrompt: "whole", systemPromptOptions: options },
			{ cwd: agentDir, hasUI: false, ui: { setStatus() {}, notify() {} } },
		);
		expect(options.appendSystemPrompt).toBe(`host text\n\n${GUIDANCE_TEXT}`);
	});
});

describe("create_skill while it streams", () => {
	/** A theme that keeps the text, so an assertion reads the row as a user does. */
	const plain = { fg: (_role: string, text: string) => text };

	function pendingCall(
		tool: Definition,
		args: Record<string, unknown>,
		state: unknown,
	): string {
		return tool
			.renderCall!(args, plain, contextFor(args, true, state))
			.render(120)
			.join("\n");
	}

	it("follows the content as it grows", async () => {
		const tool = (await definitions()).get("create_skill")!;
		const state = {};

		expect(pendingCall(tool, { id: "alpha", content: "line one" }, state)).toBe(
			"Create alpha (1 line · 8 B)",
		);
		expect(
			pendingCall(tool, { id: "alpha", content: "line one\nline two" }, state),
		).toBe("Create alpha (2 lines · 17 B)");
	});

	it("keeps the largest amount seen when a frame loses the content", async () => {
		const tool = (await definitions()).get("create_skill")!;
		const state = {};
		const whole = "line one\nline two\nthree";

		expect(pendingCall(tool, { id: "alpha", content: whole }, state)).toBe(
			"Create alpha (3 lines · 23 B)",
		);
		// A frame that loses the field entirely reports the largest amount
		// already seen instead of falling back to the pending ellipsis.
		expect(pendingCall(tool, { id: "alpha" }, state)).toBe(
			"Create alpha (3 lines · 23 B)",
		);
		expect(pendingCall(tool, { id: "alpha", content: "line one\n" }, state)).toBe(
			"Create alpha (3 lines · 23 B)",
		);
	});

	it("treats an empty content as a measured zero", async () => {
		const tool = (await definitions()).get("create_skill")!;
		const state = {};

		expect(pendingCall(tool, { id: "alpha", content: "" }, state)).toBe(
			"Create alpha (0 lines · 0 B)",
		);
		// An empty content is still a content: the zero it measured stays.
		expect(pendingCall(tool, { id: "alpha" }, state)).toBe(
			"Create alpha (0 lines · 0 B)",
		);
	});

	it("shows no amount until the content has arrived", async () => {
		const tool = (await definitions()).get("create_skill")!;
		const row = pendingCall(tool, { id: "alpha" }, {});
		expect(row).toBe("Create alpha …");
		expect(row).not.toContain("0 lines");
	});

	it("does not leave a double space when the id is empty", async () => {
		const tool = (await definitions()).get("create_skill")!;
		expect(pendingCall(tool, { content: "x" }, {})).toBe("Create (1 line · 1 B)");
	});

	it("draws nothing in the call slot once the write is settled", async () => {
		const tool = (await definitions()).get("create_skill")!;
		const component = tool.renderCall!(
			{ id: "alpha", content: "x" },
			plain,
			contextFor({ id: "alpha" }, false, {}),
		);
		expect(component.render(120)).toEqual([]);
	});
});
