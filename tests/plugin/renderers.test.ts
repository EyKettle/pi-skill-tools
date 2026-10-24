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
		loadSkills: () => ({ skills: [] }),
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
): RenderContext {
	return { args, expanded: false, isPartial };
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
