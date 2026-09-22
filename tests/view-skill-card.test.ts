/**
 * Task 11 — one view_skill card across every phase, asserted on composed
 * rows through the real pi-tui Text/Box/Container and the real dark theme
 * (pi-tui-rendering-harness.md). A stub renderer or fake theme voids it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { Box, Container, Text } from "../deps/pi-tui";
import { testTheme } from "../deps/pi-theme";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFailure } from "../failure";
import { clear } from "../correlation";
import { defineViewSkill } from "../tools/view-skill";
import type { FailureSource, ToolDeps, ViewSkillDetails } from "../tools/shared";
import { clearThrownFailures, failError } from "../tools/shared";
import { rebuildPresentation, retainPresentation } from "../presentation";
import { buildFailurePayload, buildViewSkillPayload } from "../transport";
import type { Registry } from "../registry";

const theme = testTheme("dark");

const SGR = /\x1b\[[0-9;]*m/g;

function keyHint(binding: string, fallback: string): string {
	if (binding !== "app.tools.expand") {
		throw new Error(`unexpected keybinding '${binding}'`);
	}
	return `Ctrl+O ${fallback}`;
}

const typeStub: ToolDeps["Type"] = {
	Union: (schemas) => schemas,
	Literal: (value) => value,
	Object: (properties) => properties,
	Optional: (schema) => schema,
	Boolean: (desc) => desc ?? {},
	String: (desc) => desc ?? {},
	Record: (_key, value, desc) => desc ?? value,
	Unknown: (desc) => desc ?? {},
};

function emptyRegistry(): Registry {
	return {
		entries: [],
		conflicts: [],
		indexEmpty: true,
		filter: () => [],
	};
}

function defineTool(registry: Registry = emptyRegistry()) {
	return defineViewSkill(
		{
			registryDeps: () => registry,
			Type: typeStub,
			Text,
			Box,
			Container,
			expandKeyHint: keyHint,
		},
		{ agentDir: "/tmp/agent", configDirName: ".pi" },
	);
}

interface RenderCtx {
	args: { id?: string; frontmatterOnly?: boolean };
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

function renderContext(overrides: Partial<RenderCtx> = {}): RenderCtx {
	return {
		args: { id: "git" },
		toolCallId: "call-1",
		invalidate: () => {},
		lastComponent: undefined,
		state: {},
		cwd: "/tmp",
		executionStarted: false,
		argsComplete: false,
		isPartial: true,
		expanded: false,
		showImages: true,
		isError: false,
		...overrides,
	};
}

function compose(call: unknown, result?: unknown): string[] {
	const row = new Container();
	row.addChild(call as never);
	if (result !== undefined) {
		row.addChild(result as never);
	}
	return row.render(80);
}

function visible(lines: string[]): string[] {
	return lines.map((line) => line.replace(SGR, "").trimEnd());
}

function cardBody(lines: string[]): string[] {
	const trimmed = visible(lines).map((line) => line.trim());
	if (trimmed.length < 2) {
		return trimmed;
	}
	return trimmed.slice(1, -1);
}

function countIdentity(lines: string[]): number {
	return cardBody(lines).filter(
		(line) =>
			line.startsWith("[Skill]") ||
			line === "view_skill" ||
			line.startsWith("view_skill "),
	).length;
}

function hasBg(
	lines: string[],
	role: "customMessageBg" | "toolErrorBg" | "toolPendingBg" | "toolSuccessBg",
): boolean {
	const sample = theme.bg(role, " ");
	const open = sample.slice(0, sample.indexOf(" ") + 1);
	return lines.some((line) => line.includes(open));
}

const gitPayload = buildViewSkillPayload(
	"git",
	"/skills/git/SKILL.md",
	"# Git\n",
);

const gitDetails: ViewSkillDetails = {
	name: "git",
	storage: "global",
	path: "/skills/git/SKILL.md",
	bytes: 6,
	lines: 1,
	content: `<SKILL name="git" location="/skills/git/SKILL.md">\n# Git\n\n</SKILL>`,
	payload: gitPayload,
	format: "full",
};

afterEach(() => {
	clear();
	clearThrownFailures();
});

describe("view_skill card — pending", () => {
	it("pending with an id is the title only on the default pending shell", () => {
		const tool = defineTool();
		const ctx = renderContext({ isPartial: true });
		const lines = compose(tool.renderCall!({ id: "git" }, theme, ctx));
		expect(cardBody(lines)).toEqual(["[Skill] git ..."]);
		expect(countIdentity(lines)).toBe(1);
		expect(lines.join("\n")).not.toContain("to expand");
		expect(hasBg(lines, "toolPendingBg")).toBe(true);
		expect(hasBg(lines, "customMessageBg")).toBe(false);
	});

	it("pending with no id shows the tool name only", () => {
		const tool = defineTool();
		const ctx = renderContext({ args: {}, isPartial: true });
		const lines = compose(tool.renderCall!({}, theme, ctx));
		expect(cardBody(lines)).toEqual(["view_skill ..."]);
		expect(countIdentity(lines)).toBe(1);
	});
});

describe("view_skill card — document mode", () => {
	it("collapsed shows the ref identity on the default success shell", () => {
		const tool = defineTool();
		const payload = buildViewSkillPayload(
			"git",
			"/skills/git/references/GUIDE.md",
			"# Guide\n",
		);
		const details: ViewSkillDetails = {
			name: "git",
			storage: "global",
			path: "/skills/git/references/GUIDE.md",
			bytes: 8,
			lines: 1,
			content: `<SKILL name="git" location="/skills/git/references/GUIDE.md">\n# Guide\n\n</SKILL>`,
			payload,
			format: "full",
		};
		const state: Record<string, unknown> = {};
		const args = { id: "global:git/references/GUIDE.md" };
		const lines = compose(
			tool.renderCall!(
				args,
				theme,
				renderContext({ args, isPartial: false, state }),
			),
			tool.renderResult!(
				{ content: [{ type: "text", text: details.content }], details },
				{ expanded: false, isPartial: false },
				theme,
				renderContext({ args, isPartial: false, expanded: false, state }),
			),
		);
		expect(cardBody(lines)).toEqual([
			"[Skill] git/references/GUIDE.md · Ctrl+O to expand",
		]);
		expect(hasBg(lines, "toolSuccessBg")).toBe(true);
		expect(hasBg(lines, "customMessageBg")).toBe(false);
	});

	it("expanded puts the path on its own line and keeps the default success shell", () => {
		const tool = defineTool();
		const payload = buildViewSkillPayload(
			"git",
			"/skills/git/references/GUIDE.md",
			"# Guide\n",
		);
		const details: ViewSkillDetails = {
			name: "git",
			storage: "global",
			path: "/skills/git/references/GUIDE.md",
			bytes: 8,
			lines: 1,
			content: `<SKILL name="git" location="/skills/git/references/GUIDE.md">\n# Guide\n\n</SKILL>`,
			payload,
			format: "full",
		};
		const state: Record<string, unknown> = {};
		const args = { id: "global:git/references/GUIDE.md" };
		const lines = compose(
			tool.renderCall!(
				args,
				theme,
				renderContext({ args, isPartial: false, state }),
			),
			tool.renderResult!(
				{ content: [{ type: "text", text: details.content }], details },
				{ expanded: true, isPartial: false },
				theme,
				renderContext({ args, isPartial: false, expanded: true, state }),
			),
		);
		expect(cardBody(lines)).toEqual([
			"[Skill] git/references/GUIDE.md",
			"(/skills/git/references/GUIDE.md)",
			"",
			"# Guide",
		]);
		expect(hasBg(lines, "toolSuccessBg")).toBe(true);
	});
});

describe("view_skill card — undeterminable mode", () => {
	it.each([123, true, null, {}])(
		"a non-string id (%s) does not throw and uses the default success shell",
		(nonStringId) => {
			const tool = defineTool();
			const args = { id: nonStringId } as unknown as { id?: string };
			const state: Record<string, unknown> = {};
			const lines = compose(
				tool.renderCall!(
					args,
					theme,
					renderContext({ args, isPartial: false, state }),
				),
				tool.renderResult!(
					{ content: [], details: {} },
					{ expanded: false, isPartial: false },
					theme,
					renderContext({ args, isPartial: false, state }),
				),
			);
			expect(hasBg(lines, "toolSuccessBg")).toBe(true);
			expect(hasBg(lines, "customMessageBg")).toBe(false);
		},
	);

	it.each([123, null])(
		"a non-string id (%s) on a thrown failure does not throw and uses the error shell",
		(nonStringId) => {
			const tool = defineTool();
			const args = { id: nonStringId } as unknown as { id?: string };
			const state: Record<string, unknown> = {};
			const lines = compose(
				tool.renderCall!(
					args,
					theme,
					renderContext({ args, isPartial: false, state }),
				),
				tool.renderResult!(
					{ content: [], details: {} },
					{ expanded: false, isPartial: false },
					theme,
					renderContext({ args, isPartial: false, isError: true, state }),
				),
			);
			expect(hasBg(lines, "toolErrorBg")).toBe(true);
		},
	);
	it("malformed success with no call id uses the default success shell", () => {
		const tool = defineTool();
		const state: Record<string, unknown> = {};
		const lines = compose(
			tool.renderCall!(
				{},
				theme,
				renderContext({ args: {}, isPartial: false, state }),
			),
			tool.renderResult!(
				{ content: [], details: {} },
				{ expanded: false, isPartial: false },
				theme,
				renderContext({ args: {}, isPartial: false, state }),
			),
		);
		expect(hasBg(lines, "toolSuccessBg")).toBe(true);
		expect(hasBg(lines, "customMessageBg")).toBe(false);
	});
});

describe("view_skill card — settled success", () => {
	it("collapsed shows the expand hint on the call line and no file body", () => {
		const tool = defineTool();
		const state: Record<string, unknown> = {};
		const callCtx = renderContext({ isPartial: false, state });
		const resultCtx = renderContext({
			isPartial: false,
			expanded: false,
			state,
		});
		const lines = compose(
			tool.renderCall!({ id: "git" }, theme, callCtx),
			tool.renderResult!(
				{
					content: [{ type: "text", text: gitDetails.content }],
					details: gitDetails,
				},
				{ expanded: false, isPartial: false },
				theme,
				resultCtx,
			),
		);
		expect(cardBody(lines)).toEqual(["[Skill] git · Ctrl+O to expand"]);
		expect(countIdentity(lines)).toBe(1);
		expect(visible(lines).join("\n")).not.toContain("# Git");
		expect(visible(lines).join("\n")).not.toContain("<SKILL");
		expect(hasBg(lines, "customMessageBg")).toBe(true);
	});

	it("expanded shows the path and payload content, not the model wrapper", () => {
		const tool = defineTool();
		const state: Record<string, unknown> = {};
		const lines = compose(
			tool.renderCall!(
				{ id: "git" },
				theme,
				renderContext({ isPartial: false, state }),
			),
			tool.renderResult!(
				{
					content: [{ type: "text", text: gitDetails.content }],
					details: gitDetails,
				},
				{ expanded: true, isPartial: false },
				theme,
				renderContext({ isPartial: false, expanded: true, state }),
			),
		);
		expect(cardBody(lines)).toEqual([
			"[Skill] git (/skills/git/SKILL.md)",
			"",
			"# Git",
		]);
		expect(countIdentity(lines)).toBe(1);
		expect(visible(lines).join("\n")).not.toContain("<SKILL");
		expect(hasBg(lines, "customMessageBg")).toBe(true);
	});
});

describe("view_skill card — known failure", () => {
	it("not-found without similar names is a single line on the error background", () => {
		const tool = defineTool();
		const payload = buildFailurePayload(
			"view_skill",
			createFailure("ID_NOT_FOUND"),
		);
		const state: Record<string, unknown> = {};
		const lines = compose(
			tool.renderCall!(
				{ id: "missing" },
				theme,
				renderContext({ args: { id: "missing" }, isPartial: false, state }),
			),
			tool.renderResult!(
				{
					content: [
						{
							type: "text",
							text: "error: no skill named 'missing'\nsuggestions: check the id",
						},
					],
					details: { payload },
				},
				{ expanded: false, isPartial: false },
				theme,
				renderContext({
					args: { id: "missing" },
					isPartial: false,
					isError: true,
					state,
				}),
			),
		);
		expect(cardBody(lines)).toEqual(["[Skill] missing not found"]);
		expect(countIdentity(lines)).toBe(1);
		expect(visible(lines).join("\n")).not.toContain("to show");
		expect(visible(lines).join("\n")).not.toContain("ID_NOT_FOUND");
		expect(visible(lines).join("\n")).not.toMatch(/error:/);
		expect(hasBg(lines, "toolErrorBg")).toBe(true);
		expect(hasBg(lines, "customMessageBg")).toBe(false);
	});

	it("not-found with similar names lists verified paths when expanded", () => {
		const tool = defineTool();
		const payload = buildFailurePayload(
			"view_skill",
			createFailure("ID_NOT_FOUND", {
				evidence: {
					kind: "candidates",
					candidates: [{ id: "notepad", path: "/skills/notepad/SKILL.md" }],
				},
			}),
		);
		const state: Record<string, unknown> = {};
		const collapsed = compose(
			tool.renderCall!(
				{ id: "note" },
				theme,
				renderContext({ args: { id: "note" }, isPartial: false, state }),
			),
			tool.renderResult!(
				{
					content: [{ type: "text", text: "error: missing" }],
					details: { payload },
				},
				{ expanded: false, isPartial: false },
				theme,
				renderContext({
					args: { id: "note" },
					isPartial: false,
					isError: true,
					state,
				}),
			),
		);
		expect(cardBody(collapsed)).toEqual([
			"[Skill] note not found",
			"Found 1 similar skill · Ctrl+O to show",
		]);
		const expanded = compose(
			tool.renderCall!(
				{ id: "note" },
				theme,
				renderContext({ args: { id: "note" }, isPartial: false, state }),
			),
			tool.renderResult!(
				{
					content: [{ type: "text", text: "error: missing" }],
					details: { payload },
				},
				{ expanded: true, isPartial: false },
				theme,
				renderContext({
					args: { id: "note" },
					isPartial: false,
					expanded: true,
					isError: true,
					state,
				}),
			),
		);
		expect(cardBody(expanded)).toEqual([
			"[Skill] note not found",
			"",
			"1 similar skill:",
			"",
			"- notepad /skills/notepad/SKILL.md",
		]);
	});

	it("ambiguous collapsed and expanded match the design phrasing", () => {
		const tool = defineTool();
		const payload = buildFailurePayload(
			"view_skill",
			createFailure("ID_AMBIGUOUS", {
				evidence: {
					kind: "candidates",
					candidates: [
						{ id: "global:github", path: "/g/github/SKILL.md" },
						{ id: "project:github", path: "/p/github/SKILL.md" },
					],
				},
			}),
		);
		const state: Record<string, unknown> = {};
		const collapsed = compose(
			tool.renderCall!(
				{ id: "github" },
				theme,
				renderContext({ args: { id: "github" }, isPartial: false, state }),
			),
			tool.renderResult!(
				{
					content: [{ type: "text", text: "error: ambiguous" }],
					details: { payload },
				},
				{ expanded: false, isPartial: false },
				theme,
				renderContext({
					args: { id: "github" },
					isPartial: false,
					isError: true,
					state,
				}),
			),
		);
		expect(cardBody(collapsed)).toEqual([
			"[Skill] github is ambiguous",
			"2 same skills in different position · Ctrl+O to show",
		]);
		expect(countIdentity(collapsed)).toBe(1);
		const expanded = compose(
			tool.renderCall!(
				{ id: "github" },
				theme,
				renderContext({ args: { id: "github" }, isPartial: false, state }),
			),
			tool.renderResult!(
				{
					content: [{ type: "text", text: "error: ambiguous" }],
					details: { payload },
				},
				{ expanded: true, isPartial: false },
				theme,
				renderContext({
					args: { id: "github" },
					isPartial: false,
					expanded: true,
					isError: true,
					state,
				}),
			),
		);
		expect(cardBody(expanded)).toEqual([
			"[Skill] github is ambiguous",
			"",
			"There's 2 versions:",
			"",
			"- global:github /g/github/SKILL.md",
			"- project:github /p/github/SKILL.md",
		]);
		expect(hasBg(expanded, "toolErrorBg")).toBe(true);
	});

	it("a thrown execute still paints not-found when details are wiped", async () => {
		const registry: Registry = {
			entries: [
				{
					storage: "global",
					name: "git",
					id: "git",
					state: "active",
					frontmatter: {},
					filePath: "/skills/git/SKILL.md",
					baseDir: "/skills/git",
					description: "git",
				},
			],
			conflicts: [],
			indexEmpty: false,
			filter: () => registry.entries,
		};
		const tool = defineTool(registry);
		await expect(
			tool.execute("call-throw", { id: "missing" }, undefined, undefined, {
				cwd: "/tmp",
				isProjectTrusted: () => true,
			}),
		).rejects.toThrow(/error:/);
		const state: Record<string, unknown> = {};
		const lines = compose(
			tool.renderCall!(
				{ id: "missing" },
				theme,
				renderContext({
					args: { id: "missing" },
					toolCallId: "call-throw",
					isPartial: false,
					state,
				}),
			),
			tool.renderResult!(
				{
					content: [{ type: "text", text: "error: no skill named 'missing'" }],
					details: {},
				},
				{ expanded: false, isPartial: false },
				theme,
				renderContext({
					args: { id: "missing" },
					toolCallId: "call-throw",
					isPartial: false,
					isError: true,
					state,
				}),
			),
		);
		expect(cardBody(lines)).toEqual(["[Skill] missing not found"]);
		expect(visible(lines).join("\n")).not.toContain("error:");
	});
});

describe("view_skill card — malformed success and unknown failure", () => {
	it("malformed success uses Result details unavailable on the success background", () => {
		const tool = defineTool();
		const state: Record<string, unknown> = {};
		const lines = compose(
			tool.renderCall!(
				{ id: "git" },
				theme,
				renderContext({ isPartial: false, state }),
			),
			tool.renderResult!(
				{ content: [{ type: "text", text: gitDetails.content }], details: {} },
				{ expanded: true, isPartial: false },
				theme,
				renderContext({ isPartial: false, expanded: true, isError: false, state }),
			),
		);
		expect(cardBody(lines)).toEqual(["view_skill · Result details unavailable"]);
		expect(countIdentity(lines)).toBe(1);
		expect(visible(lines).join("\n")).not.toContain("# Git");
		expect(visible(lines).join("\n")).not.toMatch(/error:/);
		expect(hasBg(lines, "customMessageBg")).toBe(true);
		expect(hasBg(lines, "toolErrorBg")).toBe(false);
	});

	it("unknown failure uses Tool execution failed on the error background", () => {
		const tool = defineTool();
		const state: Record<string, unknown> = {};
		const lines = compose(
			tool.renderCall!(
				{ id: "git" },
				theme,
				renderContext({ isPartial: false, state }),
			),
			tool.renderResult!(
				{
					content: [{ type: "text", text: "error: boom\nsuggestions: try again" }],
					details: {},
				},
				{ expanded: false, isPartial: false },
				theme,
				renderContext({ isPartial: false, isError: true, state }),
			),
		);
		expect(cardBody(lines)).toEqual(["view_skill · Tool execution failed"]);
		expect(countIdentity(lines)).toBe(1);
		expect(visible(lines).join("\n")).not.toContain("boom");
		expect(visible(lines).join("\n")).not.toMatch(/suggestions:/);
		expect(hasBg(lines, "toolErrorBg")).toBe(true);
		expect(hasBg(lines, "customMessageBg")).toBe(false);
	});
});

describe("view_skill card — rebuild and partial", () => {
	it("a rebuild after settlement does not revert the card to pending", () => {
		const tool = defineTool();
		const state: Record<string, unknown> = {};
		const first = compose(
			tool.renderCall!(
				{ id: "git" },
				theme,
				renderContext({ isPartial: false, state }),
			),
			tool.renderResult!(
				{
					content: [{ type: "text", text: gitDetails.content }],
					details: gitDetails,
				},
				{ expanded: false, isPartial: false },
				theme,
				renderContext({ isPartial: false, state }),
			),
		);
		expect(cardBody(first)).toEqual(["[Skill] git · Ctrl+O to expand"]);

		const rebuilt = compose(
			tool.renderCall!(
				{ id: "git" },
				theme,
				renderContext({ isPartial: false, state }),
			),
			tool.renderResult!(
				{
					content: [{ type: "text", text: gitDetails.content }],
					details: gitDetails,
				},
				{ expanded: false, isPartial: false },
				theme,
				renderContext({ isPartial: false, state }),
			),
		);
		expect(cardBody(rebuilt)).toEqual(["[Skill] git · Ctrl+O to expand"]);
		expect(cardBody(rebuilt)).not.toEqual(["[Skill] git ..."]);
		expect(countIdentity(rebuilt)).toBe(1);

		const retained = retainPresentation({
			tool: "view_skill",
			phase: "collapsed",
			payload: gitPayload,
			args: { id: "git" },
			keyHint,
		});
		const fromData = rebuildPresentation(retained, theme, { Text, Container });
		expect(
			fromData.render(80).map((line) => line.replace(SGR, "").trimEnd()),
		).toEqual(["[Skill] git · Ctrl+O to expand"]);
	});

	it("a partial result never becomes a settled outcome", () => {
		const tool = defineTool();
		const state: Record<string, unknown> = {};
		const lines = compose(
			tool.renderCall!(
				{ id: "git" },
				theme,
				renderContext({ isPartial: true, state }),
			),
			tool.renderResult!(
				{
					content: [{ type: "text", text: gitDetails.content }],
					details: gitDetails,
				},
				{ expanded: true, isPartial: true },
				theme,
				renderContext({ isPartial: true, expanded: true, state }),
			),
		);
		expect(cardBody(lines)).toEqual(["[Skill] git ..."]);
		expect(countIdentity(lines)).toBe(1);
		expect(visible(lines).join("\n")).not.toContain("to expand");
		expect(visible(lines).join("\n")).not.toContain("# Git");
		expect(hasBg(lines, "toolPendingBg")).toBe(true);
	});
});

describe("view_skill execute declares content format", () => {
	it("sets format full or frontmatter on details and never infers it later", async () => {
		const root = mkdtempSync(join(tmpdir(), "view-skill-card-"));
		try {
			const skillDir = join(root, "notes");
			mkdirSync(skillDir);
			const skillFile = join(skillDir, "SKILL.md");
			writeFileSync(skillFile, "---\nname: notes\n---\n# Notes\nbody\n", "utf8");
			const registry: Registry = {
				entries: [
					{
						storage: "global",
						name: "notes",
						id: "notes",
						state: "active",
						frontmatter: { name: "notes" },
						filePath: skillFile,
						baseDir: skillDir,
						description: "notes",
					},
				],
				conflicts: [],
				indexEmpty: false,
				filter: () => registry.entries,
			};
			const tool = defineTool(registry);
			const full = (await tool.execute(
				"call-full",
				{ id: "notes" },
				undefined,
				undefined,
				{ cwd: root, isProjectTrusted: () => true },
			)) as unknown as { details: ViewSkillDetails };
			expect(full.details.format).toBe("full");
			expect(full.details.payload.data.content).toContain("# Notes");
			expect(full.details.payload.data.content).toContain("name: notes");
			expect(full.details.content).toContain("<SKILL");

			const fm = (await tool.execute(
				"call-fm",
				{ id: "notes", frontmatterOnly: true },
				undefined,
				undefined,
				{ cwd: root, isProjectTrusted: () => true },
			)) as unknown as { details: ViewSkillDetails };
			expect(fm.details.format).toBe("frontmatter");
			expect(fm.details.payload.data.content).toContain("name: notes");
			expect(fm.details.payload.data.content).not.toContain("# Notes");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("view_skill recovers a thrown failure from the shared stash", () => {
	it("keeps not-found after failError with wiped details and empty row state", () => {
		const source: FailureSource = {
			error: "no skill named 'missing'",
			code: "ID_NOT_FOUND",
			evidence: { kind: "none" },
		};
		expect(() => failError("call-seam", "view_skill", source)).toThrow(
			/error:/,
		);
		const tool = defineTool();
		const wiped = {
			content: [
				{
					type: "text" as const,
					text: "error: no skill named 'missing'",
				},
			],
			details: {},
		};
		const paint = () => {
			const state: Record<string, unknown> = {};
			return compose(
				tool.renderCall!(
					{ id: "missing" },
					theme,
					renderContext({
						args: { id: "missing" },
						toolCallId: "call-seam",
						isPartial: false,
						state,
					}),
				),
				tool.renderResult!(
					wiped,
					{ expanded: false, isPartial: false },
					theme,
					renderContext({
						args: { id: "missing" },
						toolCallId: "call-seam",
						isPartial: false,
						isError: true,
						state,
					}),
				),
			);
		};
		expect(cardBody(paint())).toEqual(["[Skill] missing not found"]);
		expect(cardBody(paint())).toEqual(["[Skill] missing not found"]);
		expect(visible(paint()).join("\n")).not.toContain("Tool execution failed");
	});
});
