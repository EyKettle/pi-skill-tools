/**
 * Task 5b — documented row shapes, asserted on composed rows through
 * the real pi-tui Text/Container and the real dark theme (harness recipe).
 */
import { describe, expect, it } from "vitest";
import { Text, Container } from "../deps/pi-tui";
import { testTheme } from "../deps/pi-theme";
import { createFailure } from "../failure";
import {
	paintProjectedRow,
	projectRow,
} from "../presentation";
import type { ProjectInput } from "../presentation";
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

const SGR = /\x1b\[[0-9;]*m/g;

function keyHint(binding: string, fallback: string): string {
	if (binding !== "app.tools.expand") {
		throw new Error(`unexpected keybinding '${binding}'`);
	}
	return `Ctrl+O ${fallback}`;
}

function compose(input: ProjectInput): string[] {
	const painted = paintProjectedRow(projectRow(input), theme, {
		Text,
		Container,
	});
	return painted.render(80);
}

function visible(lines: string[]): string[] {
	return lines.map((line) => line.replace(SGR, "").trimEnd());
}

function countVisible(lines: string[], snippet: string): number {
	return visible(lines).join("\n").split(snippet).length - 1;
}

describe("list_skills row shapes", () => {
	it("pending is the title only, with no result slot and no expand hint", () => {
		const lines = compose({
			tool: "list_skills",
			phase: "pending",
			keyHint,
		});
		expect(visible(lines)).toEqual(["list_skills"]);
		expect(visible(lines).join("\n")).not.toContain("to expand");
	});

	it("collapsed shows the expand hint on the call line and the listed count", () => {
		const payload = buildListSkillsPayload(3, null, [
			{ id: "git", filePath: "/skills/git/SKILL.md" },
			{ id: "notes", filePath: "/skills/notes/SKILL.md" },
			{ id: "cli", filePath: "/skills/cli/SKILL.md" },
		]);
		const lines = compose({
			tool: "list_skills",
			phase: "collapsed",
			payload,
			keyHint,
		});
		expect(visible(lines)).toEqual([
			"list_skills · Ctrl+O to expand",
			"listed 3 skills",
		]);
		expect(countVisible(lines, "list_skills")).toBe(1);
		expect(lines[0]).toContain(theme.fg("muted", " · Ctrl+O to expand"));
	});

	it("collapsed with a location appends in {Position} on the result line", () => {
		const payload = buildListSkillsPayload(2, "project", [
			{ id: "git", filePath: "/p/git/SKILL.md" },
			{ id: "notes", filePath: "/p/notes/SKILL.md" },
		]);
		expect(
			visible(
				compose({
					tool: "list_skills",
					phase: "collapsed",
					payload,
					keyHint,
				}),
			),
		).toEqual([
			"list_skills · Ctrl+O to expand",
			"listed 2 skills in Project",
		]);
	});

	it("expanded swaps the hint for a count and puts a blank in the result slot", () => {
		const payload = buildListSkillsPayload(2, null, [
			{ id: "git", filePath: "/skills/git/SKILL.md" },
			{ id: "global:notes", filePath: "/skills/notes/SKILL.md" },
		]);
		expect(
			visible(
				compose({
					tool: "list_skills",
					phase: "expanded",
					payload,
					keyHint,
				}),
			),
		).toEqual([
			"list_skills (2)",
			"",
			"- git /skills/git/SKILL.md",
			"- global:notes /skills/notes/SKILL.md",
		]);
	});

	it("expanded with a location puts Position in the title paren", () => {
		const payload = buildListSkillsPayload(1, "global", [
			{ id: "git", filePath: "/skills/git/SKILL.md" },
		]);
		expect(
			visible(
				compose({
					tool: "list_skills",
					phase: "expanded",
					payload,
					keyHint,
				}),
			)[0],
		).toBe("list_skills (1 in Global)");
	});

	it("empty shows the expand hint", () => {
		const payload = buildListSkillsPayload(0, null, []);
		expect(
			visible(
				compose({
					tool: "list_skills",
					phase: "collapsed",
					payload,
					keyHint,
				}),
			),
		).toEqual(["list_skills · Ctrl+O to expand", "listed 0 skills"]);
	});

	it("empty expanded reports No skills found", () => {
		const payload = buildListSkillsPayload(0, null, []);
		expect(
			visible(
				compose({
					tool: "list_skills",
					phase: "expanded",
					payload,
					keyHint,
				}),
			),
		).toEqual(["list_skills (0)", "", "No skills found"]);
	});
});

describe("list_skill_tags row shapes", () => {
	it("pending is the title only", () => {
		expect(
			visible(
				compose({ tool: "list_skill_tags", phase: "pending", keyHint }),
			),
		).toEqual(["list_skill_tags"]);
	});

	it("collapsed and expanded match the design, tags as a comma stream", () => {
		const payload = buildListSkillTagsPayload(2, "package", ["cli", "git"]);
		expect(
			visible(
				compose({
					tool: "list_skill_tags",
					phase: "collapsed",
					payload,
					keyHint,
				}),
			),
		).toEqual([
			"list_skill_tags · Ctrl+O to expand",
			"listed 2 skill tags in Package",
		]);
		expect(
			visible(
				compose({
					tool: "list_skill_tags",
					phase: "expanded",
					payload,
					keyHint,
				}),
			),
		).toEqual(["list_skill_tags (2 in Package)", "", "cli, git"]);
	});
});

describe("search_skills row shapes", () => {
	it("pending is the title only and hides filters", () => {
		expect(
			visible(
				compose({
					tool: "search_skills",
					phase: "pending",
					args: { frontmatter: { name: "git" } },
					keyHint,
				}),
			),
		).toEqual(["search_skills"]);
	});

	it("collapsed uses matched {n} skills", () => {
		const payload = buildSearchSkillsPayload(
			1,
			null,
			{ name: "git" },
			[{ id: "git", filePath: "/skills/git/SKILL.md" }],
		);
		expect(
			visible(
				compose({
					tool: "search_skills",
					phase: "collapsed",
					payload,
					keyHint,
				}),
			),
		).toEqual(["search_skills · Ctrl+O to expand", "matched 1 skill"]);
	});

	it("expanded paints filters then the match list, with a blank after the title", () => {
		const payload = buildSearchSkillsPayload(
			1,
			"global",
			{ name: "git" },
			[{ id: "git", filePath: "/skills/git/SKILL.md" }],
		);
		const lines = compose({
			tool: "search_skills",
			phase: "expanded",
			payload,
			keyHint,
		});
		expect(visible(lines)).toEqual([
			"search_skills (1 in Global)",
			"",
			"name: git",
			"",
			"- git /skills/git/SKILL.md",
		]);
		expect(lines[2]).toContain(theme.fg("accent", "name: git"));
	});
});

describe("list_skill_files row shapes", () => {
	it("pending shows [Skill] {id} from call args, no hint", () => {
		const lines = compose({
			tool: "list_skill_files",
			phase: "pending",
			args: { id: "git" },
			keyHint,
		});
		expect(visible(lines)).toEqual(["[Skill] git"]);
		expect(lines[0]).toContain(theme.fg("customMessageLabel", "[Skill] "));
	});

	it("collapsed and expanded match the design", () => {
		const payload = buildListSkillFilesPayload(1, "git", [
			{ refId: "references/a.md", path: "/skills/git/references/a.md" },
		]);
		expect(
			visible(
				compose({
					tool: "list_skill_files",
					phase: "collapsed",
					payload,
					keyHint,
				}),
			),
		).toEqual([
			"[Skill] git · Ctrl+O to expand",
			"listed 1 related file",
		]);
		expect(
			visible(
				compose({
					tool: "list_skill_files",
					phase: "expanded",
					payload,
					keyHint,
				}),
			),
		).toEqual([
			"[Skill] git (1)",
			"",
			"- references/a.md /skills/git/references/a.md",
		]);
	});
});

describe("create_skill row shapes", () => {
	it("pending shows streaming readout on the call line, hint omitted, paren not muted", () => {
		const lines = compose({
			tool: "create_skill",
			phase: "pending",
			args: { id: "notes" },
			progress: { lines: 4, bytes: 12 },
			keyHint,
		});
		expect(visible(lines)).toEqual(["[NewSkill] notes (4 lines · 12 B)"]);
		expect(lines[0]).toContain(theme.fg("success", "[NewSkill] "));
		expect(visible(lines).join("\n")).not.toContain("to expand");
		expect(lines[0]).not.toContain(theme.fg("muted", " (4 lines · 12 B)"));
	});

	it("collapsed puts the expand hint on the result line", () => {
		const payload = buildCreateSkillPayload(
			"notes",
			"/skills/notes/SKILL.md",
			"hello\n",
		);
		expect(
			visible(
				compose({
					tool: "create_skill",
					phase: "collapsed",
					payload,
					keyHint,
				}),
			),
		).toEqual([
			"[NewSkill] notes",
			"Wrote 1 line (6B) · Ctrl+O to expand",
		]);
	});

	it("expanded shows path, full content, and the size readout with no expand hint", () => {
		const payload = buildCreateSkillPayload(
			"notes",
			"/skills/notes/SKILL.md",
			"hello\n",
		);
		expect(
			visible(
				compose({
					tool: "create_skill",
					phase: "expanded",
					payload,
					keyHint,
				}),
			),
		).toEqual([
			"[NewSkill] notes (/skills/notes/SKILL.md)",
			"",
			"hello",
			"",
			"1 line (6B) in total",
		]);
	});
});

describe("view_skill row shapes", () => {
	it("pending with an id shows [Skill] {id}", () => {
		expect(
			visible(
				compose({
					tool: "view_skill",
					phase: "pending",
					args: { id: "git" },
					keyHint,
				}),
			),
		).toEqual(["[Skill] git"]);
	});

	it("pending with no id shows the tool name only", () => {
		expect(
			visible(
				compose({ tool: "view_skill", phase: "pending", keyHint }),
			),
		).toEqual(["view_skill"]);
	});

	it("collapsed is a single call line with the expand hint", () => {
		const payload = buildViewSkillPayload(
			"git",
			"/skills/git/SKILL.md",
			"# Git\n",
		);
		expect(
			visible(
				compose({
					tool: "view_skill",
					phase: "collapsed",
					payload,
					keyHint,
				}),
			),
		).toEqual(["[Skill] git · Ctrl+O to expand"]);
	});

	it("expanded shows the path and full content", () => {
		const payload = buildViewSkillPayload(
			"git",
			"/skills/git/SKILL.md",
			"# Git\n",
		);
		expect(
			visible(
				compose({
					tool: "view_skill",
					phase: "expanded",
					payload,
					keyHint,
				}),
			),
		).toEqual(["[Skill] git (/skills/git/SKILL.md)", "", "# Git"]);
	});

	it("not-found without similar names is a single line and has no expand hint", () => {
		const payload = buildFailurePayload(
			"view_skill",
			createFailure("ID_NOT_FOUND"),
		);
		const lines = compose({
			tool: "view_skill",
			phase: "collapsed",
			payload,
			args: { id: "missing" },
			keyHint,
		});
		expect(visible(lines)).toEqual(["[Skill] missing not found"]);
		expect(visible(lines).join("\n")).not.toContain("to show");
		expect(visible(lines).join("\n")).not.toContain("ID_NOT_FOUND");
		expect(lines[0]).toContain(theme.fg("muted", "[Skill] "));
	});

	it("not-found with unexpected suggestions evidence degrades to no similar names", () => {
		const payload = buildFailurePayload(
			"view_skill",
			createFailure("ID_NOT_FOUND", {
				evidence: { kind: "suggestions", suggestions: ["notepad"] },
			}),
		);
		const lines = compose({
			tool: "view_skill",
			phase: "expanded",
			payload,
			args: { id: "note" },
			keyHint,
		});
		expect(visible(lines)).toEqual(["[Skill] note not found"]);
		expect(visible(lines).join("\n")).not.toContain("notepad");
		expect(visible(lines).join("\n")).not.toContain("to show");
	});

	it("not-found with similar names adds the show affordance; expanded lists them", () => {
		const payload = buildFailurePayload(
			"view_skill",
			createFailure("ID_NOT_FOUND", {
				evidence: {
					kind: "candidates",
					candidates: [{ id: "notepad", path: "/skills/notepad/SKILL.md" }],
				},
			}),
		);
		expect(
			visible(
				compose({
					tool: "view_skill",
					phase: "collapsed",
					payload,
					args: { id: "note" },
					keyHint,
				}),
			),
		).toEqual([
			"[Skill] note not found",
			"Found 1 similar skill · Ctrl+O to show",
		]);
		expect(
			visible(
				compose({
					tool: "view_skill",
					phase: "expanded",
					payload,
					args: { id: "note" },
					keyHint,
				}),
			),
		).toEqual([
			"[Skill] note not found",
			"",
			"1 similar skill:",
			"",
			"- notepad /skills/notepad/SKILL.md",
		]);
	});

	it("ambiguous collapsed and expanded match the design", () => {
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
		expect(
			visible(
				compose({
					tool: "view_skill",
					phase: "collapsed",
					payload,
					args: { id: "github" },
					keyHint,
				}),
			),
		).toEqual([
			"[Skill] github is ambiguous",
			"2 same skills in different position · Ctrl+O to show",
		]);
		expect(
			visible(
				compose({
					tool: "view_skill",
					phase: "expanded",
					payload,
					args: { id: "github" },
					keyHint,
				}),
			),
		).toEqual([
			"[Skill] github is ambiguous",
			"",
			"There's 2 versions:",
			"",
			"- global:github /g/github/SKILL.md",
			"- project:github /p/github/SKILL.md",
		]);
	});
});

describe("generic failure and safety", () => {
	it("unknown failure uses the fixed wording on one line", () => {
		const payload = buildFailurePayload(
			"list_skills",
			createFailure("DIR_UNREADABLE"),
		);
		const lines = compose({
			tool: "list_skills",
			phase: "collapsed",
			payload,
			keyHint,
		});
		expect(visible(lines)).toEqual(["list_skills · Tool execution failed"]);
		expect(visible(lines).join("\n")).not.toContain("DIR_UNREADABLE");
		expect(lines[0]).toContain(theme.fg("error", "Tool execution failed"));
	});

	it("create_skill name-exists uses the call-arg name in accent, not the recovery text", () => {
		const payload = buildFailurePayload(
			"create_skill",
			createFailure("CREATE_NAME_EXISTS"),
		);
		const lines = compose({
			tool: "create_skill",
			phase: "collapsed",
			payload,
			args: { id: "notes" },
			keyHint,
		});
		expect(visible(lines)).toEqual(["create_skill · notes already exists"]);
		expect(lines[0]).toContain(theme.fg("accent", "notes"));
		expect(visible(lines).join("\n")).not.toMatch(/recovery/i);
	});

	it("takes the expand phrase from keyHint, never a hardcoded key name", () => {
		const payload = buildListSkillsPayload(1, null, [
			{ id: "git", filePath: "/skills/git/SKILL.md" },
		]);
		const lines = compose({
			tool: "list_skills",
			phase: "collapsed",
			payload,
			keyHint: (_binding: string, fallback: string) => `Alt+X ${fallback}`,
		});
		expect(visible(lines)[0]).toBe("list_skills · Alt+X to expand");
		expect(visible(lines)[0]).not.toContain("Ctrl+O");
	});

	it("sanitizes an untrusted skill id at the display boundary", () => {
		const lines = compose({
			tool: "list_skill_files",
			phase: "pending",
			args: { id: "git\u001B[31m" },
			keyHint,
		});
		expect(visible(lines)[0]).toBe("[Skill] git\uFFFD[31m");
	});
});
