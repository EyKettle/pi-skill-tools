/**
 * Task 10 — create_skill row with live progress. Composed-row evidence
 * through real pi-tui Text/Container and the real dark theme (harness
 * recipe). A stub renderer or fake theme voids the evidence.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Text, Container } from "../deps/pi-tui";
import { testTheme } from "../deps/pi-theme";
import { createFailure } from "../failure";
import { defineCreateSkill } from "../tools/create-skill";
import type { FailureSource, ToolDeps } from "../tools/shared";
import { clearThrownFailures, failError } from "../tools/shared";
import {
	buildCreateSkillPayload,
	buildFailurePayload,
	countTextLines,
} from "../transport";
import type { Registry, RegistryEntry } from "../registry";
import type { SkillStorage } from "../skill-id";

const theme = testTheme("dark");

const SGR = /\x1b\[[0-9;]*m/g;

function keyHint(binding: string, fallback: string): string {
	if (binding !== "app.tools.expand") {
		throw new Error(`unexpected keybinding '${binding}'`);
	}
	return `Ctrl+O ${fallback}`;
}

class DummyBox {
	addChild(_component: unknown): void {}
	clear(): void {}
	render(): string[] {
		return [];
	}
	invalidate() {}
}

const dummyType: ToolDeps["Type"] = {
	Union: (schemas) => schemas,
	Literal: (value) => value,
	Object: (properties) => properties,
	Optional: (schema) => schema,
	Boolean: (desc) => desc ?? {},
	String: (desc) => desc ?? {},
	Record: (_key, value, desc) => desc ?? value,
	Unknown: (desc) => desc ?? {},
};

function makeRegistry(overrides: Partial<Registry> = {}): Registry {
	const entries = overrides.entries ?? [];
	return {
		entries,
		conflicts: overrides.conflicts ?? [],
		indexEmpty: overrides.indexEmpty ?? false,
		filter(location?: SkillStorage) {
			return location === undefined
				? entries
				: entries.filter((entry) => entry.storage === location);
		},
	};
}

function makeEntry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
	return {
		storage: "global",
		name: "other",
		id: "global:other",
		state: "active",
		frontmatter: {},
		filePath: "/tmp/other/SKILL.md",
		baseDir: "/tmp/other",
		description: "other skill",
		...overrides,
	};
}

function makeTool(
	overrides: Partial<ToolDeps> = {},
	config: { agentDir: string; configDirName: string } = {
		agentDir: "/tmp/agent",
		configDirName: ".pi",
	},
): CreateSkillTool {
	return defineCreateSkill(
		{
			Type: dummyType,
			Text,
			Container,
			Box: DummyBox,
			expandKeyHint: keyHint,
			registryDeps: () => makeRegistry({ entries: [makeEntry()] }),
			withFileMutationQueue: async (_path, fn) => fn(),
			...overrides,
		},
		config,
	) as unknown as CreateSkillTool;
}

interface RenderCtx {
	args: Record<string, unknown>;
	toolCallId: string;
	invalidate: () => void;
	lastComponent: unknown;
	state: Record<string, unknown>;
	cwd: string;
	executionStarted: boolean;
	argsComplete: boolean;
	isPartial: boolean;
	expanded: boolean;
	showImages: boolean;
	isError: boolean;
}

interface CreateSkillTool {
	renderCall: (
		args: unknown,
		theme: unknown,
		context: RenderCtx,
	) => unknown;
	renderResult: (
		result: {
			content: ReadonlyArray<{ type: string; text?: string }>;
			details?: Record<string, unknown>;
		},
		options: { expanded: boolean; isPartial?: boolean },
		theme: unknown,
		context: RenderCtx,
	) => unknown;
	execute: (
		toolCallId: string,
		params: { id: string; content: string },
		signal: unknown,
		onUpdate: unknown,
		ctx: { cwd: string; isProjectTrusted(): boolean },
	) => Promise<{ content: Array<{ type: string; text?: string }> }>;
}

function makeCtx(overrides: Partial<RenderCtx> = {}): RenderCtx {
	return {
		args: {},
		toolCallId: "call-1",
		invalidate: () => {},
		lastComponent: undefined,
		state: {},
		cwd: "/tmp",
		executionStarted: false,
		argsComplete: false,
		isPartial: false,
		expanded: false,
		showImages: false,
		isError: false,
		...overrides,
	};
}

beforeEach(() => {
	clearThrownFailures();
});

function compose(call: unknown, result?: unknown, width = 80): string[] {
	const row = new Container();
	row.addChild(call as never);
	if (result !== undefined) {
		row.addChild(result as never);
	}
	return row.render(width);
}

function visible(lines: string[]): string[] {
	return lines.map((line) => line.replace(SGR, "").trimEnd());
}

function countVisible(lines: string[], snippet: string): number {
	return visible(lines).join("\n").split(snippet).length - 1;
}

const tmpDirs: string[] = [];

function makeTempDir(prefix = "create-skill-row-"): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tmpDirs.push(dir);
	return dir;
}

afterAll(() => {
	for (const dir of tmpDirs) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("create_skill pending row (Channel A)", () => {
	it("shows accumulating line and byte counts on the call line, with no result slot or expand hint", () => {
		const tool = makeTool();
		const ctx = makeCtx();
		const args = { id: "notes", content: "abcd" };
		const call = tool.renderCall!(args, theme, ctx);
		const lines = compose(call);
		expect(visible(lines)).toEqual(["[NewSkill] notes (1 line · 4 B)"]);
		expect(lines[0]).toContain(theme.fg("success", "[NewSkill] "));
		expect(lines[0]).not.toContain(theme.fg("muted", " (1 line · 4 B)"));
		expect(visible(lines).join("\n")).not.toContain("to expand");
		expect(countVisible(lines, "[NewSkill]")).toBe(1);
	});

	it("advances the readout as streamed content grows, reusing renderer state", () => {
		const tool = makeTool();
		const ctx = makeCtx();
		const first = tool.renderCall!(
			{ id: "notes", content: "abcd" },
			theme,
			ctx,
		);
		expect(visible(compose(first))).toEqual(["[NewSkill] notes (1 line · 4 B)"]);
		ctx.lastComponent = first;
		const second = tool.renderCall!(
			{ id: "notes", content: "abcd\nefgh\n" },
			theme,
			ctx,
		);
		expect(visible(compose(second))).toEqual(["[NewSkill] notes (2 lines · 10 B)"]);
		expect(visible(compose(second)).join("\n")).not.toContain("to expand");
	});
});

describe("create_skill settled rows", () => {
	const content = "hello\n";
	const payload = buildCreateSkillPayload(
		"notes",
		"/skills/notes/SKILL.md",
		content,
	);

	it("collapsed retains the size readout on the result line and identity once", () => {
		const tool = makeTool();
		const args = { id: "notes", content };
		const ctx = makeCtx({
			args,
			executionStarted: true,
			argsComplete: true,
		});
		const call = tool.renderCall!(args, theme, ctx);
		const result = tool.renderResult!(
			{
				content: [{ type: "text", text: "created skill 'notes'" }],
				details: { payload },
			},
			{ expanded: false, isPartial: false },
			theme,
			{ ...ctx, expanded: false, isError: false },
		);
		const lines = compose(call, result);
		expect(visible(lines)).toEqual([
			"[NewSkill] notes",
			"Wrote 1 line (6B) · Ctrl+O to expand",
		]);
		expect(countVisible(lines, "[NewSkill]")).toBe(1);
		expect(countVisible(lines, "notes")).toBe(1);
	});

	it("expanded shows the path, full content, and the size readout with no expand hint", () => {
		const tool = makeTool();
		const args = { id: "notes", content };
		const ctx = makeCtx({
			args,
			executionStarted: true,
			argsComplete: true,
			expanded: true,
		});
		const call = tool.renderCall!(args, theme, ctx);
		const result = tool.renderResult!(
			{
				content: [{ type: "text", text: "created skill 'notes'" }],
				details: { payload },
			},
			{ expanded: true, isPartial: false },
			theme,
			{ ...ctx, expanded: true, isError: false },
		);
		const lines = compose(call, result);
		expect(visible(lines)).toEqual([
			"[NewSkill] notes (/skills/notes/SKILL.md)",
			"",
			"hello",
			"",
			"1 line (6B) in total",
		]);
		expect(visible(lines).join("\n")).not.toContain("to expand");
		expect(countVisible(lines, "[NewSkill]")).toBe(1);
	});

	it("isPartial keeps the pending call line and does not paint a result slot", () => {
		const tool = makeTool();
		const args = { id: "notes", content: "abcd" };
		const ctx = makeCtx({
			args,
			executionStarted: true,
			isPartial: true,
		});
		const call = tool.renderCall!(args, theme, ctx);
		const result = tool.renderResult!(
			{ content: [{ type: "text", text: "" }], details: {} },
			{ expanded: false, isPartial: true },
			theme,
			{ ...ctx, isPartial: true, isError: false },
		);
		expect(visible(compose(call, result))).toEqual([
			"[NewSkill] notes (1 line · 4 B)",
		]);
	});

	it("does not keep the pending readout after settlement when arguments grow", () => {
		const tool = makeTool();
		const args = { id: "notes", content };
		const ctx = makeCtx({
			args,
			executionStarted: true,
			argsComplete: true,
		});
		ctx.lastComponent = tool.renderCall(args, theme, ctx);
		const result = tool.renderResult!(
			{
				content: [{ type: "text", text: "created skill 'notes'" }],
				details: { payload },
			},
			{ expanded: false, isPartial: false },
			theme,
			{ ...ctx, isError: false },
		);
		const grown = { id: "notes", content: `${content}extra\n` };
		ctx.args = grown;
		const laterCall = tool.renderCall!(grown, theme, ctx);
		const lines = compose(laterCall, result);
		expect(visible(lines)).toEqual([
			"[NewSkill] notes",
			"Wrote 1 line (6B) · Ctrl+O to expand",
		]);
		expect(visible(lines).join("\n")).not.toContain("extra");
		expect(visible(lines).join("\n")).not.toMatch(/2 lines/);
	});

	it("empty written content paints a success row, not unavailable wording", () => {
		const empty = "";
		const emptyPayload = buildCreateSkillPayload(
			"notes",
			"/skills/notes/SKILL.md",
			empty,
		);
		const tool = makeTool();
		const args = { id: "notes", content: empty };
		const ctx = makeCtx({
			args,
			executionStarted: true,
			argsComplete: true,
		});
		const call = tool.renderCall!(args, theme, ctx);
		const result = tool.renderResult!(
			{
				content: [{ type: "text", text: "created skill 'notes'" }],
				details: { payload: emptyPayload },
			},
			{ expanded: false, isPartial: false },
			theme,
			{ ...ctx, isError: false },
		);
		const lines = compose(call, result);
		expect(visible(lines)).toEqual([
			"[NewSkill] notes",
			"Wrote 0 lines (0B) · Ctrl+O to expand",
		]);
		expect(visible(lines).join("\n")).not.toContain(
			"Result details unavailable",
		);
	});

	it("empty expanded reports (empty file) then the totals line", () => {
		const empty = "";
		const emptyPayload = buildCreateSkillPayload(
			"notes",
			"/skills/notes/SKILL.md",
			empty,
		);
		const tool = makeTool();
		const args = { id: "notes", content: empty };
		const ctx = makeCtx({
			args,
			executionStarted: true,
			argsComplete: true,
			expanded: true,
		});
		const call = tool.renderCall!(args, theme, ctx);
		const result = tool.renderResult!(
			{
				content: [{ type: "text", text: "created skill 'notes'" }],
				details: { payload: emptyPayload },
			},
			{ expanded: true, isPartial: false },
			theme,
			{ ...ctx, expanded: true, isError: false },
		);
		expect(visible(compose(call, result))).toEqual([
			"[NewSkill] notes (/skills/notes/SKILL.md)",
			"",
			"(empty file)",
			"",
			"0 lines (0B) in total",
		]);
	});

	it("expanded content wraps at a narrow width instead of truncating", () => {
		const longLine = "X".repeat(80);
		const longPayload = buildCreateSkillPayload(
			"notes",
			"/skills/notes/SKILL.md",
			`${longLine}\n`,
		);
		const tool = makeTool();
		const args = { id: "notes", content: `${longLine}\n` };
		const ctx = makeCtx({
			args,
			executionStarted: true,
			argsComplete: true,
			expanded: true,
		});
		const call = tool.renderCall!(args, theme, ctx);
		const result = tool.renderResult!(
			{
				content: [{ type: "text", text: "created skill 'notes'" }],
				details: { payload: longPayload },
			},
			{ expanded: true, isPartial: false },
			theme,
			{ ...ctx, expanded: true, isError: false },
		);
		const raw = compose(call, result, 40);
		const text = visible(raw).join("");
		expect((text.match(/X/g) ?? []).length).toBe(longLine.length);
		for (const row of raw) {
			expect(row.replace(SGR, "").replace(/\s+$/u, "").length).toBeLessThanOrEqual(
				40,
			);
		}
	});

	it("a throwing Text degrades through presentRow instead of escaping", () => {
		class ThrowingText {
			constructor(_content: string, _paddingX?: number, _paddingY?: number) {
				throw new Error("permanent component failure");
			}
			setText(_text: string): void {}
			render(_width: number): string[] {
				throw new Error("unreachable");
			}
			invalidate() {}
		}
		const tool = makeTool({
			Text: ThrowingText,
		});
		const args = { id: "notes", content };
		const ctx = makeCtx({
			args,
			executionStarted: true,
			argsComplete: true,
		});
		const call = tool.renderCall!(args, theme, ctx);
		const result = tool.renderResult!(
			{
				content: [{ type: "text", text: "created skill 'notes'" }],
				details: { payload },
			},
			{ expanded: false, isPartial: false },
			theme,
			{ ...ctx, isError: false },
		);
		const lines = compose(call, result);
		expect(visible(lines)).toEqual([
			"create_skill · Result details unavailable",
		]);
	});
});

describe("create_skill progress channel", () => {
	it("does not emit onUpdate after the execute promise settles", async () => {
		const agentDir = makeTempDir();
		mkdirSync(join(agentDir, "skills"), { recursive: true });
		const tool = makeTool(
			{
				registryDeps: () => makeRegistry({ entries: [makeEntry()] }),
				withFileMutationQueue: async (_path, fn) => fn(),
			},
			{ agentDir, configDirName: ".pi" },
		);
		const timestamps: number[] = [];
		const onUpdate = () => {
			timestamps.push(Date.now());
		};
		const content = "---\nname: notes\ndescription: d\n---\n# Notes\n";
		const settled = await tool.execute!(
			"call-progress",
			{ id: "notes", content },
			undefined,
			onUpdate,
			{ cwd: "/tmp", isProjectTrusted: () => true },
		);
		const after = timestamps.length;
		expect(settled.content[0]?.text).toContain("created skill");
		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(timestamps.length).toBe(after);
	});
});

describe("create_skill per-update cost", () => {
	it("keeps per-update work bounded for a large streamed payload", () => {
		const tool = makeTool();
		const ctx = makeCtx();
		const chunk = `${"x".repeat(4096)}\n`;
		let content = "";
		for (let i = 0; i < 80; i++) {
			content += chunk;
			tool.renderCall!({ id: "notes", content }, theme, ctx);
		}
		const call = tool.renderCall!({ id: "notes", content }, theme, ctx);
		const lines = visible(compose(call));
		expect(lines).toEqual([
			`[NewSkill] notes (${countTextLines(content)} lines · ${Buffer.byteLength(content, "utf8")} B)`,
		]);
		const progress = ctx.state.progress as { visited: number } | undefined;
		const bytes = Buffer.byteLength(content, "utf8");
		const chunkBytes = Buffer.byteLength(chunk, "utf8");
		const triangular = ((80 * 81) / 2) * chunkBytes;
		// Suffix-scan visits each appended byte once. A full rescan every
		// update would visit the triangular number, which this rejects.
		expect(progress?.visited).toBe(bytes);
		expect(progress?.visited).toBeLessThan(triangular);
	});
});

describe("create_skill failure and missing payload", () => {
	it("missing payload uses the design's fixed unavailable wording", () => {
		const tool = makeTool();
		const ctx = makeCtx({ executionStarted: true, argsComplete: true });
		const call = tool.renderCall!({ id: "notes", content: "x" }, theme, ctx);
		const result = tool.renderResult!(
			{ content: [{ type: "text", text: "created skill 'notes'" }], details: {} },
			{ expanded: false, isPartial: false },
			theme,
			{ ...ctx, isError: false },
		);
		const lines = compose(call, result);
		expect(visible(lines)).toEqual([
			"create_skill · Result details unavailable",
		]);
		expect(visible(lines).join("\n")).not.toMatch(/error:/);
		expect(visible(lines).join("\n")).not.toMatch(/suggestions:/);
	});

	it("name-exists projects the guarded name, not model prose", () => {
		const tool = makeTool();
		const ctx = makeCtx({
			args: { id: "notes" },
			executionStarted: true,
			isError: true,
		});
		const payload = buildFailurePayload(
			"create_skill",
			createFailure("CREATE_NAME_EXISTS"),
		);
		const call = tool.renderCall!({ id: "notes" }, theme, ctx);
		const result = tool.renderResult!(
			{
				content: [
					{
						type: "text",
						text: "error: skill 'notes' already exists\nsuggestions: pick a different name",
					},
				],
				details: { payload },
			},
			{ expanded: false, isPartial: false },
			theme,
			{ ...ctx, isError: true },
		);
		const lines = compose(call, result);
		expect(visible(lines)).toEqual(["create_skill · notes already exists"]);
		expect(lines.join("\n")).toContain(theme.fg("accent", "notes"));
		expect(visible(lines).join("\n")).not.toMatch(/error:/);
		expect(visible(lines).join("\n")).not.toMatch(/suggestions:/);
	});

	it("unknown error with empty details paints Tool execution failed", () => {
		const tool = makeTool();
		const ctx = makeCtx({
			executionStarted: true,
			argsComplete: true,
			isError: true,
		});
		const call = tool.renderCall!({ id: "notes", content: "x" }, theme, ctx);
		const result = tool.renderResult!(
			{
				content: [
					{ type: "text", text: "error: boom\nsuggestions: try again" },
				],
				details: {},
			},
			{ expanded: false, isPartial: false },
			theme,
			{ ...ctx, isError: true },
		);
		const lines = compose(call, result);
		expect(visible(lines)).toEqual([
			"create_skill · Tool execution failed",
		]);
		expect(visible(lines).join("\n")).not.toMatch(/error:/);
		expect(visible(lines).join("\n")).not.toMatch(/suggestions:/);
	});

	it("keeps a thrown known-failure line after a second render with wiped details", async () => {
		const tool = makeTool({
			registryDeps: () =>
				makeRegistry({
					entries: [
						makeEntry({
							name: "notes",
							id: "global:notes",
							filePath: "/tmp/notes/SKILL.md",
							baseDir: "/tmp/notes",
						}),
					],
				}),
		});
		const ctx = makeCtx({
			args: { id: "notes" },
			toolCallId: "call-throw",
			executionStarted: true,
			isError: true,
		});
		await expect(
			tool.execute!(
				"call-throw",
				{ id: "notes", content: "x" },
				undefined,
				undefined,
				{ cwd: "/tmp", isProjectTrusted: () => true },
			),
		).rejects.toThrow();
		const wiped = {
			content: [
				{
					type: "text" as const,
					text: "error: skill 'notes' already exists\nsuggestions: pick a different name",
				},
			],
			details: {},
		};
		const call = tool.renderCall!({ id: "notes" }, theme, ctx);
		const first = tool.renderResult!(
			wiped,
			{ expanded: false, isPartial: false },
			theme,
			ctx,
		);
		expect(visible(compose(call, first))).toEqual([
			"create_skill · notes already exists",
		]);
		const second = tool.renderResult!(
			wiped,
			{ expanded: false, isPartial: false },
			theme,
			ctx,
		);
		expect(visible(compose(call, second))).toEqual([
			"create_skill · notes already exists",
		]);
		expect(visible(compose(call, second)).join("\n")).not.toContain(
			"Result details unavailable",
		);
	});

	it("recovers a failError stash with wiped details even when row state is empty", () => {
		const source: FailureSource = {
			error: "skill 'notes' already exists",
			code: "CREATE_NAME_EXISTS",
			evidence: { kind: "none" },
		};
		expect(() => failError("call-seam", "create_skill", source)).toThrow(
			/error:/,
		);
		const tool = makeTool();
		const wiped = {
			content: [
				{
					type: "text" as const,
					text: "error: skill 'notes' already exists\nsuggestions: pick a different name",
				},
			],
			details: {},
		};
		const paint = () => {
			const ctx = makeCtx({
				args: { id: "notes" },
				toolCallId: "call-seam",
				executionStarted: true,
				isError: true,
				state: {},
			});
			const call = tool.renderCall!({ id: "notes" }, theme, ctx);
			const result = tool.renderResult!(
				wiped,
				{ expanded: false, isPartial: false },
				theme,
				ctx,
			);
			return visible(compose(call, result));
		};
		expect(paint()).toEqual(["create_skill · notes already exists"]);
		expect(paint()).toEqual(["create_skill · notes already exists"]);
		expect(paint().join("\n")).not.toContain("Tool execution failed");
	});
});
