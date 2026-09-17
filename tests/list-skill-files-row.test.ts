/**
 * Task 9 — `list_skill_files` composed rows through the tool's
 * renderCall/renderResult. Real pi-tui Text/Container and the real
 * dark theme (pi-tui-rendering-harness.md). A fake theme or a
 * single-slot dump voids the evidence.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { Text, Container } from "../deps/pi-tui";
import { testTheme } from "../deps/pi-theme";
import { defineListSkillFiles } from "../tools/list-skill-files";
import type { ToolDeps } from "../tools/shared";
import { clearThrownFailures, failEmptyIndex } from "../tools/shared";
import {
	buildFailurePayload,
	buildListSkillFilesPayload,
	type TransportPayload,
} from "../transport";
import { createFailure } from "../failure";

const theme = testTheme("dark");

const SGR = /\x1b\[[0-9;]*m/g;

function keyHint(binding: string, fallback: string): string {
	if (binding !== "app.tools.expand") {
		throw new Error(`unexpected keybinding '${binding}'`);
	}
	return `Ctrl+O ${fallback}`;
}

function unusedType(): ToolDeps["Type"] {
	return {
		Union: (schemas) => schemas,
		Literal: (value) => value,
		Object: (properties) => properties,
		Optional: (schema) => schema,
		Boolean: () => ({}),
		String: () => ({}),
		Record: () => ({}),
		Unknown: () => ({}),
	};
}

class UnusedBox {
	addChild(_component: unknown): void {}
	clear(): void {}
	render(): string[] {
		return [];
	}
	invalidate() {}
}

function defineTool() {
	return defineListSkillFiles({
		Type: unusedType(),
		Text,
		Container,
		Box: UnusedBox,
		expandKeyHint: keyHint,
		registryDeps: () => {
			throw new Error("execute is not under test");
		},
	});
}

type Settled = {
	details?: Record<string, unknown>;
	content?: ReadonlyArray<{ type: string; text?: string }>;
	expanded: boolean;
	isError?: boolean;
};

function compose(args: { id?: string }, settled?: Settled): string[] {
	const tool = defineTool();
	const state: Record<string, unknown> = {};
	const ctx = {
		args,
		toolCallId: "t1",
		invalidate: () => {},
		lastComponent: undefined,
		state,
		cwd: "/tmp",
		executionStarted: settled !== undefined,
		argsComplete: true,
		isPartial: false,
		expanded: settled?.expanded ?? false,
		showImages: false,
		isError: settled?.isError ?? false,
	};
	const composed = new Container();
	composed.addChild(tool.renderCall!(args, theme, ctx));
	if (settled !== undefined) {
		composed.addChild(
			tool.renderResult!(
				{
					content: settled.content ?? [],
					details: settled.details,
				},
				{ expanded: settled.expanded },
				theme,
				ctx,
			),
		);
	}
	return composed.render(80);
}

function composeOn(
	tool: ReturnType<typeof defineTool>,
	state: Record<string, unknown>,
	args: { id?: string },
	settled?: Settled,
	callOnly = false,
): string[] {
	const ctx = {
		args,
		toolCallId: "t1",
		invalidate: () => {},
		lastComponent: undefined,
		state,
		cwd: "/tmp",
		executionStarted: settled !== undefined,
		argsComplete: true,
		isPartial: false,
		expanded: settled?.expanded ?? false,
		showImages: false,
		isError: settled?.isError ?? false,
	};
	const composed = new Container();
	composed.addChild(tool.renderCall!(args, theme, ctx));
	if (settled !== undefined && !callOnly) {
		composed.addChild(
			tool.renderResult!(
				{
					content: settled.content ?? [],
					details: settled.details,
				},
				{ expanded: settled.expanded },
				theme,
				ctx,
			),
		);
	}
	return composed.render(80);
}

function visible(lines: string[]): string[] {
	return lines.map((line) => line.replace(SGR, "").trimEnd());
}

function countVisible(lines: string[], snippet: string): number {
	return visible(lines).join("\n").split(snippet).length - 1;
}

const oneFile = buildListSkillFilesPayload(1, "git", [
	{ refId: "references/a.md", path: "/skills/git/references/a.md" },
]);

describe("list_skill_files pending", () => {
	it("paints [Skill] {id} on the call slot with no result and no expand hint", () => {
		const lines = compose({ id: "git" });
		expect(visible(lines)).toEqual(["[Skill] git"]);
		expect(lines[0]).toContain(theme.fg("customMessageLabel", "[Skill] "));
		expect(visible(lines).join("\n")).not.toContain("to expand");
		expect(countVisible(lines, "[Skill]")).toBe(1);
	});
});

describe("list_skill_files pending refresh and settled freeze", () => {
	it("reflects a changed pending id before settlement", () => {
		const tool = defineTool();
		const state: Record<string, unknown> = {};
		const first = composeOn(tool, state, { id: "git" });
		expect(visible(first)).toEqual(["[Skill] git"]);
		const second = composeOn(tool, state, { id: "coding" });
		expect(visible(second)).toEqual(["[Skill] coding"]);
		expect(visible(second).join("\n")).not.toContain("git");
		expect(countVisible(second, "[Skill]")).toBe(1);
		expect(visible(second).join("\n")).not.toContain("to expand");
	});

	it("keeps the settled success row across a call-slot redraw", () => {
		const tool = defineTool();
		const state: Record<string, unknown> = {};
		const settled: Settled = {
			details: { payload: oneFile },
			expanded: false,
		};
		const first = composeOn(tool, state, { id: "git" }, settled);
		expect(visible(first)).toEqual([
			"[Skill] git · Ctrl+O to expand",
			"listed 1 related file",
		]);
		const second = composeOn(tool, state, { id: "coding" }, settled, true);
		expect(visible(second)).toEqual([
			"[Skill] git · Ctrl+O to expand",
			"listed 1 related file",
		]);
		expect(visible(second).join("\n")).not.toContain("coding");
		expect(countVisible(second, "[Skill]")).toBe(1);
	});
});

describe("list_skill_files collapsed", () => {
	it("puts the expand hint on the call line and listed N related files on the result", () => {
		const lines = compose(
			{ id: "git" },
			{ details: { payload: oneFile }, expanded: false },
		);
		expect(visible(lines)).toEqual([
			"[Skill] git · Ctrl+O to expand",
			"listed 1 related file",
		]);
		expect(lines[0]).toContain(theme.fg("customMessageLabel", "[Skill] "));
		expect(countVisible(lines, "[Skill]")).toBe(1);
		expect(visible(lines).join("\n")).not.toContain("list_skill_files");
	});

	it("empty collapsed paints No related files without an expand hint", () => {
		const payload = buildListSkillFilesPayload(0, "git", []);
		const lines = compose(
			{ id: "git" },
			{ details: { payload }, expanded: false },
		);
		expect(visible(lines)).toEqual(["[Skill] git", "No related files"]);
		expect(visible(lines).join("\n")).not.toContain("no files");
		expect(visible(lines).join("\n")).not.toContain("to expand");
		expect(countVisible(lines, "[Skill]")).toBe(1);
	});
});

describe("list_skill_files expanded", () => {
	it("swaps the hint for a count and lists {type/file-name} {path}", () => {
		const lines = compose(
			{ id: "git" },
			{ details: { payload: oneFile }, expanded: true },
		);
		expect(visible(lines)).toEqual([
			"[Skill] git (1)",
			"",
			"- references/a.md /skills/git/references/a.md",
		]);
		expect(countVisible(lines, "[Skill]")).toBe(1);
		expect(visible(lines).join("\n")).not.toContain("to expand");
	});

	it("empty expanded reports No related files", () => {
		const payload = buildListSkillFilesPayload(0, "git", []);
		const lines = compose(
			{ id: "git" },
			{ details: { payload }, expanded: true },
		);
		expect(visible(lines)).toEqual(["[Skill] git (0)", "", "No related files"]);
		expect(countVisible(lines, "[Skill]")).toBe(1);
	});
});

describe("list_skill_files malformed and unknown outcomes", () => {
	it("missing success payload uses Result details unavailable, not model prose", () => {
		const lines = compose(
			{ id: "git" },
			{
				details: {},
				content: [{ type: "text", text: "no files" }],
				expanded: false,
			},
		);
		expect(visible(lines)).toEqual([
			"list_skill_files · Result details unavailable",
		]);
		expect(visible(lines).join("\n")).not.toContain("no files");
		expect(lines[0]).toContain(
			theme.fg("toolOutput", "Result details unavailable"),
		);
	});

	it("unknown error uses Tool execution failed and ignores thrown error text", () => {
		const lines = compose(
			{ id: "git" },
			{
				details: {},
				content: [
					{
						type: "text",
						text: "error: cannot read\nsuggestions: retry",
					},
				],
				expanded: false,
				isError: true,
			},
		);
		expect(visible(lines)).toEqual(["list_skill_files · Tool execution failed"]);
		expect(visible(lines).join("\n")).not.toContain("cannot read");
		expect(visible(lines).join("\n")).not.toContain("suggestions:");
		expect(lines[0]).toContain(theme.fg("error", "Tool execution failed"));
	});

	it("known failure payload projects the fixed unknown-failure wording, not the code", () => {
		const payload = buildFailurePayload(
			"list_skill_files",
			createFailure("DIR_UNREADABLE"),
		);
		const lines = compose(
			{ id: "git" },
			{ details: { payload }, expanded: false, isError: true },
		);
		expect(visible(lines)).toEqual(["list_skill_files · Tool execution failed"]);
		expect(visible(lines).join("\n")).not.toContain("DIR_UNREADABLE");
	});
});

describe("list_skill_files recovers a thrown failure from the shared stash", () => {
	beforeEach(() => {
		clearThrownFailures();
	});

	it("keeps INDEX_EMPTY after failEmptyIndex with wiped details and empty row state", () => {
		expect(() => failEmptyIndex("call-seam", "list_skill_files")).toThrow(
			/error:/,
		);
		const tool = defineTool();
		const args = { id: "git" };
		const wiped = {
			content: [
				{
					type: "text" as const,
					text: "error: skill index is not yet populated\nsuggestions: restart pi",
				},
			],
			details: {},
		};
		const paint = () => {
			const state: { input?: { payload?: TransportPayload } } = {};
			const ctx = {
				args,
				toolCallId: "call-seam",
				invalidate: () => {},
				lastComponent: undefined,
				state,
				cwd: "/tmp",
				executionStarted: true,
				argsComplete: true,
				isPartial: false,
				expanded: false,
				showImages: false,
				isError: true,
			};
			const composed = new Container();
			composed.addChild(tool.renderCall!(args, theme, ctx));
			composed.addChild(
				tool.renderResult!(wiped, { expanded: false }, theme, ctx),
			);
			return { lines: composed.render(80), state };
		};
		const first = paint();
		expect(
			first.state.input?.payload?.outcome === "failure"
				? first.state.input.payload.failure.code
				: undefined,
		).toBe("INDEX_EMPTY");
		expect(visible(first.lines)).toEqual([
			"list_skill_files · Tool execution failed",
		]);
		const second = paint();
		expect(
			second.state.input?.payload?.outcome === "failure"
				? second.state.input.payload.failure.code
				: undefined,
		).toBe("INDEX_EMPTY");
		expect(visible(second.lines)).toEqual([
			"list_skill_files · Tool execution failed",
		]);
	});
});
