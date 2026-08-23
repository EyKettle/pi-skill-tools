/**
 * Task 12 segments A–C — documented-state matrix, failure wording and
 * channel separation, then width/safety/rebuild/streaming, across all
 * six tools. Per-tool row tests lock local behaviour. This file locks
 * the same documented rows as a cross-tool table so a missing state is
 * a failed coverage assertion, not an omitted case. Evidence: real
 * pi-tui Text/Box/Container and a real Theme from the public class, call slot then result
 * slot (pi-tui-rendering-harness.md).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Box, Container, Text } from "../deps/pi-tui";
import { testTheme } from "../deps/pi-theme";
import { associate, claim, clear } from "../correlation";
import { createFailure, recoveryFor } from "../failure";
import type { Registry, RegistryEntry } from "../registry";
import { defineCreateSkill } from "../tools/create-skill";
import { defineListSkillFiles } from "../tools/list-skill-files";
import { defineListSkillTags } from "../tools/list-skill-tags";
import { defineListSkills } from "../tools/list-skills";
import { defineSearchSkills } from "../tools/search-skills";
import { defineViewSkill } from "../tools/view-skill";
import type { ToolDeps } from "../tools/shared";
import {
	paintProjectedRow,
	presentRow,
	projectRow,
	rebuildPresentation,
	visibleLength,
} from "../presentation";
import type { ProjectInput, SlotComponents } from "../presentation";
import type { TransportPayload } from "../transport";
import {
	buildCreateSkillPayload,
	buildFailurePayload,
	buildListSkillFilesPayload,
	buildListSkillTagsPayload,
	buildListSkillsPayload,
	buildSearchSkillsPayload,
	buildViewSkillPayload,
} from "../transport";

const theme = testTheme("dark");
const lightTheme = testTheme("light");

const SGR = /\x1b\[[0-9;]*m/g;
const REPLACEMENT = "\uFFFD";
const realComponents: SlotComponents = { Text, Container };

function keyHint(binding: string, fallback: string): string {
	if (binding !== "app.tools.expand") {
		throw new Error(`unexpected keybinding '${binding}'`);
	}
	return `Ctrl+O ${fallback}`;
}

const stubType: ToolDeps["Type"] = {
	Union: (schemas) => schemas,
	Literal: (value) => value,
	Object: (properties) => properties,
	Optional: (schema) => schema,
	Boolean: (desc) => desc ?? {},
	String: (desc) => desc ?? {},
	Record: (_key, value, desc) => desc ?? value,
	Unknown: (desc) => desc ?? {},
};

function unusedRegistry(): never {
	throw new Error("execute is not under test");
}

const sharedDeps: ToolDeps = {
	Type: stubType,
	Text: Text as ToolDeps["Text"],
	Box: Box as ToolDeps["Box"],
	Container: Container as ToolDeps["Container"],
	expandKeyHint: keyHint,
	registryDeps: unusedRegistry,
};

const listSkills = defineListSkills(sharedDeps);
const listTags = defineListSkillTags(sharedDeps);
const listFiles = defineListSkillFiles(sharedDeps);
const searchSkills = defineSearchSkills(sharedDeps);
const createSkill = defineCreateSkill(sharedDeps, {
	agentDir: "/tmp/agent",
	configDirName: ".pi",
});
const viewSkill = defineViewSkill(sharedDeps, {
	agentDir: "/tmp/agent",
	configDirName: ".pi",
});

type ToolKey =
	| "list_skills"
	| "list_skill_tags"
	| "list_skill_files"
	| "search_skills"
	| "create_skill"
	| "view_skill";

function toolOf(name: ToolKey) {
	switch (name) {
		case "list_skills":
			return listSkills;
		case "list_skill_tags":
			return listTags;
		case "list_skill_files":
			return listFiles;
		case "search_skills":
			return searchSkills;
		case "create_skill":
			return createSkill;
		case "view_skill":
			return viewSkill;
	}
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

function countVisible(lines: string[], snippet: string): number {
	return lines.join("\n").split(snippet).length - 1;
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

interface DocumentedState {
	id: string;
	tool: ToolKey;
	identity: string;
	args: Record<string, unknown>;
	pending?: boolean;
	expanded?: boolean;
	isError?: boolean;
	payload?: TransportPayload;
	expected: string[];
}

function compose(
	state: DocumentedState,
	width = 80,
	usedTheme: typeof theme = theme,
): string[] {
	const tool = toolOf(state.tool);
	const pending = state.pending === true;
	const expanded = state.expanded === true;
	const ctx = {
		args: state.args,
		toolCallId: `boundary-${state.id}`,
		invalidate: () => {},
		lastComponent: undefined,
		state: state.payload === undefined ? {} : { payload: state.payload },
		cwd: "/tmp",
		executionStarted: !pending,
		argsComplete: !pending,
		isPartial: pending,
		expanded,
		showImages: false,
		isError: state.isError === true,
	};
	const composed = new Container();
	composed.addChild(
		asChild(tool.renderCall(state.args as never, usedTheme, ctx as never)),
	);
	if (!pending) {
		composed.addChild(
			asChild(
				tool.renderResult(
					{
						content: [{ type: "text", text: "model unused" }],
						details: state.payload === undefined ? {} : { payload: state.payload },
					},
					{ expanded, isPartial: false },
					usedTheme,
					ctx as never,
				),
			),
		);
	}
	return composed.render(width);
}

function displayed(state: DocumentedState, raw: string[]): string[] {
	return state.tool === "view_skill" ? cardBody(raw) : visible(raw);
}

const gitSkill = { id: "git", filePath: "/skills/git/SKILL.md" };
const notesSkill = { id: "global:notes", filePath: "/skills/notes/SKILL.md" };
const createContent = "hello\n";
const createPayload = buildCreateSkillPayload(
	"notes",
	"/skills/notes/SKILL.md",
	createContent,
);
const viewPayload = buildViewSkillPayload(
	"git",
	"/skills/git/SKILL.md",
	"# Git\n",
);
const emptyCreatePayload = buildCreateSkillPayload(
	"notes",
	"/skills/notes/SKILL.md",
	"",
);
const emptyViewPayload = buildViewSkillPayload(
	"git",
	"/skills/git/SKILL.md",
	"",
);
const similarNotFound = buildFailurePayload(
	"view_skill",
	createFailure("ID_NOT_FOUND", {
		evidence: {
			kind: "candidates",
			candidates: [{ id: "notepad", path: "/skills/notepad/SKILL.md" }],
		},
	}),
);
const ambiguous = buildFailurePayload(
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

const DOCUMENTED: DocumentedState[] = [
	{
		id: "list_skills/pending",
		tool: "list_skills",
		identity: "list_skills",
		args: { location: "project" },
		pending: true,
		expected: ["list_skills"],
	},
	{
		id: "list_skills/collapsed",
		tool: "list_skills",
		identity: "list_skills",
		args: {},
		payload: buildListSkillsPayload(2, null, [gitSkill, notesSkill]),
		expected: ["list_skills · Ctrl+O to expand", "listed 2 skills"],
	},
	{
		id: "list_skills/collapsed+location",
		tool: "list_skills",
		identity: "list_skills",
		args: { location: "global" },
		payload: buildListSkillsPayload(2, "global", [gitSkill, notesSkill]),
		expected: ["list_skills · Ctrl+O to expand", "listed 2 skills in Global"],
	},
	{
		id: "list_skills/expanded",
		tool: "list_skills",
		identity: "list_skills",
		args: {},
		expanded: true,
		payload: buildListSkillsPayload(2, null, [gitSkill, notesSkill]),
		expected: [
			"list_skills (2)",
			"",
			"- git /skills/git/SKILL.md",
			"- global:notes /skills/notes/SKILL.md",
		],
	},
	{
		id: "list_skills/expanded+location",
		tool: "list_skills",
		identity: "list_skills",
		args: { location: "global" },
		expanded: true,
		payload: buildListSkillsPayload(2, "global", [gitSkill, notesSkill]),
		expected: [
			"list_skills (2 in Global)",
			"",
			"- git /skills/git/SKILL.md",
			"- global:notes /skills/notes/SKILL.md",
		],
	},
	{
		id: "list_skills/empty",
		tool: "list_skills",
		identity: "list_skills",
		args: {},
		payload: buildListSkillsPayload(0, null, []),
		expected: ["list_skills · Ctrl+O to expand", "listed 0 skills"],
	},
	{
		id: "list_skills/empty/expanded",
		tool: "list_skills",
		identity: "list_skills",
		args: {},
		expanded: true,
		payload: buildListSkillsPayload(0, null, []),
		expected: ["list_skills (0)", "", "No skills found"],
	},
	{
		id: "list_skill_tags/pending",
		tool: "list_skill_tags",
		identity: "list_skill_tags",
		args: {},
		pending: true,
		expected: ["list_skill_tags"],
	},
	{
		id: "list_skill_tags/collapsed",
		tool: "list_skill_tags",
		identity: "list_skill_tags",
		args: {},
		payload: buildListSkillTagsPayload(2, null, ["cli", "git"]),
		expected: ["list_skill_tags · Ctrl+O to expand", "listed 2 skill tags"],
	},
	{
		id: "list_skill_tags/collapsed+location",
		tool: "list_skill_tags",
		identity: "list_skill_tags",
		args: { location: "project" },
		payload: buildListSkillTagsPayload(2, "project", ["cli", "git"]),
		expected: [
			"list_skill_tags · Ctrl+O to expand",
			"listed 2 skill tags in Project",
		],
	},
	{
		id: "list_skill_tags/expanded",
		tool: "list_skill_tags",
		identity: "list_skill_tags",
		args: {},
		expanded: true,
		payload: buildListSkillTagsPayload(2, null, ["cli", "git"]),
		expected: ["list_skill_tags (2)", "", "cli, git"],
	},
	{
		id: "list_skill_tags/expanded+location",
		tool: "list_skill_tags",
		identity: "list_skill_tags",
		args: { location: "project" },
		expanded: true,
		payload: buildListSkillTagsPayload(2, "project", ["cli", "git"]),
		expected: ["list_skill_tags (2 in Project)", "", "cli, git"],
	},
	{
		id: "list_skill_tags/empty",
		tool: "list_skill_tags",
		identity: "list_skill_tags",
		args: {},
		payload: buildListSkillTagsPayload(0, null, []),
		expected: ["list_skill_tags · Ctrl+O to expand", "listed 0 skill tags"],
	},
	{
		id: "list_skill_tags/empty/expanded",
		tool: "list_skill_tags",
		identity: "list_skill_tags",
		args: {},
		expanded: true,
		payload: buildListSkillTagsPayload(0, null, []),
		expected: ["list_skill_tags (0)", "", "No tags found"],
	},
	{
		id: "list_skill_files/pending",
		tool: "list_skill_files",
		identity: "[Skill]",
		args: { id: "git" },
		pending: true,
		expected: ["[Skill] git"],
	},
	{
		id: "list_skill_files/collapsed",
		tool: "list_skill_files",
		identity: "[Skill]",
		args: { id: "git" },
		payload: buildListSkillFilesPayload(1, "git", [
			{ refId: "references/a.md", path: "/skills/git/references/a.md" },
		]),
		expected: ["[Skill] git · Ctrl+O to expand", "listed 1 related file"],
	},
	{
		id: "list_skill_files/expanded",
		tool: "list_skill_files",
		identity: "[Skill]",
		args: { id: "git" },
		expanded: true,
		payload: buildListSkillFilesPayload(1, "git", [
			{ refId: "references/a.md", path: "/skills/git/references/a.md" },
		]),
		expected: [
			"[Skill] git (1)",
			"",
			"- references/a.md /skills/git/references/a.md",
		],
	},
	{
		id: "list_skill_files/empty",
		tool: "list_skill_files",
		identity: "[Skill]",
		args: { id: "git" },
		payload: buildListSkillFilesPayload(0, "git", []),
		expected: ["[Skill] git · Ctrl+O to expand", "listed 0 related files"],
	},
	{
		id: "list_skill_files/empty/expanded",
		tool: "list_skill_files",
		identity: "[Skill]",
		args: { id: "git" },
		expanded: true,
		payload: buildListSkillFilesPayload(0, "git", []),
		expected: ["[Skill] git (0)", "", "No related files"],
	},
	{
		id: "search_skills/pending",
		tool: "search_skills",
		identity: "search_skills",
		args: { frontmatter: { name: "git" } },
		pending: true,
		expected: ["search_skills"],
	},
	{
		id: "search_skills/collapsed",
		tool: "search_skills",
		identity: "search_skills",
		args: { frontmatter: { name: "git" } },
		payload: buildSearchSkillsPayload(1, null, { name: "git" }, [gitSkill]),
		expected: ["search_skills · Ctrl+O to expand", "matched 1 skill"],
	},
	{
		id: "search_skills/collapsed+location",
		tool: "search_skills",
		identity: "search_skills",
		args: { frontmatter: { name: "git" }, location: "package" },
		payload: buildSearchSkillsPayload(2, "package", { name: "git" }, [
			gitSkill,
			{ id: "s1", filePath: "/skills/s1/SKILL.md" },
		]),
		expected: ["search_skills · Ctrl+O to expand", "matched 2 skills in Package"],
	},
	{
		id: "search_skills/expanded",
		tool: "search_skills",
		identity: "search_skills",
		args: { frontmatter: { name: "git" } },
		expanded: true,
		payload: buildSearchSkillsPayload(1, null, { name: "git" }, [gitSkill]),
		expected: [
			"search_skills (1)",
			"",
			"name: git",
			"",
			"- git /skills/git/SKILL.md",
		],
	},
	{
		id: "search_skills/expanded+location",
		tool: "search_skills",
		identity: "search_skills",
		args: { frontmatter: { name: "git" }, location: "package" },
		expanded: true,
		payload: buildSearchSkillsPayload(2, "package", { name: "git" }, [
			gitSkill,
			{ id: "s1", filePath: "/skills/s1/SKILL.md" },
		]),
		expected: [
			"search_skills (2 in Package)",
			"",
			"name: git",
			"",
			"- git /skills/git/SKILL.md",
			"- s1 /skills/s1/SKILL.md",
		],
	},
	{
		id: "search_skills/empty",
		tool: "search_skills",
		identity: "search_skills",
		args: { frontmatter: { name: "missing" } },
		payload: buildSearchSkillsPayload(0, null, { name: "missing" }, []),
		expected: ["search_skills · Ctrl+O to expand", "matched 0 skills"],
	},
	{
		id: "search_skills/empty/expanded",
		tool: "search_skills",
		identity: "search_skills",
		args: { frontmatter: { name: "missing" } },
		expanded: true,
		payload: buildSearchSkillsPayload(0, null, { name: "missing" }, []),
		expected: ["search_skills (0)", "", "name: missing", "", "No matches"],
	},
	{
		id: "create_skill/pending",
		tool: "create_skill",
		identity: "[NewSkill]",
		args: { id: "notes", content: "abcd" },
		pending: true,
		expected: ["[NewSkill] notes (1 line · 4 B)"],
	},
	{
		id: "create_skill/collapsed",
		tool: "create_skill",
		identity: "[NewSkill]",
		args: { id: "notes", content: createContent },
		payload: createPayload,
		expected: ["[NewSkill] notes", "Wrote 1 line (6B) · Ctrl+O to expand"],
	},
	{
		id: "create_skill/expanded",
		tool: "create_skill",
		identity: "[NewSkill]",
		args: { id: "notes", content: createContent },
		expanded: true,
		payload: createPayload,
		expected: [
			"[NewSkill] notes (/skills/notes/SKILL.md)",
			"",
			"hello",
			"",
			"1 line (6B) in total",
		],
	},
	{
		id: "create_skill/empty",
		tool: "create_skill",
		identity: "[NewSkill]",
		args: { id: "notes", content: "" },
		payload: emptyCreatePayload,
		expected: ["[NewSkill] notes", "Wrote 0 lines (0B) · Ctrl+O to expand"],
	},
	{
		id: "create_skill/empty/expanded",
		tool: "create_skill",
		identity: "[NewSkill]",
		args: { id: "notes", content: "" },
		expanded: true,
		payload: emptyCreatePayload,
		expected: [
			"[NewSkill] notes (/skills/notes/SKILL.md)",
			"",
			"(empty file)",
			"",
			"0 lines (0B) in total",
		],
	},
	{
		id: "create_skill/already-exists-name",
		tool: "create_skill",
		identity: "create_skill",
		args: { id: "notes" },
		isError: true,
		payload: buildFailurePayload(
			"create_skill",
			createFailure("CREATE_NAME_EXISTS"),
		),
		expected: ["create_skill · notes already exists"],
	},
	{
		id: "create_skill/already-exists-target",
		tool: "create_skill",
		identity: "create_skill",
		args: { id: "notes" },
		isError: true,
		payload: buildFailurePayload(
			"create_skill",
			createFailure("CREATE_TARGET_EXISTS"),
		),
		expected: ["create_skill · notes already exists"],
	},
	{
		id: "view_skill/pending",
		tool: "view_skill",
		identity: "[Skill]",
		args: { id: "git" },
		pending: true,
		expected: ["[Skill] git"],
	},
	{
		id: "view_skill/pending-unknown-id",
		tool: "view_skill",
		identity: "view_skill",
		args: {},
		pending: true,
		expected: ["view_skill"],
	},
	{
		id: "view_skill/collapsed",
		tool: "view_skill",
		identity: "[Skill]",
		args: { id: "git" },
		payload: viewPayload,
		expected: ["[Skill] git · Ctrl+O to expand"],
	},
	{
		id: "view_skill/expanded",
		tool: "view_skill",
		identity: "[Skill]",
		args: { id: "git" },
		expanded: true,
		payload: viewPayload,
		expected: ["[Skill] git (/skills/git/SKILL.md)", "", "# Git"],
	},
	{
		id: "view_skill/empty",
		tool: "view_skill",
		identity: "[Skill]",
		args: { id: "git" },
		payload: emptyViewPayload,
		expected: ["[Skill] git · Ctrl+O to expand"],
	},
	{
		id: "view_skill/empty/expanded",
		tool: "view_skill",
		identity: "[Skill]",
		args: { id: "git" },
		expanded: true,
		payload: emptyViewPayload,
		expected: ["[Skill] git (/skills/git/SKILL.md)", "", "(empty file)"],
	},
	{
		id: "view_skill/not-found",
		tool: "view_skill",
		identity: "[Skill]",
		args: { id: "missing" },
		isError: true,
		payload: buildFailurePayload("view_skill", createFailure("ID_NOT_FOUND")),
		expected: ["[Skill] missing not found"],
	},
	{
		id: "view_skill/not-found-similar/collapsed",
		tool: "view_skill",
		identity: "[Skill]",
		args: { id: "note" },
		isError: true,
		payload: similarNotFound,
		expected: [
			"[Skill] note not found",
			"Found 1 similar skill · Ctrl+O to show",
		],
	},
	{
		id: "view_skill/not-found-similar/expanded",
		tool: "view_skill",
		identity: "[Skill]",
		args: { id: "note" },
		expanded: true,
		isError: true,
		payload: similarNotFound,
		expected: [
			"[Skill] note not found",
			"",
			"1 similar skill:",
			"",
			"- notepad /skills/notepad/SKILL.md",
		],
	},
	{
		id: "view_skill/ambiguous/collapsed",
		tool: "view_skill",
		identity: "[Skill]",
		args: { id: "github" },
		isError: true,
		payload: ambiguous,
		expected: [
			"[Skill] github is ambiguous",
			"2 same skills in different position · Ctrl+O to show",
		],
	},
	{
		id: "view_skill/ambiguous/expanded",
		tool: "view_skill",
		identity: "[Skill]",
		args: { id: "github" },
		expanded: true,
		isError: true,
		payload: ambiguous,
		expected: [
			"[Skill] github is ambiguous",
			"",
			"There's 2 versions:",
			"",
			"- global:github /g/github/SKILL.md",
			"- project:github /p/github/SKILL.md",
		],
	},
];

const byId: Record<string, DocumentedState> = Object.fromEntries(
	DOCUMENTED.map((row) => [row.id, row]),
);

interface ExpansionPair {
	id: string;
	collapsed: string;
	expanded: string;
	extra: string[];
	gone: string[];
}

const EXPANSION: ExpansionPair[] = [
	{
		id: "list_skills",
		collapsed: "list_skills/collapsed",
		expanded: "list_skills/expanded",
		extra: [
			"- git /skills/git/SKILL.md",
			"- global:notes /skills/notes/SKILL.md",
		],
		gone: ["to expand", "listed 2 skills"],
	},
	{
		id: "list_skills+location",
		collapsed: "list_skills/collapsed+location",
		expanded: "list_skills/expanded+location",
		extra: [
			"- git /skills/git/SKILL.md",
			"- global:notes /skills/notes/SKILL.md",
		],
		gone: ["to expand", "listed 2 skills in Global"],
	},
	{
		id: "list_skill_tags",
		collapsed: "list_skill_tags/collapsed",
		expanded: "list_skill_tags/expanded",
		extra: ["cli, git"],
		gone: ["to expand", "listed 2 skill tags"],
	},
	{
		id: "list_skill_tags+location",
		collapsed: "list_skill_tags/collapsed+location",
		expanded: "list_skill_tags/expanded+location",
		extra: ["cli, git"],
		gone: ["to expand", "listed 2 skill tags in Project"],
	},
	{
		id: "list_skill_files",
		collapsed: "list_skill_files/collapsed",
		expanded: "list_skill_files/expanded",
		extra: ["- references/a.md /skills/git/references/a.md"],
		gone: ["to expand", "listed 1 related file"],
	},
	{
		id: "search_skills",
		collapsed: "search_skills/collapsed",
		expanded: "search_skills/expanded",
		extra: ["name: git", "- git /skills/git/SKILL.md"],
		gone: ["to expand", "matched 1 skill"],
	},
	{
		id: "search_skills+location",
		collapsed: "search_skills/collapsed+location",
		expanded: "search_skills/expanded+location",
		extra: [
			"name: git",
			"- git /skills/git/SKILL.md",
			"- s1 /skills/s1/SKILL.md",
		],
		gone: ["to expand", "matched 2 skills in Package"],
	},
	{
		id: "search_skills/empty",
		collapsed: "search_skills/empty",
		expanded: "search_skills/empty/expanded",
		extra: ["name: missing", "No matches"],
		gone: ["to expand", "matched 0 skills"],
	},
	{
		id: "list_skills/empty",
		collapsed: "list_skills/empty",
		expanded: "list_skills/empty/expanded",
		extra: ["No skills found"],
		gone: ["to expand", "listed 0 skills"],
	},
	{
		id: "list_skill_tags/empty",
		collapsed: "list_skill_tags/empty",
		expanded: "list_skill_tags/empty/expanded",
		extra: ["No tags found"],
		gone: ["to expand", "listed 0 skill tags"],
	},
	{
		id: "list_skill_files/empty",
		collapsed: "list_skill_files/empty",
		expanded: "list_skill_files/empty/expanded",
		extra: ["No related files"],
		gone: ["to expand", "listed 0 related files"],
	},
	{
		id: "create_skill",
		collapsed: "create_skill/collapsed",
		expanded: "create_skill/expanded",
		extra: ["/skills/notes/SKILL.md", "hello", "in total"],
		gone: ["Wrote", "to expand"],
	},
	{
		id: "create_skill/empty",
		collapsed: "create_skill/empty",
		expanded: "create_skill/empty/expanded",
		extra: ["/skills/notes/SKILL.md", "(empty file)", "in total"],
		gone: ["Wrote", "to expand"],
	},
	{
		id: "view_skill",
		collapsed: "view_skill/collapsed",
		expanded: "view_skill/expanded",
		extra: ["/skills/git/SKILL.md", "# Git"],
		gone: ["to expand"],
	},
	{
		id: "view_skill/empty",
		collapsed: "view_skill/empty",
		expanded: "view_skill/empty/expanded",
		extra: ["/skills/git/SKILL.md", "(empty file)"],
		gone: ["to expand"],
	},
	{
		id: "view_skill/not-found-similar",
		collapsed: "view_skill/not-found-similar/collapsed",
		expanded: "view_skill/not-found-similar/expanded",
		extra: ["1 similar skill:", "- notepad /skills/notepad/SKILL.md"],
		gone: ["to show", "Found 1 similar skill"],
	},
	{
		id: "view_skill/ambiguous",
		collapsed: "view_skill/ambiguous/collapsed",
		expanded: "view_skill/ambiguous/expanded",
		extra: [
			"There's 2 versions:",
			"- global:github /g/github/SKILL.md",
			"- project:github /p/github/SKILL.md",
		],
		gone: ["to show", "same skills in different position"],
	},
];

const ALL_TOOLS: ToolKey[] = [
	"list_skills",
	"list_skill_tags",
	"list_skill_files",
	"search_skills",
	"create_skill",
	"view_skill",
];

const LOCATION_TOOLS: ToolKey[] = [
	"list_skills",
	"list_skill_tags",
	"search_skills",
];

describe("documented-state matrix", () => {
	it("has pending, collapsed, and expanded cells for every tool", () => {
		for (const tool of ALL_TOOLS) {
			for (const phase of ["pending", "collapsed", "expanded"] as const) {
				expect(
					DOCUMENTED.some(
						(row) => row.tool === tool && row.id.includes(`/${phase}`),
					),
					`${tool}/${phase} missing from the matrix`,
				).toBe(true);
			}
		}
	});

	it("has an expanded cell for every empty state", () => {
		const emptyCollapsed = DOCUMENTED.filter(
			(row) => row.id.endsWith("/empty") && row.expanded !== true,
		);
		expect(emptyCollapsed.map((row) => row.id).sort()).toEqual(
			[
				"create_skill/empty",
				"list_skill_files/empty",
				"list_skill_tags/empty",
				"list_skills/empty",
				"search_skills/empty",
				"view_skill/empty",
			].sort(),
		);
		for (const row of emptyCollapsed) {
			expect(
				DOCUMENTED.some((entry) => entry.id === `${row.id}/expanded`),
				`${row.id}/expanded missing from the matrix`,
			).toBe(true);
		}
	});

	it("has with-location and without-location cells for every location-aware tool", () => {
		for (const tool of LOCATION_TOOLS) {
			expect(
				DOCUMENTED.some((row) => row.id === `${tool}/collapsed`),
				`${tool}/collapsed (no location) missing`,
			).toBe(true);
			expect(
				DOCUMENTED.some((row) => row.id === `${tool}/expanded`),
				`${tool}/expanded (no location) missing`,
			).toBe(true);
			expect(
				DOCUMENTED.some((row) => row.id === `${tool}/collapsed+location`),
				`${tool}/collapsed+location missing`,
			).toBe(true);
			expect(
				DOCUMENTED.some((row) => row.id === `${tool}/expanded+location`),
				`${tool}/expanded+location missing`,
			).toBe(true);
		}
	});

	it("covers CREATE_TARGET_EXISTS on the same already-exists path as CREATE_NAME_EXISTS", () => {
		expect(byId["create_skill/already-exists-name"]?.expected).toEqual([
			"create_skill · notes already exists",
		]);
		expect(byId["create_skill/already-exists-target"]?.expected).toEqual([
			"create_skill · notes already exists",
		]);
	});

	it.each(DOCUMENTED)("$id matches the design on a composed row", (state) => {
		const raw = compose(state);
		const lines = displayed(state, raw);
		expect(lines).toEqual(state.expected);
		expect(countVisible(lines, state.identity)).toBe(1);
	});
});

describe("expand affordance matches whether expansion reveals more", () => {
	const AFFORDANCE = /\bto (expand|show)\b/;

	function rowText(row: {
		call: readonly { text: string }[];
		result: readonly { text: string }[];
	}): string {
		return [...row.call, ...row.result].map((line) => line.text).join("\n");
	}

	const settled = DOCUMENTED.filter(
		(row) => row.pending !== true && row.expanded !== true,
	);

	it.each(settled)(
		"$id: affordance present iff the expanded row differs",
		(state) => {
			const collapsed = projectRow({
				tool: state.tool,
				phase: "collapsed",
				payload: state.payload,
				args: state.args,
				keyHint,
			});
			const expanded = projectRow({
				tool: state.tool,
				phase: "expanded",
				payload: state.payload,
				args: state.args,
				keyHint,
			});
			const collapsedText = rowText(collapsed);
			const expandedText = rowText(expanded);
			const revealsMore = collapsedText !== expandedText;
			const hasAffordance = AFFORDANCE.test(collapsedText);
			expect(hasAffordance, `${state.id} affordance`).toBe(revealsMore);
		},
	);
});

describe("expansion adds only what the design shows", () => {
	it.each(EXPANSION)("$id", (pair) => {
		const collapsedState = byId[pair.collapsed];
		const expandedState = byId[pair.expanded];
		expect(collapsedState, pair.collapsed).toBeDefined();
		expect(expandedState, pair.expanded).toBeDefined();
		const collapsed = displayed(collapsedState, compose(collapsedState)).join(
			"\n",
		);
		const expanded = displayed(expandedState, compose(expandedState)).join("\n");
		for (const snippet of pair.extra) {
			expect(expanded, `expanded missing ${snippet}`).toContain(snippet);
			expect(collapsed, `collapsed leaked ${snippet}`).not.toContain(snippet);
		}
		for (const snippet of pair.gone) {
			expect(collapsed, `collapsed missing ${snippet}`).toContain(snippet);
			expect(expanded, `expanded kept ${snippet}`).not.toContain(snippet);
		}
		expect(countVisible(collapsed.split("\n"), collapsedState.identity)).toBe(1);
		expect(countVisible(expanded.split("\n"), expandedState.identity)).toBe(1);
	});
});

interface PaintOpts {
	tool: ToolKey;
	args?: Record<string, unknown>;
	toolCallId?: string;
	state?: Record<string, unknown>;
	isError?: boolean;
	isPartial?: boolean;
	details?: Record<string, unknown>;
	content?: string;
	expanded?: boolean;
	pending?: boolean;
	instance?: ReturnType<typeof defineListSkills>;
	width?: number;
	theme?: typeof theme;
}

function defaultArgs(tool: ToolKey): Record<string, unknown> {
	switch (tool) {
		case "list_skill_files":
		case "view_skill":
			return { id: "git" };
		case "create_skill":
			return { id: "notes", content: "x" };
		case "search_skills":
			return { frontmatter: { name: "git" } };
		default:
			return {};
	}
}

function malformedSuccess(tool: ToolKey): Record<string, unknown> {
	return { version: 1, tool, outcome: "success" };
}

function paint(opts: PaintOpts): {
	raw: string[];
	lines: string[];
	state: Record<string, unknown>;
} {
	const tool = opts.instance ?? toolOf(opts.tool);
	const args = opts.args ?? defaultArgs(opts.tool);
	const state = opts.state ?? {};
	const pending = opts.pending === true;
	const isPartial = opts.isPartial === true || pending;
	const ctx = {
		args,
		toolCallId: opts.toolCallId ?? `boundary-b-${opts.tool}`,
		invalidate: () => {},
		lastComponent: undefined,
		state,
		cwd: "/tmp",
		executionStarted: !pending,
		argsComplete: !pending,
		isPartial,
		expanded: opts.expanded === true,
		showImages: false,
		isError: opts.isError === true,
	};
	const usedTheme = opts.theme ?? theme;
	const composed = new Container();
	composed.addChild(
		asChild(tool.renderCall(args as never, usedTheme, ctx as never)),
	);
	if (!pending) {
		composed.addChild(
			asChild(
				tool.renderResult(
					{
						content: [{ type: "text", text: opts.content ?? "model unused" }],
						details: opts.details ?? {},
					},
					{ expanded: opts.expanded === true, isPartial },
					usedTheme,
					ctx as never,
				),
			),
		);
	}
	const raw = composed.render(opts.width ?? 80);
	const lines = opts.tool === "view_skill" ? cardBody(raw) : visible(raw);
	return { raw, lines, state };
}

function hasBg(
	lines: string[],
	role: "customMessageBg" | "toolErrorBg",
): boolean {
	const sample = theme.bg(role, " ");
	const open = sample.slice(0, sample.indexOf(" ") + 1);
	return lines.some((line) => line.includes(open));
}

function assertNoChannelLeak(text: string): void {
	expect(text).not.toMatch(/error:/);
	expect(text).not.toMatch(/suggestions:/);
	expect(text).not.toContain("recovery:");
	expect(text).not.toContain("ENTRY_UNREACHABLE");
	expect(text).not.toContain("CREATE_NAME_EXISTS");
	expect(text).not.toContain("ID_NOT_FOUND");
	expect(text).not.toContain(recoveryFor("ENTRY_UNREACHABLE"));
	expect(text).not.toContain(recoveryFor("CREATE_NAME_EXISTS"));
	expect(text).not.toContain(MODEL_BOOM);
	expect(text).not.toContain(MODEL_HINT);
}

const MODEL_BOOM = "UNIQUE_MODEL_BOOM_9f3c";
const MODEL_HINT = "UNIQUE_MODEL_HINT_9f3c";
const MODEL_TEXT = `error: ${MODEL_BOOM}\nsuggestions: ${MODEL_HINT}`;

function notesEntry(): RegistryEntry {
	return {
		storage: "global",
		name: "notes",
		id: "global:notes",
		state: "active",
		frontmatter: {},
		filePath: "/tmp/notes/SKILL.md",
		baseDir: "/tmp/notes",
		description: "notes",
	};
}

function gitEntry(): RegistryEntry {
	return {
		storage: "global",
		name: "git",
		id: "git",
		state: "active",
		frontmatter: {},
		filePath: "/skills/git/SKILL.md",
		baseDir: "/skills/git",
		description: "git",
	};
}

function registryOf(entries: RegistryEntry[]): Registry {
	return {
		entries,
		conflicts: [],
		indexEmpty: false,
		filter(location) {
			return location === undefined
				? entries
				: entries.filter((entry) => entry.storage === location);
		},
	};
}

function createToolWith(entries: RegistryEntry[]) {
	return defineCreateSkill(
		{
			...sharedDeps,
			registryDeps: () => registryOf(entries),
			withFileMutationQueue: async (_path, fn) => fn(),
		},
		{ agentDir: "/tmp/agent", configDirName: ".pi" },
	);
}

function viewToolWith(entries: RegistryEntry[]) {
	return defineViewSkill(
		{
			...sharedDeps,
			registryDeps: () => registryOf(entries),
		},
		{ agentDir: "/tmp/agent", configDirName: ".pi" },
	);
}

const execCtx = { cwd: "/tmp", isProjectTrusted: () => true };

describe("failure wording pairing", () => {
	it("covers unknown-error and malformed-success cells for every tool", () => {
		for (const tool of ALL_TOOLS) {
			expect(tool, `${tool} missing from ALL_TOOLS`).toBeTruthy();
		}
		expect(ALL_TOOLS).toHaveLength(6);
	});

	it.each(ALL_TOOLS)(
		"$tool isError with empty details paints Tool execution failed",
		(tool) => {
			const { raw, lines } = paint({
				tool,
				isError: true,
				details: {},
				content: MODEL_TEXT,
				toolCallId: `boundary-b-failed-${tool}`,
			});
			expect(lines).toEqual([`${tool} · Tool execution failed`]);
			expect(countVisible(lines, tool)).toBe(1);
			expect(lines.join("\n")).not.toContain("unavailable");
			expect(lines.join("\n")).not.toContain("to expand");
			expect(raw.join("\n")).toContain(theme.fg("error", "Tool execution failed"));
			if (tool === "view_skill") {
				expect(hasBg(raw, "toolErrorBg")).toBe(true);
				expect(hasBg(raw, "customMessageBg")).toBe(false);
			}
			assertNoChannelLeak(lines.join("\n"));
		},
	);

	it.each(ALL_TOOLS)(
		"$tool malformed success paints Result details unavailable on the success shell",
		(tool) => {
			const malformed = malformedSuccess(tool);
			const { raw, lines } = paint({
				tool,
				isError: false,
				details: { payload: malformed },
				state: { payload: malformed },
				content: MODEL_TEXT,
				toolCallId: `boundary-b-malformed-${tool}`,
			});
			expect(lines).toEqual([`${tool} · Result details unavailable`]);
			expect(countVisible(lines, tool)).toBe(1);
			expect(lines.join("\n")).not.toContain("Tool execution failed");
			expect(lines.join("\n")).not.toContain("to expand");
			expect(raw.join("\n")).not.toContain(
				theme.fg("error", "Result details unavailable"),
			);
			expect(raw.join("\n")).toContain(
				theme.fg("toolOutput", "Result details unavailable"),
			);
			if (tool === "view_skill") {
				expect(hasBg(raw, "customMessageBg")).toBe(true);
				expect(hasBg(raw, "toolErrorBg")).toBe(false);
			}
			assertNoChannelLeak(lines.join("\n"));
		},
	);

	it.each(ALL_TOOLS)(
		"$tool missing success details paints Result details unavailable, not model prose",
		(tool) => {
			const { lines } = paint({
				tool,
				isError: false,
				details: {},
				content: MODEL_TEXT,
				toolCallId: `boundary-b-missing-${tool}`,
			});
			expect(lines.join("\n")).toContain(`${tool} · Result details unavailable`);
			expect(lines.join("\n")).not.toContain("Tool execution failed");
			assertNoChannelLeak(lines.join("\n"));
		},
	);
});

describe("synthesized unknown-failure persists across a redraw", () => {
	it.each(ALL_TOOLS)(
		"$tool second paint with wiped details still shows Tool execution failed",
		(tool) => {
			const state: Record<string, unknown> = {};
			const callId = `boundary-b-redraw-${tool}`;
			const first = paint({
				tool,
				isError: true,
				details: {},
				content: MODEL_TEXT,
				state,
				toolCallId: callId,
			});
			expect(first.lines).toEqual([`${tool} · Tool execution failed`]);
			const second = paint({
				tool,
				isError: true,
				details: {},
				content: "",
				state,
				toolCallId: callId,
			});
			expect(second.lines).toEqual([`${tool} · Tool execution failed`]);
			expect(second.lines.join("\n")).not.toContain("unavailable");
			assertNoChannelLeak(second.lines.join("\n"));
		},
	);
});

describe("channel separation", () => {
	it("a known-failure payload never paints its code, recovery, or model text", () => {
		const payload = buildFailurePayload(
			"create_skill",
			createFailure("CREATE_NAME_EXISTS"),
		);
		const { lines } = paint({
			tool: "create_skill",
			isError: true,
			details: { payload },
			state: { payload },
			content: MODEL_TEXT,
			args: { id: "notes" },
			toolCallId: "boundary-b-channel-known",
		});
		expect(lines).toEqual(["create_skill · notes already exists"]);
		assertNoChannelLeak(lines.join("\n"));
	});

	it("create_skill execute keeps error:/suggestions: on the thrown message and off the display", async () => {
		const tool = createToolWith([notesEntry()]);
		const callId = "boundary-b-channel-execute";
		let thrown = "";
		try {
			await tool.execute(
				callId,
				{ id: "notes", content: "x" },
				undefined,
				undefined,
				execCtx,
			);
		} catch (err) {
			thrown = err instanceof Error ? err.message : String(err);
		}
		expect(thrown).toMatch(/^error:/);
		expect(thrown).toMatch(/suggestions:/);
		const { lines } = paint({
			tool: "create_skill",
			instance: tool as never,
			isError: true,
			details: {},
			content: thrown,
			args: { id: "notes" },
			toolCallId: callId,
		});
		expect(lines).toEqual(["create_skill · notes already exists"]);
		expect(lines.join("\n")).not.toMatch(/error:/);
		expect(lines.join("\n")).not.toMatch(/suggestions:/);
		expect(lines.join("\n")).not.toContain("CREATE_NAME_EXISTS");
		expect(lines.join("\n")).not.toContain(recoveryFor("CREATE_NAME_EXISTS"));
	});
});

describe("call-boundary isolation and pending cleanup", () => {
	beforeEach(() => {
		clear();
	});

	it("a create_skill known failure on call A is unreachable from call B", async () => {
		const tool = createToolWith([notesEntry()]);
		await expect(
			tool.execute(
				"boundary-b-iso-a",
				{ id: "notes", content: "x" },
				undefined,
				undefined,
				execCtx,
			),
		).rejects.toThrow(/error:/);
		const other = paint({
			tool: "create_skill",
			instance: tool as never,
			isError: true,
			details: {},
			content: MODEL_TEXT,
			args: { id: "notes" },
			toolCallId: "boundary-b-iso-b",
		});
		expect(other.lines).toEqual(["create_skill · Tool execution failed"]);
		expect(other.lines.join("\n")).not.toContain("already exists");
		const own = paint({
			tool: "create_skill",
			instance: tool as never,
			isError: true,
			details: {},
			content: MODEL_TEXT,
			args: { id: "notes" },
			toolCallId: "boundary-b-iso-a",
		});
		expect(own.lines).toEqual(["create_skill · notes already exists"]);
	});

	it("a create_skill known failure is unreachable from view_skill with the same call id", async () => {
		const created = createToolWith([notesEntry()]);
		const callId = "boundary-b-iso-cross-tool";
		await expect(
			created.execute(
				callId,
				{ id: "notes", content: "x" },
				undefined,
				undefined,
				execCtx,
			),
		).rejects.toThrow(/error:/);
		const { lines } = paint({
			tool: "view_skill",
			isError: true,
			details: {},
			content: MODEL_TEXT,
			args: { id: "git" },
			toolCallId: callId,
		});
		expect(lines).toEqual(["view_skill · Tool execution failed"]);
		expect(lines.join("\n")).not.toContain("already exists");
	});

	it("view_skill throw-then-rebuild with wiped details keeps not-found", async () => {
		const tool = viewToolWith([gitEntry()]);
		const callId = "boundary-b-view-throw";
		const state: Record<string, unknown> = {};
		await expect(
			tool.execute(callId, { id: "missing" }, undefined, undefined, execCtx),
		).rejects.toThrow(/error:/);
		const first = paint({
			tool: "view_skill",
			instance: tool as never,
			isError: true,
			details: {},
			content: MODEL_TEXT,
			args: { id: "missing" },
			state,
			toolCallId: callId,
		});
		expect(first.lines).toEqual(["[Skill] missing not found"]);
		const second = paint({
			tool: "view_skill",
			instance: tool as never,
			isError: true,
			details: {},
			content: "",
			args: { id: "missing" },
			state,
			toolCallId: callId,
		});
		expect(second.lines).toEqual(["[Skill] missing not found"]);
		assertNoChannelLeak(second.lines.join("\n"));
	});

	it("a Channel B pending update does not consume the create_skill throw stash", async () => {
		const tool = createToolWith([notesEntry()]);
		const callId = "boundary-b-pending-stash";
		const state: Record<string, unknown> = {};
		await expect(
			tool.execute(
				callId,
				{ id: "notes", content: "x" },
				undefined,
				undefined,
				execCtx,
			),
		).rejects.toThrow(/error:/);
		const pending = paint({
			tool: "create_skill",
			instance: tool as never,
			isError: true,
			isPartial: true,
			details: {},
			content: MODEL_TEXT,
			args: { id: "notes", content: "x" },
			state,
			toolCallId: callId,
		});
		expect(pending.lines.join("\n")).not.toContain("already exists");
		expect(pending.lines.join("\n")).not.toContain("Tool execution failed");
		const settled = paint({
			tool: "create_skill",
			instance: tool as never,
			isError: true,
			details: {},
			content: MODEL_TEXT,
			args: { id: "notes" },
			state,
			toolCallId: callId,
		});
		expect(settled.lines).toEqual(["create_skill · notes already exists"]);
	});

	it("a correlation association for view_skill is not painted by list_skills on the same call id", () => {
		associate(
			"boundary-b-corr",
			"view_skill",
			createFailure("ID_NOT_FOUND", {
				evidence: {
					kind: "candidates",
					candidates: [{ id: "notepad", path: "/skills/notepad/SKILL.md" }],
				},
			}),
		);
		expect(claim("boundary-b-corr", "list_skills")).toBeUndefined();
		expect(claim("boundary-b-other", "view_skill")).toBeUndefined();
		const { lines } = paint({
			tool: "list_skills",
			isError: true,
			details: {},
			content: MODEL_TEXT,
			toolCallId: "boundary-b-corr",
		});
		expect(lines).toEqual(["list_skills · Tool execution failed"]);
		expect(lines.join("\n")).not.toContain("not found");
		expect(lines.join("\n")).not.toContain("notepad");
	});
});

const NARROW = 24;
const WIDE = 200;
const LONG_ID = `n${"ame".repeat(28)}`;
const LONG_PATH = `/skills/${"long-segment-".repeat(12)}SKILL.md`;
const LONG_LINE = "X".repeat(160);
const HAZARD_ESC = "\u001b";
const HAZARD_BEL = "\u0007";
const HAZARD_RLO = "\u202e";

const tmpDirs: string[] = [];

function makeTempDir(prefix = "boundary-c-"): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tmpDirs.push(dir);
	return dir;
}

afterAll(() => {
	for (const dir of tmpDirs) {
		rmSync(dir, { recursive: true, force: true });
	}
});

function documented(id: string): DocumentedState {
	const row = DOCUMENTED.find((entry) => entry.id === id);
	if (row === undefined) {
		throw new Error(`missing documented cell ${id}`);
	}
	return row;
}

function assertBounded(raw: string[], width: number): void {
	for (const line of raw) {
		expect(
			visibleLength(line.replace(/\s+$/u, "")),
			JSON.stringify(line),
		).toBeLessThanOrEqual(width);
	}
}

function alwaysThrowingText(): SlotComponents["Text"] {
	return class {
		constructor(_content: string, _paddingX?: number, _paddingY?: number) {
			throw new Error("permanent component failure");
		}
		render(_width: number): string[] {
			throw new Error("unreachable");
		}
	};
}

function createToolAt(agentDir: string, entries: RegistryEntry[] = []) {
	return defineCreateSkill(
		{
			...sharedDeps,
			registryDeps: () => registryOf(entries),
			withFileMutationQueue: async (_path, fn) => fn(),
		},
		{ agentDir, configDirName: ".pi" },
	);
}

function longExpandedState(tool: ToolKey): DocumentedState {
	const item = { id: LONG_ID, filePath: LONG_PATH };
	switch (tool) {
		case "list_skills":
			return {
				id: "width/list_skills",
				tool,
				identity: "list_skills",
				args: {},
				expanded: true,
				payload: buildListSkillsPayload(1, null, [item]),
				expected: [],
			};
		case "list_skill_tags":
			return {
				id: "width/list_skill_tags",
				tool,
				identity: "list_skill_tags",
				args: {},
				expanded: true,
				payload: buildListSkillTagsPayload(1, null, [LONG_ID]),
				expected: [],
			};
		case "list_skill_files":
			return {
				id: "width/list_skill_files",
				tool,
				identity: "[Skill]",
				args: { id: "git" },
				expanded: true,
				payload: buildListSkillFilesPayload(1, "git", [
					{ refId: LONG_ID, path: LONG_PATH },
				]),
				expected: [],
			};
		case "search_skills":
			return {
				id: "width/search_skills",
				tool,
				identity: "search_skills",
				args: { frontmatter: { name: "git" } },
				expanded: true,
				payload: buildSearchSkillsPayload(1, null, { name: "git" }, [item]),
				expected: [],
			};
		case "create_skill":
			return {
				id: "width/create_skill",
				tool,
				identity: "[NewSkill]",
				args: { id: "notes", content: `${LONG_LINE}\n` },
				expanded: true,
				payload: buildCreateSkillPayload("notes", LONG_PATH, `${LONG_LINE}\n`),
				expected: [],
			};
		case "view_skill":
			return {
				id: "width/view_skill",
				tool,
				identity: "[Skill]",
				args: { id: "git" },
				expanded: true,
				payload: buildViewSkillPayload("git", LONG_PATH, `${LONG_LINE}\n`),
				expected: [],
			};
	}
}

function longListInput(): ProjectInput {
	return {
		tool: "list_skills",
		phase: "expanded",
		payload: buildListSkillsPayload(1, "global", [
			{ id: LONG_ID, filePath: LONG_PATH },
		]),
		keyHint,
	};
}

describe("composed rows stay within width", () => {
	it("covers narrow and wide widths for every tool", () => {
		for (const tool of ALL_TOOLS) {
			expect(longExpandedState(tool).tool).toBe(tool);
		}
		expect(ALL_TOOLS).toHaveLength(6);
	});

	it.each(ALL_TOOLS)(
		"%s expanded long values stay within a narrow width",
		(tool) => {
			const raw = compose(longExpandedState(tool), NARROW);
			assertBounded(raw, NARROW);
		},
	);

	it.each(ALL_TOOLS)(
		"%s expanded long values stay within a wide width",
		(tool) => {
			const raw = compose(longExpandedState(tool), WIDE);
			assertBounded(raw, WIDE);
		},
	);
});

describe("presentRow bounding route truncates before paint", () => {
	it("presentRow truncates a long path; paintProjectedRow wraps it", () => {
		const input = longListInput();
		const presented = presentRow(input, theme, realComponents).render(NARROW);
		assertBounded(presented, NARROW);
		expect(visible(presented).join("")).not.toContain(LONG_PATH);
		const painted = paintProjectedRow(
			projectRow(input),
			theme,
			realComponents,
		).render(NARROW);
		assertBounded(painted, NARROW);
		expect(visible(painted).join("")).toContain(LONG_PATH);
	});

	it("a CJK path is bounded by terminal columns even when UTF-16 length fits", () => {
		const cjkPath = "中".repeat(12);
		expect(cjkPath.length).toBe(12);
		const unstyledItem = `- git ${cjkPath}`;
		expect(unstyledItem.length).toBeLessThanOrEqual(NARROW);
		expect(visibleLength(unstyledItem)).toBeGreaterThan(NARROW);
		const input: ProjectInput = {
			tool: "list_skills",
			phase: "expanded",
			payload: buildListSkillsPayload(1, null, [
				{ id: "git", filePath: cjkPath },
			]),
			keyHint,
		};
		const presented = presentRow(input, theme, realComponents).render(NARROW);
		assertBounded(presented, NARROW);
		expect(visible(presented).join("")).not.toContain(cjkPath);
	});
});

describe("widthSafePlain permanently-throwing constructor", () => {
	it("degrades a success row to unstyled truncated unavailable wording", () => {
		const input: ProjectInput = {
			tool: "list_skills",
			phase: "collapsed",
			payload: buildListSkillsPayload(2, null, [gitSkill, notesSkill]),
			keyHint,
		};
		const lines = presentRow(input, theme, {
			Text: alwaysThrowingText(),
			Container,
		}).render(20);
		expect(visible(lines)).toEqual(["list_skills · Result"]);
		expect(lines.join("\n")).not.toContain(theme.fg("toolTitle", "list_skills"));
		assertBounded(lines, 20);
	});

	it("degrades a failure row to unstyled unknown-error wording", () => {
		const input: ProjectInput = {
			tool: "search_skills",
			phase: "collapsed",
			payload: buildFailurePayload(
				"search_skills",
				createFailure("ENTRY_UNREACHABLE"),
			),
			keyHint,
		};
		const lines = presentRow(input, theme, {
			Text: alwaysThrowingText(),
			Container,
		}).render(80);
		expect(visible(lines)).toEqual(["search_skills · Tool execution failed"]);
		expect(lines.join("\n")).not.toContain(
			theme.fg("error", "Tool execution failed"),
		);
	});
});

describe("expanded Position is toolTitle, parens are muted", () => {
	const CELLS: { id: string; position: string }[] = [
		{ id: "list_skills/expanded+location", position: "Global" },
		{ id: "list_skill_tags/expanded+location", position: "Project" },
		{ id: "search_skills/expanded+location", position: "Package" },
	];

	it("covers every location-aware tool's expanded Position", () => {
		for (const tool of LOCATION_TOOLS) {
			expect(
				CELLS.some((cell) => cell.id.startsWith(`${tool}/expanded`)),
				`${tool} missing from Position colour cells`,
			).toBe(true);
		}
	});

	it.each(CELLS)("$id paints $position as toolTitle, not muted", (cell) => {
		const raw = compose(documented(cell.id));
		const text = raw.join("\n");
		expect(text).toContain(theme.fg("toolTitle", cell.position));
		expect(text).not.toContain(theme.fg("muted", cell.position));
		expect(text).toContain(theme.fg("muted", " ("));
		expect(text).toContain(theme.fg("muted", " in "));
		expect(text).toContain(theme.fg("muted", ")"));
	});
});

describe("untrusted text cannot take terminal control", () => {
	it("replaces hazards in ids, paths, and content on composed rows", () => {
		const hazardId = `git${HAZARD_BEL}x`;
		const hazardPath = `/skills/${HAZARD_RLO}hidden/SKILL.md`;
		const hazardContent = `hello${HAZARD_ESC}world\n`;
		const payload = buildListSkillsPayload(1, null, [
			{ id: hazardId, filePath: hazardPath },
		]);
		const before = JSON.stringify(payload);
		const listRaw = compose({
			id: "hazard/list_skills",
			tool: "list_skills",
			identity: "list_skills",
			args: {},
			expanded: true,
			payload,
			expected: [],
		});
		const listText = visible(listRaw).join("\n");
		expect(listText).toContain(REPLACEMENT);
		expect(listText).not.toContain(HAZARD_BEL);
		expect(listText).not.toContain(HAZARD_RLO);
		expect(listRaw.join("").replace(SGR, "")).not.toContain(HAZARD_ESC);
		expect(JSON.stringify(payload)).toBe(before);

		const createRaw = compose({
			id: "hazard/create_skill",
			tool: "create_skill",
			identity: "[NewSkill]",
			args: { id: "notes", content: hazardContent },
			expanded: true,
			payload: buildCreateSkillPayload("notes", hazardPath, hazardContent),
			expected: [],
		});
		const createText = visible(createRaw).join("\n");
		expect(createText).toContain(`hello${REPLACEMENT}world`);
		expect(createText).not.toContain(HAZARD_RLO);
		expect(createRaw.join("").replace(SGR, "")).not.toContain(HAZARD_ESC);

		const viewRaw = compose({
			id: "hazard/view_skill",
			tool: "view_skill",
			identity: "[Skill]",
			args: { id: hazardId },
			expanded: true,
			payload: buildViewSkillPayload(hazardId, hazardPath, hazardContent),
			expected: [],
		});
		const viewText = visible(viewRaw).join("\n");
		expect(viewText).toContain(REPLACEMENT);
		expect(viewText).not.toContain(HAZARD_BEL);
		expect(viewText).not.toContain(HAZARD_RLO);
		expect(viewRaw.join("").replace(SGR, "")).not.toContain(HAZARD_ESC);
	});
});

describe("rebuild from stored data after settlement", () => {
	it.each(ALL_TOOLS)(
		"%s keeps the same visible row under a different theme",
		(tool) => {
			const cell = documented(`${tool}/collapsed`);
			const dark = paint({
				tool,
				args: cell.args,
				details: { payload: cell.payload },
				state: { payload: cell.payload },
			});
			const light = paint({
				tool,
				args: cell.args,
				details: { payload: cell.payload },
				state: { payload: cell.payload },
				theme: lightTheme,
			});
			expect(light.lines).toEqual(dark.lines);
			expect(light.raw.join("\n")).not.toEqual(dark.raw.join("\n"));
		},
	);

	it.each(ALL_TOOLS)(
		"%s expands from stored payload without reverting to pending",
		(tool) => {
			const collapsed = documented(`${tool}/collapsed`);
			const expanded = documented(`${tool}/expanded`);
			const { lines } = paint({
				tool,
				args: collapsed.args,
				details: { payload: collapsed.payload },
				state: { payload: collapsed.payload },
				expanded: true,
			});
			expect(lines).toEqual(expanded.expected);
			expect(lines.join("\n")).not.toEqual(collapsed.expected.join("\n"));
			expect(lines.join("\n")).not.toEqual(
				documented(`${tool}/pending`).expected.join("\n"),
			);
		},
	);

	it("rebuildPresentation restyles retained input without storing themed children", () => {
		const input: ProjectInput = {
			tool: "list_skills",
			phase: "collapsed",
			payload: buildListSkillsPayload(2, null, [gitSkill, notesSkill]),
			keyHint,
		};
		const presented = presentRow(input, theme, realComponents);
		const rebuilt = rebuildPresentation(
			presented.retained,
			lightTheme,
			realComponents,
		);
		expect(visible(rebuilt.render(80))).toEqual(visible(presented.render(80)));
		expect(rebuilt.render(80).join("\n")).not.toEqual(
			presented.render(80).join("\n"),
		);
		expect(presented.retained).not.toHaveProperty("call");
		expect(presented.retained).not.toHaveProperty("result");
		expect(Object.keys(presented.retained)).toEqual(["input"]);
		expect(presented.retained.input.payload).toBe(input.payload);
	});
});

describe("storage containment and no-overwrite creation", () => {
	it("a registry name hit does not overwrite the on-disk file and paints already exists", async () => {
		const agentDir = makeTempDir();
		const skillDir = join(agentDir, "skills", "notes");
		mkdirSync(skillDir, { recursive: true });
		const target = join(skillDir, "SKILL.md");
		writeFileSync(target, "ORIGINAL\n");
		const tool = createToolAt(agentDir, [notesEntry()]);
		const callId = "boundary-c-overwrite-name";
		await expect(
			tool.execute(
				callId,
				{ id: "notes", content: "OVERWRITE\n" },
				undefined,
				undefined,
				execCtx,
			),
		).rejects.toThrow(/error:/);
		expect(readFileSync(target, "utf8")).toBe("ORIGINAL\n");
		const { lines } = paint({
			tool: "create_skill",
			instance: tool as never,
			isError: true,
			details: {},
			args: { id: "notes", content: "OVERWRITE\n" },
			toolCallId: callId,
		});
		expect(lines).toEqual(["create_skill · notes already exists"]);
	});

	it("an existing target directory is left without SKILL.md and paints already exists", async () => {
		const agentDir = makeTempDir();
		const occupied = join(agentDir, "skills", "occupied");
		mkdirSync(occupied, { recursive: true });
		const tool = createToolAt(agentDir);
		const callId = "boundary-c-overwrite-dir";
		await expect(
			tool.execute(
				callId,
				{ id: "occupied", content: "NEW\n" },
				undefined,
				undefined,
				execCtx,
			),
		).rejects.toThrow(/error:/);
		expect(existsSync(join(occupied, "SKILL.md"))).toBe(false);
		const { lines } = paint({
			tool: "create_skill",
			instance: tool as never,
			isError: true,
			details: {},
			args: { id: "occupied", content: "NEW\n" },
			toolCallId: callId,
		});
		expect(lines).toEqual(["create_skill · occupied already exists"]);
	});

	it("an escaping name writes nothing outside the skills root and paints the unknown-error row", async () => {
		const agentDir = makeTempDir();
		const tool = createToolAt(agentDir);
		const callId = "boundary-c-escape";
		await expect(
			tool.execute(
				callId,
				{ id: "../uppercase", content: "ESCAPED\n" },
				undefined,
				undefined,
				{ cwd: agentDir, isProjectTrusted: () => true },
			),
		).rejects.toThrow(/error:/);
		expect(existsSync(join(agentDir, "uppercase"))).toBe(false);
		expect(existsSync(join(agentDir, "skills"))).toBe(false);
		const { lines } = paint({
			tool: "create_skill",
			instance: tool as never,
			isError: true,
			details: {},
			args: { id: "../uppercase", content: "ESCAPED\n" },
			toolCallId: callId,
		});
		expect(lines).toEqual(["create_skill · Tool execution failed"]);
	});

	it("a successful create writes only under the skills root", async () => {
		const agentDir = makeTempDir();
		mkdirSync(join(agentDir, "skills"), { recursive: true });
		const tool = createToolAt(agentDir);
		const content = "---\nname: notes\ndescription: d\n---\n# Notes\n";
		const result = await tool.execute(
			"boundary-c-write",
			{ id: "notes", content },
			undefined,
			undefined,
			execCtx,
		);
		expect(result.content[0]?.text).toContain("created skill");
		const written = join(agentDir, "skills", "notes", "SKILL.md");
		expect(existsSync(written)).toBe(true);
		expect(readFileSync(written, "utf8")).toBe(content);
		const top = readdirSync(agentDir);
		expect(top).toEqual(["skills"]);
		const { lines } = paint({
			tool: "create_skill",
			instance: tool as never,
			details: result.details,
			state: { payload: result.details?.payload },
			args: { id: "notes", content },
		});
		expect(lines[0]).toBe("[NewSkill] notes");
		expect(lines.join("\n")).toContain("Wrote");
	});
});

describe("streaming progress advances then stops", () => {
	it.each(ALL_TOOLS.filter((tool) => tool !== "create_skill"))(
		"%s pending has no streaming readout",
		(tool) => {
			const { lines } = paint({ tool, pending: true });
			expect(lines.join("\n")).not.toMatch(/\d+ B\)/);
			expect(lines.join("\n")).not.toMatch(/\d+ lines? ·/);
		},
	);

	it("create_skill pending readout advances as streamed content grows", () => {
		const state: Record<string, unknown> = {};
		const first = paint({
			tool: "create_skill",
			pending: true,
			args: { id: "notes", content: "abcd" },
			state,
		});
		expect(first.lines).toEqual(["[NewSkill] notes (1 line · 4 B)"]);
		const second = paint({
			tool: "create_skill",
			pending: true,
			args: { id: "notes", content: "abcd\nefgh\n" },
			state,
		});
		expect(second.lines).toEqual(["[NewSkill] notes (2 lines · 10 B)"]);
	});

	it("create_skill settled row ignores later argument growth", () => {
		const content = "hello\n";
		const payload = buildCreateSkillPayload(
			"notes",
			"/skills/notes/SKILL.md",
			content,
		);
		const state: Record<string, unknown> = { payload };
		const grown = paint({
			tool: "create_skill",
			args: { id: "notes", content: `${content}extra\n` },
			details: { payload },
			state,
		});
		expect(grown.lines).toEqual([
			"[NewSkill] notes",
			"Wrote 1 line (6B) · Ctrl+O to expand",
		]);
		expect(grown.lines.join("\n")).not.toContain("extra");
		expect(grown.lines.join("\n")).not.toMatch(/2 lines/);
	});

	it("create_skill onUpdate stops once execute settles", async () => {
		const agentDir = makeTempDir();
		mkdirSync(join(agentDir, "skills"), { recursive: true });
		const tool = createToolAt(agentDir);
		const stamps: number[] = [];
		const result = await tool.execute(
			"boundary-c-progress",
			{
				id: "notes",
				content: "---\nname: notes\ndescription: d\n---\n# Notes\n",
			},
			undefined,
			() => {
				stamps.push(Date.now());
			},
			execCtx,
		);
		const after = stamps.length;
		expect(result.content[0]?.text).toContain("created skill");
		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(stamps.length).toBe(after);
	});
});

describe("prefixed id title across phases — pinning current behaviour", () => {
	it("create_skill pending shows the prefixed args id; settled shows the bare payload name", () => {
		const pending = paint({
			tool: "create_skill",
			pending: true,
			args: { id: "global:notes", content: "hello\n" },
		});
		expect(pending.lines).toEqual(["[NewSkill] global:notes (1 line · 6 B)"]);
		const payload = buildCreateSkillPayload(
			"notes",
			"/skills/notes/SKILL.md",
			"hello\n",
		);
		const settled = paint({
			tool: "create_skill",
			args: { id: "global:notes", content: "hello\n" },
			details: { payload },
			state: { payload },
		});
		expect(settled.lines).toEqual([
			"[NewSkill] notes",
			"Wrote 1 line (6B) · Ctrl+O to expand",
		]);
	});

	it("view_skill pending shows the prefixed args id; settled shows the bare payload name", () => {
		const pending = paint({
			tool: "view_skill",
			pending: true,
			args: { id: "global:notes" },
		});
		expect(pending.lines).toEqual(["[Skill] global:notes"]);
		const payload = buildViewSkillPayload(
			"notes",
			"/skills/notes/SKILL.md",
			"# Notes\n",
		);
		const settled = paint({
			tool: "view_skill",
			args: { id: "global:notes" },
			details: { payload },
			state: { payload },
		});
		expect(settled.lines).toEqual(["[Skill] notes · Ctrl+O to expand"]);
	});
});

describe("expanded content wraps instead of truncating", () => {
	it("view_skill and create_skill keep the full long line at width 40", () => {
		const viewRaw = compose(longExpandedState("view_skill"), 40);
		assertBounded(viewRaw, 40);
		const viewText = visible(viewRaw).join("");
		expect((viewText.match(/X/g) ?? []).length).toBe(LONG_LINE.length);
		// Box(1, 1) pads each card line; trim reconstructs the content stream.
		const viewContent = visible(viewRaw)
			.map((row) => row.trim())
			.join("");
		expect(viewContent).toContain(LONG_LINE);

		const createRaw = compose(longExpandedState("create_skill"), 40);
		assertBounded(createRaw, 40);
		const createText = visible(createRaw).join("");
		expect(createText).toContain(LONG_LINE);
		expect((createText.match(/X/g) ?? []).length).toBe(LONG_LINE.length);
	});

	it("list_skill_tags expanded keeps every tag at a narrow width", () => {
		const tags = [
			"orchestration",
			"implementation",
			"verification",
			"frontmatter",
			"delegation",
			"workflow",
		];
		const raw = compose(
			{
				id: "width/list_skill_tags-stream",
				tool: "list_skill_tags",
				identity: "list_skill_tags",
				args: {},
				expanded: true,
				payload: buildListSkillTagsPayload(tags.length, null, tags),
				expected: [],
			},
			NARROW,
		);
		assertBounded(raw, NARROW);
		const text = visible(raw).join("");
		for (const tag of tags) {
			expect(text).toContain(tag);
		}
	});
});
