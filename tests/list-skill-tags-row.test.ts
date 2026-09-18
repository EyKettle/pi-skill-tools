/**
 * Task 7 — `list_skill_tags` composed rows through the tool's
 * renderCall/renderResult, using real pi-tui Text/Container and the
 * real dark theme (pi-tui-rendering-harness.md). A stub renderer voids
 * the evidence. Slots are constructed first, then composed call-over-result
 * in one Container, matching tool-execution.js updateDisplay() order.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { Text, Container } from "../deps/pi-tui";
import { testTheme } from "../deps/pi-theme";
import { createFailure } from "../failure";
import { defineListSkillTags } from "../tools/list-skill-tags";
import type { ToolDeps } from "../tools/shared";
import type { SkillStorage } from "../skill-id";
import { clearThrownFailures, failEmptyIndex } from "../tools/shared";
import {
	buildFailurePayload,
	buildListSkillTagsPayload,
	type TransportPayload,
} from "../transport";

const theme = testTheme("dark");

const SGR = /\x1b\[[0-9;]*m/g;

function keyHint(binding: string, fallback: string): string {
	if (binding !== "app.tools.expand") {
		throw new Error(`unexpected keybinding '${binding}'`);
	}
	return `Ctrl+O ${fallback}`;
}

const stubType: ToolDeps["Type"] = {
	Union: (schemas) => ({ union: schemas }),
	Literal: (value) => ({ literal: value }),
	Object: (properties) => ({ object: properties }),
	Optional: (schema) => ({ optional: schema }),
	Boolean: () => ({}),
	String: () => ({}),
	Record: () => ({}),
	Unknown: () => ({}),
};

const tool = defineListSkillTags({
	registryDeps: () => {
		throw new Error("execute is not under test");
	},
	Type: stubType,
	Text,
	Box: class {
		addChild() {}
		clear() {}
		render(): string[] {
			return [];
		}
		invalidate() {}
	},
	Container,
	expandKeyHint: keyHint,
});

function visible(lines: string[]): string[] {
	return lines.map((line) => line.replace(SGR, "").trimEnd());
}

function countVisible(lines: string[], snippet: string): number {
	return visible(lines).join("\n").split(snippet).length - 1;
}

function renderContext(options: {
	args?: { location?: SkillStorage };
	expanded?: boolean;
	isError?: boolean;
	state?: Record<string, unknown>;
}) {
	return {
		args: options.args ?? {},
		toolCallId: "t-list-skill-tags",
		invalidate: () => {},
		lastComponent: undefined,
		state: options.state ?? {},
		cwd: "/tmp",
		executionStarted: true,
		argsComplete: true,
		isPartial: false,
		expanded: options.expanded ?? false,
		showImages: false,
		isError: options.isError ?? false,
	};
}

function compose(options: {
	args?: { location?: SkillStorage };
	expanded?: boolean;
	isError?: boolean;
	result?: {
		content: ReadonlyArray<{ type: string; text?: string }>;
		details?: Record<string, unknown>;
	};
}): string[] {
	const state: Record<string, unknown> = {};
	const args = options.args ?? {};
	const ctx = renderContext({
		args,
		expanded: options.expanded,
		isError: options.isError,
		state,
	});
	const composed = new Container();
	composed.addChild(tool.renderCall(args, theme, ctx));
	if (options.result !== undefined) {
		composed.addChild(
			tool.renderResult(
				options.result,
				{
					expanded: options.expanded ?? false,
					isPartial: false,
				},
				theme,
				ctx,
			),
		);
	}
	return composed.render(80);
}

describe("list_skill_tags row through renderCall/renderResult", () => {
	it("pending is the title only, with no result slot and no expand hint", () => {
		const lines = compose({});
		expect(visible(lines)).toEqual(["list_skill_tags ..."]);
		expect(visible(lines).join("\n")).not.toContain("to expand");
		expect(countVisible(lines, "list_skill_tags")).toBe(1);
	});

	it("collapsed shows the expand hint on the call line and the listed count", () => {
		const payload = buildListSkillTagsPayload(2, null, ["cli", "git"]);
		const lines = compose({
			result: {
				content: [{ type: "text", text: "cli, git" }],
				details: { location: "all", tags: 2, payload },
			},
		});
		expect(visible(lines)).toEqual([
			"list_skill_tags · Ctrl+O to expand",
			"listed 2 skill tags",
		]);
		expect(countVisible(lines, "list_skill_tags")).toBe(1);
		expect(lines[0]).toContain(theme.fg("muted", " · Ctrl+O to expand"));
	});

	it("collapsed with a location appends in {Position} on the result line", () => {
		const payload = buildListSkillTagsPayload(2, "package", ["cli", "git"]);
		expect(
			visible(
				compose({
					args: { location: "package" },
					result: {
						content: [{ type: "text", text: "cli, git" }],
						details: { location: "package", tags: 2, payload },
					},
				}),
			),
		).toEqual([
			"list_skill_tags · Ctrl+O to expand",
			"listed 2 skill tags in Package",
		]);
	});

	it("expanded swaps the hint for a count and paints tags as a comma stream", () => {
		const payload = buildListSkillTagsPayload(2, null, ["cli", "git"]);
		const lines = compose({
			expanded: true,
			result: {
				content: [{ type: "text", text: "cli, git" }],
				details: { location: "all", tags: 2, payload },
			},
		});
		expect(visible(lines)).toEqual(["list_skill_tags (2)", "", "cli, git"]);
		expect(countVisible(lines, "list_skill_tags")).toBe(1);
		expect(visible(lines)[2]).toBe("cli, git");
	});

	it("expanded with a location puts Position in the title paren", () => {
		const payload = buildListSkillTagsPayload(2, "package", ["cli", "git"]);
		expect(
			visible(
				compose({
					args: { location: "package" },
					expanded: true,
					result: {
						content: [{ type: "text", text: "cli, git" }],
						details: { location: "package", tags: 2, payload },
					},
				}),
			),
		).toEqual(["list_skill_tags (2 in Package)", "", "cli, git"]);
	});

	it("empty collapsed paints No tags found without an expand hint", () => {
		const payload = buildListSkillTagsPayload(0, null, []);
		expect(
			visible(
				compose({
					result: {
						content: [{ type: "text", text: "no skills carry metadata.tags" }],
						details: { location: "all", tags: 0, payload },
					},
				}),
			),
		).toEqual(["list_skill_tags", "No tags found"]);
	});

	it("empty collapsed with a location keeps the expand hint", () => {
		const payload = buildListSkillTagsPayload(0, "global", []);
		expect(
			visible(
				compose({
					args: { location: "global" },
					result: {
						content: [{ type: "text", text: "no tags" }],
						details: { location: "global", tags: 0, payload },
					},
				}),
			),
		).toEqual(["list_skill_tags · Ctrl+O to expand", "No tags found"]);
	});

	it("empty expanded reports No tags found", () => {
		const payload = buildListSkillTagsPayload(0, null, []);
		expect(
			visible(
				compose({
					expanded: true,
					result: {
						content: [{ type: "text", text: "no skills carry metadata.tags" }],
						details: { location: "all", tags: 0, payload },
					},
				}),
			),
		).toEqual(["list_skill_tags (0)", "", "No tags found"]);
	});

	it("missing payload uses the malformed wording and ignores model prose", () => {
		const lines = compose({
			result: {
				content: [{ type: "text", text: "no skills carry metadata.tags" }],
				details: { location: "all", tags: 0 },
			},
		});
		expect(visible(lines)).toEqual([
			"list_skill_tags · Result details unavailable",
		]);
		expect(visible(lines).join("\n")).not.toContain(
			"no skills carry metadata.tags",
		);
		expect(countVisible(lines, "list_skill_tags")).toBe(1);
	});

	it("error without a payload paints the unknown-failure wording, not thrown text", () => {
		const lines = compose({
			isError: true,
			result: {
				content: [
					{
						type: "text",
						text: "error: skill index is not yet populated\nsuggestions: restart pi",
					},
				],
			},
		});
		expect(visible(lines).join("\n")).not.toContain("error:");
		expect(visible(lines).join("\n")).not.toContain("suggestions:");
		expect(visible(lines)).toEqual(["list_skill_tags · Tool execution failed"]);
		expect(countVisible(lines, "list_skill_tags")).toBe(1);
	});

	it("error with empty details paints the unknown-failure wording", () => {
		const lines = compose({
			isError: true,
			result: {
				content: [{ type: "text", text: "error: boom\nsuggestions: none" }],
				details: {},
			},
		});
		expect(visible(lines)).toEqual(["list_skill_tags · Tool execution failed"]);
		expect(visible(lines).join("\n")).not.toContain("error:");
	});

	it("keeps the unknown-failure wording after a later redraw with wiped details", () => {
		const state: Record<string, unknown> = {};
		const args = {};
		const ctx = renderContext({ args, isError: true, state });
		const first = new Container();
		first.addChild(tool.renderCall(args, theme, ctx));
		first.addChild(
			tool.renderResult(
				{
					content: [{ type: "text", text: "error: boom\nsuggestions: none" }],
					details: {},
				},
				{ expanded: false, isPartial: false },
				theme,
				ctx,
			),
		);
		expect(visible(first.render(80))).toEqual([
			"list_skill_tags · Tool execution failed",
		]);
		const redraw = new Container();
		redraw.addChild(tool.renderCall(args, theme, ctx));
		redraw.addChild(
			tool.renderResult(
				{ content: [{ type: "text", text: "" }], details: {} },
				{ expanded: false, isPartial: false },
				theme,
				ctx,
			),
		);
		expect(visible(redraw.render(80))).toEqual([
			"list_skill_tags · Tool execution failed",
		]);
	});

	it("failure payload projects the unknown-failure wording, not thrown text", () => {
		const payload = buildFailurePayload(
			"list_skill_tags",
			createFailure("INDEX_EMPTY", { evidence: { kind: "none" } }),
		);
		const lines = compose({
			isError: true,
			result: {
				content: [
					{
						type: "text",
						text: "error: skill index is not yet populated\nsuggestions: restart pi",
					},
				],
				details: { payload },
			},
		});
		expect(visible(lines)).toEqual(["list_skill_tags · Tool execution failed"]);
		expect(visible(lines).join("\n")).not.toContain("error:");
		expect(countVisible(lines, "list_skill_tags")).toBe(1);
	});
});

describe("list_skill_tags recovers a thrown failure from the shared stash", () => {
	beforeEach(() => {
		clearThrownFailures();
	});

	it("keeps INDEX_EMPTY after failEmptyIndex with wiped details and empty row state", () => {
		expect(() => failEmptyIndex("call-seam", "list_skill_tags")).toThrow(
			/error:/,
		);
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
			composed.addChild(tool.renderCall(args, theme, ctx));
			composed.addChild(
				tool.renderResult(wiped, { expanded: false, isPartial: false }, theme, ctx),
			);
			return { lines: composed.render(80), state };
		};
		const first = paint();
		expect(
			first.state.payload?.outcome === "failure"
				? first.state.payload.failure.code
				: undefined,
		).toBe("INDEX_EMPTY");
		expect(visible(first.lines)).toEqual([
			"list_skill_tags · Tool execution failed",
		]);
		const second = paint();
		expect(
			second.state.payload?.outcome === "failure"
				? second.state.payload.failure.code
				: undefined,
		).toBe("INDEX_EMPTY");
		expect(visible(second.lines)).toEqual([
			"list_skill_tags · Tool execution failed",
		]);
	});
});
