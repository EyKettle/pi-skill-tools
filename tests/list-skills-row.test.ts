/**
 * Task 6 — list_skills composed-row assertions through the tool's
 * renderCall/renderResult, real pi-tui Text/Container, and the real
 * dark theme (pi-tui-rendering-harness.md). Call slot then result slot.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { Text, Container } from "../deps/pi-tui";
import { testTheme } from "../deps/pi-theme";
import { defineListSkills } from "../tools/list-skills";
import type { ToolDeps } from "../tools/shared";
import { clearThrownFailures, failEmptyIndex } from "../tools/shared";
import { buildListSkillsPayload, type TransportPayload } from "../transport";

const theme = testTheme("dark");

const SGR = /\x1b\[[0-9;]*m/g;

function keyHint(binding: string, fallback: string): string {
	if (binding !== "app.tools.expand") {
		throw new Error(`unexpected keybinding '${binding}'`);
	}
	return `Ctrl+O ${fallback}`;
}

function unusedBox(): ToolDeps["Box"] {
	return class {
		addChild(_component: unknown) {}
		clear() {}
		render(): string[] {
			return [];
		}
		invalidate() {}
	};
}

function deps(): ToolDeps {
	return {
		registryDeps: () => {
			throw new Error("execute is not under test");
		},
		Type: {
			Union: () => ({}),
			Literal: () => ({}),
			Object: () => ({}),
			Optional: () => ({}),
			Boolean: () => ({}),
			String: () => ({}),
			Record: () => ({}),
			Unknown: () => ({}),
		},
		Text: Text as ToolDeps["Text"],
		Box: unusedBox(),
		Container: Container as ToolDeps["Container"],
		expandKeyHint: keyHint,
	};
}

function visible(lines: string[]): string[] {
	return lines.map((line) => line.replace(SGR, "").trimEnd());
}

function countVisible(lines: string[], snippet: string): number {
	return visible(lines).join("\n").split(snippet).length - 1;
}

function compose(options: {
	args?: unknown;
	isPartial: boolean;
	expanded?: boolean;
	isError?: boolean;
	details?: Record<string, unknown>;
	content?: string;
	state?: Record<string, unknown>;
}): string[] {
	const tool = defineListSkills(deps());
	const args = options.args ?? {};
	const composed = new Container();
	composed.addChild(tool.renderCall(args, theme, { isPartial: options.isPartial }));
	if (!options.isPartial) {
		composed.addChild(
			tool.renderResult(
				{
					content: [{ type: "text", text: options.content ?? "model unused" }],
					details: options.details ?? {},
				},
				{ expanded: options.expanded === true },
				theme,
				{
					args,
					isError: options.isError === true,
					state: options.state ?? {},
				},
			),
		);
	}
	return composed.render(80);
}

describe("list_skills tool row", () => {
	it("pending is the title only, with no result slot and no expand hint", () => {
		const lines = compose({ isPartial: true, args: { location: "project" } });
		expect(visible(lines)).toEqual(["list_skills ..."]);
		expect(visible(lines).join("\n")).not.toContain("to expand");
		expect(visible(lines).join("\n")).not.toContain("location");
		expect(countVisible(lines, "list_skills")).toBe(1);
	});

	it("collapsed shows the expand hint on the call line and the listed count", () => {
		const payload = buildListSkillsPayload(3, null, [
			{ id: "git", filePath: "/skills/git/SKILL.md" },
			{ id: "notes", filePath: "/skills/notes/SKILL.md" },
			{ id: "cli", filePath: "/skills/cli/SKILL.md" },
		]);
		const lines = compose({
			isPartial: false,
			expanded: false,
			details: { payload, count: 3, location: "all" },
			content: "- git [active] /skills/git/SKILL.md",
		});
		expect(visible(lines)).toEqual([
			"list_skills · Ctrl+O to expand",
			"listed 3 skills",
		]);
		expect(countVisible(lines, "list_skills")).toBe(1);
		expect(lines[0]).toContain(theme.fg("muted", " · Ctrl+O to expand"));
		expect(visible(lines).join("\n")).not.toContain("in total");
		expect(visible(lines).join("\n")).not.toContain("[active]");
	});

	it("collapsed with a location appends in {Position} on the result line", () => {
		const payload = buildListSkillsPayload(2, "project", [
			{ id: "git", filePath: "/p/git/SKILL.md" },
			{ id: "notes", filePath: "/p/notes/SKILL.md" },
		]);
		expect(
			visible(
				compose({
					isPartial: false,
					args: { location: "project" },
					details: { payload },
				}),
			),
		).toEqual(["list_skills · Ctrl+O to expand", "listed 2 skills in Project"]);
	});

	it("expanded swaps the hint for a count and puts a blank in the result slot", () => {
		const payload = buildListSkillsPayload(2, null, [
			{ id: "git", filePath: "/skills/git/SKILL.md" },
			{ id: "global:notes", filePath: "/skills/notes/SKILL.md" },
		]);
		const lines = compose({
			isPartial: false,
			expanded: true,
			details: { payload },
			content:
				"- git [active] /skills/git/SKILL.md\n- notes [active] /skills/notes/SKILL.md",
		});
		expect(visible(lines)).toEqual([
			"list_skills (2)",
			"",
			"- git /skills/git/SKILL.md",
			"- global:notes /skills/notes/SKILL.md",
		]);
		expect(countVisible(lines, "list_skills")).toBe(1);
		expect(visible(lines).join("\n")).not.toContain("[active]");
	});

	it("expanded with a location puts Position in the title paren", () => {
		const payload = buildListSkillsPayload(1, "global", [
			{ id: "git", filePath: "/skills/git/SKILL.md" },
		]);
		expect(
			visible(
				compose({
					isPartial: false,
					expanded: true,
					args: { location: "global" },
					details: { payload },
				}),
			),
		).toEqual(["list_skills (1 in Global)", "", "- git /skills/git/SKILL.md"]);
	});

	it("empty collapsed paints No skills found without an expand hint", () => {
		const payload = buildListSkillsPayload(0, null, []);
		expect(
			visible(
				compose({
					isPartial: false,
					details: { payload },
				}),
			),
		).toEqual(["list_skills", "No skills found"]);
	});

	it("empty collapsed with a location keeps the expand hint", () => {
		const payload = buildListSkillsPayload(0, "global", []);
		expect(
			visible(
				compose({
					isPartial: false,
					args: { location: "global" },
					details: { payload },
				}),
			),
		).toEqual(["list_skills · Ctrl+O to expand", "No skills found"]);
	});

	it("empty expanded reports No skills found", () => {
		const payload = buildListSkillsPayload(0, null, []);
		expect(
			visible(
				compose({
					isPartial: false,
					expanded: true,
					details: { payload },
				}),
			),
		).toEqual(["list_skills (0)", "", "No skills found"]);
	});

	it("a missing payload on the success shell uses the unavailable wording, not model prose", () => {
		const lines = compose({
			isPartial: false,
			content: "error: skill index is not yet populated\nsuggestions: restart pi",
			details: {},
		});
		expect(visible(lines)).toEqual(["list_skills · Result details unavailable"]);
		expect(countVisible(lines, "list_skills")).toBe(1);
		expect(visible(lines).join("\n")).not.toMatch(/error:/);
		expect(visible(lines).join("\n")).not.toMatch(/suggestions:/);
		expect(visible(lines).join("\n")).not.toContain("skill index");
	});

	it("a thrown error with empty details paints Tool execution failed", () => {
		const lines = compose({
			isPartial: false,
			isError: true,
			details: {},
			content: "error: skill index is not yet populated\nsuggestions: restart pi",
		});
		expect(visible(lines)).toEqual(["list_skills · Tool execution failed"]);
		expect(countVisible(lines, "list_skills")).toBe(1);
		expect(visible(lines).join("\n")).not.toMatch(/error:/);
		expect(visible(lines).join("\n")).not.toMatch(/suggestions:/);
		expect(visible(lines).join("\n")).not.toContain("unavailable");
	});

	it("retains the settled payload when a later redraw wipes details", () => {
		const payload = buildListSkillsPayload(3, null, [
			{ id: "git", filePath: "/skills/git/SKILL.md" },
			{ id: "notes", filePath: "/skills/notes/SKILL.md" },
			{ id: "cli", filePath: "/skills/cli/SKILL.md" },
		]);
		const state: Record<string, unknown> = {};
		compose({
			isPartial: false,
			details: { payload, count: 3, location: "all" },
			state,
		});
		const lines = compose({
			isPartial: false,
			details: {},
			state,
		});
		expect(visible(lines)).toEqual([
			"list_skills · Ctrl+O to expand",
			"listed 3 skills",
		]);
	});
});

describe("list_skills recovers a thrown failure from the shared stash", () => {
	beforeEach(() => {
		clearThrownFailures();
	});

	it("keeps INDEX_EMPTY after failEmptyIndex with wiped details and empty row state", () => {
		expect(() => failEmptyIndex("call-seam", "list_skills")).toThrow(/error:/);
		const tool = defineListSkills(deps());
		const args = {};
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
			const state: { payload?: TransportPayload } = {};
			const composed = new Container();
			composed.addChild(tool.renderCall(args, theme, { isPartial: false }));
			const context = {
				args,
				toolCallId: "call-seam",
				isError: true,
				state,
			};
			composed.addChild(tool.renderResult(wiped, { expanded: false }, theme, context));
			return { lines: composed.render(80), state };
		};
		const first = paint();
		expect(
			first.state.payload?.outcome === "failure"
				? first.state.payload.failure.code
				: undefined,
		).toBe("INDEX_EMPTY");
		expect(visible(first.lines)).toEqual(["list_skills · Tool execution failed"]);
		const second = paint();
		expect(
			second.state.payload?.outcome === "failure"
				? second.state.payload.failure.code
				: undefined,
		).toBe("INDEX_EMPTY");
		expect(visible(second.lines)).toEqual([
			"list_skills · Tool execution failed",
		]);
	});
});
