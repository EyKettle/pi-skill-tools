import { afterEach, describe, expect, it } from "vitest";
import { Box, Container, Text } from "../deps/pi-tui";
import { testTheme } from "../deps/pi-theme";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clear } from "../correlation";
import { definePeekSkill } from "../tools/peek-skill";
import type { ToolDeps } from "../tools/shared";
import { clearThrownFailures } from "../tools/shared";
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
	return definePeekSkill(
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

function visible(lines: string[]): string[] {
	return lines.map((line) => line.replace(SGR, "").trimEnd());
}

describe("peek_skill tool", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		clear();
		clearThrownFailures();
		for (const dir of tempDirs) {
			rmSync(dir, { recursive: true, force: true });
		}
		tempDirs.length = 0;
	});

	function makeSkill(name: string, content: string) {
		const dir = mkdtempSync(join(tmpdir(), `peek-test-${name}-`));
		tempDirs.push(dir);
		const skillDir = join(dir, name);
		mkdirSync(skillDir);
		const filePath = join(skillDir, "SKILL.md");
		writeFileSync(filePath, content, "utf8");
		return {
			storage: "global" as const,
			name,
			id: name,
			state: "active" as const,
			frontmatter: { name },
			filePath,
			baseDir: skillDir,
			description: "test skill",
		};
	}

	it("throws INDEX_EMPTY when registry is empty", async () => {
		const tool = defineTool(emptyRegistry());
		await expect(
			tool.execute("c1", { id: "git" }, undefined, undefined, {
				cwd: "/tmp",
				isProjectTrusted: () => true,
			}),
		).rejects.toThrow(/skill index is not yet populated/);
	});

	it("throws TOOL_REF_PATH_UNSUPPORTED when id carries a ref path", async () => {
		const entry = makeSkill("git", "# Git\n## When to Use\nUse for git.");
		const registry: Registry = {
			entries: [entry],
			conflicts: [],
			indexEmpty: false,
			filter: () => [entry],
		};
		const tool = defineTool(registry);
		await expect(
			tool.execute("c2", { id: "git/ref.md" }, undefined, undefined, {
				cwd: "/tmp",
				isProjectTrusted: () => true,
			}),
		).rejects.toThrow(/ref path/i);
	});

	it("throws ID_NOT_FOUND when skill does not exist", async () => {
		const entry = makeSkill("git", "# Git\n## When to Use\nUse for git.");
		const registry: Registry = {
			entries: [entry],
			conflicts: [],
			indexEmpty: false,
			filter: () => [entry],
		};
		const tool = defineTool(registry);
		await expect(
			tool.execute("c3", { id: "unknown" }, undefined, undefined, {
				cwd: "/tmp",
				isProjectTrusted: () => true,
			}),
		).rejects.toThrow(/no skill named/i);
	});

	it("throws SKILL_NO_WHEN_TO_USE when skill has no When to Use section", async () => {
		const entry = makeSkill("git", "# Git\n## Overview\nNo when to use.");
		const registry: Registry = {
			entries: [entry],
			conflicts: [],
			indexEmpty: false,
			filter: () => [entry],
		};
		const tool = defineTool(registry);
		await expect(
			tool.execute("c4", { id: "git" }, undefined, undefined, {
				cwd: "/tmp",
				isProjectTrusted: () => true,
			}),
		).rejects.toThrow(/does not contain a '## When to Use' section/);
	});

	it("extracts When to Use and returns wrapped model text with details", async () => {
		const markdown = [
			"---",
			"name: git",
			"description: git tool",
			"---",
			"# Git",
			"",
			"## When to Use",
			"- Use for commits",
			"- Don't use for PRs",
			"",
			"## Guidelines",
			"Some rules.",
		].join("\n");
		const entry = makeSkill("git", markdown);
		const registry: Registry = {
			entries: [entry],
			conflicts: [],
			indexEmpty: false,
			filter: () => [entry],
		};
		const tool = defineTool(registry);
		const result = await tool.execute("c5", { id: "git" }, undefined, undefined, {
			cwd: "/tmp",
			isProjectTrusted: () => true,
		});

		expect(result.content[0].text).toContain('<SKILL_PEEK name="git" location="');
		expect(result.content[0].text).toContain("## When to Use");
		expect(result.content[0].text).toContain("- Use for commits");
		expect(result.content[0].text).not.toContain("## Guidelines");

		expect(result.details.name).toBe("git");
		expect(result.details.lines).toBe(3);
		expect(result.details.payload).toBeDefined();

		// Test renderCall
		const renderedCall = tool.renderCall({ id: "git" }, theme, {
			isPartial: true,
		});
		expect(visible(renderedCall.render(80))).toEqual(["[Skill] git ..."]);

		// Test renderResult collapsed
		const renderedCollapsed = tool.renderResult(
			result,
			{ expanded: false, isPartial: false },
			theme,
			{
				args: { id: "git" },
				toolCallId: "c5",
				state: {},
				isError: false,
			},
		);
		expect(visible(renderedCollapsed.render(80))).toEqual([
			"[Skill] git · Ctrl+O to expand",
			"peeked When to Use (3 lines)",
		]);
	});
});
