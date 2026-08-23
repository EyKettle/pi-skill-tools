/**
 * Task 8 — search_skills composed rows through the real tool renderers.
 * Evidence: real @earendil-works/pi-tui Text/Container and the real dark
 * theme, call slot then result slot (pi-tui-rendering-harness.md).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { Text, Container, Box } from "../deps/pi-tui";
import { testTheme } from "../deps/pi-theme";
import { defineSearchSkills } from "../tools/search-skills";
import type { ToolDeps } from "../tools/shared";
import { clearThrownFailures, failEmptyIndex } from "../tools/shared";
import { buildSearchSkillsPayload } from "../transport";
import type { TransportPayload } from "../transport";
import type { Registry } from "../registry";

const theme = testTheme("dark");

beforeEach(() => {
	clearThrownFailures();
});

const SGR = /\x1b\[[0-9;]*m/g;

function visible(lines: string[]): string[] {
	return lines.map((line) => line.replace(SGR, "").trimEnd());
}

function identityCount(lines: string[]): number {
	return visible(lines).filter((line) => line.startsWith("search_skills"))
		.length;
}

function asChild(component: unknown): {
	render(width: number): string[];
	invalidate(): void;
} {
	return component as {
		render(width: number): string[];
		invalidate(): void;
	};
}

const TypeStub: ToolDeps["Type"] = {
	Union: (schemas) => schemas,
	Literal: (value) => value,
	Object: (properties) => properties,
	Optional: (schema) => schema,
	Boolean: () => ({}),
	String: () => ({}),
	Record: () => ({}),
	Unknown: () => ({}),
};

function expandKeyHint(binding: string, fallback: string): string {
	if (binding !== "app.tools.expand") {
		throw new Error(`unexpected keybinding '${binding}'`);
	}
	return `Ctrl+O ${fallback}`;
}

function emptyRegistry(): Registry {
	return {
		entries: [],
		conflicts: [],
		indexEmpty: false,
		filter: () => [],
	};
}

function makeTool(registry: Registry = emptyRegistry()) {
	return defineSearchSkills({
		Type: TypeStub,
		Text,
		Box,
		Container,
		expandKeyHint,
		registryDeps: () => registry,
	});
}

interface RenderOpts {
	args?: {
		frontmatter?: Record<string, unknown>;
		location?: "global" | "project" | "package";
	};
	payload?: TransportPayload;
	expanded?: boolean;
	isError?: boolean;
	toolCallId?: string;
	result?: {
		content: ReadonlyArray<{ type: string; text?: string }>;
		details?: Record<string, unknown>;
	};
	/** When false, do not seed state — used to prove the execute handoff. */
	seedState?: boolean;
	pending?: boolean;
}

function compose(opts: RenderOpts): string[] {
	const tool = makeTool();
	const args = opts.args ?? { frontmatter: { name: "git" } };
	const state: { payload?: TransportPayload } = {};
	if (opts.seedState !== false && opts.payload !== undefined) {
		state.payload = opts.payload;
	}
	const context = {
		args,
		toolCallId: opts.toolCallId ?? "t-search",
		invalidate: () => undefined,
		lastComponent: undefined,
		state,
		cwd: "/tmp",
		executionStarted: true,
		argsComplete: true,
		isPartial: opts.pending === true,
		expanded: opts.expanded ?? false,
		showImages: false,
		isError: opts.isError ?? false,
	};
	const composed = new Container();
	composed.addChild(asChild(tool.renderCall(args, theme, context)));
	if (opts.pending !== true) {
		const result = opts.result ?? {
			content: [{ type: "text", text: "no matches" }],
			details: opts.payload === undefined ? {} : { payload: opts.payload },
		};
		composed.addChild(
			asChild(
				tool.renderResult(
					result,
					{ expanded: opts.expanded ?? false },
					theme,
					context,
				),
			),
		);
	}
	return composed.render(80);
}

describe("search_skills pending row", () => {
	it("is the title only: no hint, no filters, no result slot", () => {
		const lines = compose({
			pending: true,
			args: { frontmatter: { name: "git" } },
		});
		expect(visible(lines)).toEqual(["search_skills"]);
		expect(identityCount(lines)).toBe(1);
		expect(visible(lines).join("\n")).not.toContain("to expand");
		expect(visible(lines).join("\n")).not.toContain("name:");
	});
});

const gitMatch = {
	id: "git",
	filePath: "/skills/git/SKILL.md",
};

function gitPayload(
	count: number,
	location: "global" | "project" | "package" | null,
	filters: Record<string, unknown> = { name: "git" },
) {
	const matches = Array.from({ length: count }, (_, i) =>
		i === 0 ? gitMatch : { id: `s${i}`, filePath: `/skills/s${i}/SKILL.md` },
	);
	return buildSearchSkillsPayload(count, location, filters, matches);
}

describe("search_skills collapsed row", () => {
	it("shows the expand hint on the call line and matched {n} skill", () => {
		const lines = compose({
			payload: gitPayload(1, null),
			args: { frontmatter: { name: "git" } },
		});
		expect(visible(lines)).toEqual([
			"search_skills · Ctrl+O to expand",
			"matched 1 skill",
		]);
		expect(identityCount(lines)).toBe(1);
		expect(visible(lines).join("\n")).not.toContain("name: git");
	});

	it("appends in {Position} when a location is selected", () => {
		const lines = compose({
			payload: gitPayload(2, "project"),
			args: { frontmatter: { name: "git" }, location: "project" },
		});
		expect(visible(lines)).toEqual([
			"search_skills · Ctrl+O to expand",
			"matched 2 skills in Project",
		]);
		expect(identityCount(lines)).toBe(1);
	});

	it("no-match with filters still shows the expand hint", () => {
		const lines = compose({
			payload: gitPayload(0, null, { name: "missing" }),
			args: { frontmatter: { name: "missing" } },
		});
		expect(visible(lines)).toEqual([
			"search_skills · Ctrl+O to expand",
			"matched 0 skills",
		]);
		expect(identityCount(lines)).toBe(1);
	});
});

describe("search_skills expanded row", () => {
	it("paints filters then the match list, with a blank after the title", () => {
		const payload = gitPayload(1, null, { name: "git" });
		const lines = compose({
			payload,
			expanded: true,
			args: { frontmatter: { name: "git" } },
		});
		expect(visible(lines)).toEqual([
			"search_skills (1)",
			"",
			"name: git",
			"",
			"- git /skills/git/SKILL.md",
		]);
		expect(identityCount(lines)).toBe(1);
		expect(lines.some((line) => line.includes(theme.fg("accent", "name: git")))).toBe(
			true,
		);
	});

	it("expanded with a location puts {Position} in the title parens", () => {
		const lines = compose({
			payload: gitPayload(1, "global"),
			expanded: true,
			args: { frontmatter: { name: "git" }, location: "global" },
		});
		expect(visible(lines)).toEqual([
			"search_skills (1 in Global)",
			"",
			"name: git",
			"",
			"- git /skills/git/SKILL.md",
		]);
		expect(identityCount(lines)).toBe(1);
	});

	it("does not dump per-match annotations the design does not show", () => {
		const lines = compose({
			payload: gitPayload(1, null, { "metadata.tags": ["cli"] }),
			expanded: true,
			args: { frontmatter: { "metadata.tags": ["cli"] } },
			result: {
				content: [
					{
						type: "text",
						text: "git /skills/git/SKILL.md\nmetadata.tags: *cli*",
					},
				],
				details: {
					payload: gitPayload(1, null, { "metadata.tags": ["cli"] }),
				},
			},
		});
		const text = visible(lines).join("\n");
		expect(text).toContain("metadata.tags: [\"cli\"]");
		expect(text).not.toContain("*cli*");
		expect(identityCount(lines)).toBe(1);
	});

	it("zero-match with filters paints the filter block then No matches", () => {
		const lines = compose({
			payload: gitPayload(0, null, { name: "missing" }),
			expanded: true,
			args: { frontmatter: { name: "missing" } },
		});
		expect(visible(lines)).toEqual([
			"search_skills (0)",
			"",
			"name: missing",
			"",
			"No matches",
		]);
		expect(identityCount(lines)).toBe(1);
	});
});

describe("search_skills unknown and missing payloads", () => {
	it("an error without a payload uses Tool execution failed, not model prose", () => {
		const lines = compose({
			isError: true,
			result: {
				content: [
					{
						type: "text",
						text: "error: skill index is not yet populated\nsuggestions: restart pi",
					},
				],
				details: {},
			},
		});
		expect(visible(lines)).toEqual(["search_skills · Tool execution failed"]);
		expect(identityCount(lines)).toBe(1);
		expect(visible(lines).join("\n")).not.toMatch(/error:/);
		expect(visible(lines).join("\n")).not.toMatch(/suggestions:/);
	});

	it("a malformed success payload uses Result details unavailable", () => {
		const malformed = {
			version: 1,
			tool: "search_skills",
			outcome: "success",
		} as unknown as TransportPayload;
		const lines = compose({
			payload: malformed,
			result: {
				content: [{ type: "text", text: "no matches" }],
				details: { payload: malformed },
			},
		});
		expect(visible(lines)).toEqual([
			"search_skills · Result details unavailable",
		]);
		expect(identityCount(lines)).toBe(1);
		expect(visible(lines).join("\n")).not.toMatch(/error:/);
	});
});

describe("search_skills execute hands the payload to the renderer", () => {
	it("settled compose after execute shows matched count without doubling identity", async () => {
		const entry = {
			storage: "global" as const,
			name: "git",
			id: "global:git",
			state: "active" as const,
			frontmatter: { name: "git" },
			filePath: "/skills/git/SKILL.md",
			baseDir: "/skills/git",
			description: "git",
		};
		const tool = makeTool({
			entries: [entry],
			conflicts: [],
			indexEmpty: false,
			filter: () => [entry],
		});
		const args = { frontmatter: { name: "git" } };
		const result = await tool.execute(
			"call-from-execute",
			args,
			undefined,
			undefined,
			{ cwd: "/tmp", isProjectTrusted: () => true },
		);
		const state = {};
		const context = {
			args,
			toolCallId: "call-from-execute",
			invalidate: () => undefined,
			lastComponent: undefined,
			state,
			cwd: "/tmp",
			executionStarted: true,
			argsComplete: true,
			isPartial: false,
			expanded: false,
			showImages: false,
			isError: false,
		};
		const composed = new Container();
		composed.addChild(asChild(tool.renderCall(args, theme, context)));
		composed.addChild(
			asChild(
				tool.renderResult(
					result,
					{ expanded: false },
					theme,
					context,
				),
			),
		);
		const lines = composed.render(80);
		expect(visible(lines)).toEqual([
			"search_skills · Ctrl+O to expand",
			"matched 1 skill",
		]);
		expect(identityCount(lines)).toBe(1);
	});
});

describe("search_skills recovers a thrown failure from the shared stash", () => {
	it("keeps INDEX_EMPTY after failEmptyIndex with wiped details and empty row state", () => {
		expect(() => failEmptyIndex("call-seam", "search_skills")).toThrow(
			/error:/,
		);
		const tool = makeTool();
		const args = { frontmatter: { name: "git" } };
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
			const context = {
				args,
				toolCallId: "call-seam",
				invalidate: () => undefined,
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
			composed.addChild(asChild(tool.renderCall(args, theme, context)));
			composed.addChild(
				asChild(
					tool.renderResult(wiped, { expanded: false }, theme, context),
				),
			);
			return { lines: composed.render(80), state };
		};
		const first = paint();
		expect(first.state.payload?.outcome).toBe("failure");
		expect(
			first.state.payload?.outcome === "failure"
				? first.state.payload.failure.code
				: undefined,
		).toBe("INDEX_EMPTY");
		expect(visible(first.lines)).toEqual([
			"search_skills · Tool execution failed",
		]);
		const second = paint();
		expect(
			second.state.payload?.outcome === "failure"
				? second.state.payload.failure.code
				: undefined,
		).toBe("INDEX_EMPTY");
		expect(visible(second.lines)).toEqual([
			"search_skills · Tool execution failed",
		]);
	});
});
