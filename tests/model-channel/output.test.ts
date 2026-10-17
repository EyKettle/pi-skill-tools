/**
 * The model channel's success text: every tool's wording, its empty state,
 * and the one place a count appears.
 */
import { describe, expect, it } from "vitest";
import {
	EMPTY_CREATE,
	EMPTY_LIST_FILES,
	EMPTY_LIST_SKILLS,
	EMPTY_LIST_TAGS,
	EMPTY_PREVIEW,
	EMPTY_SEARCH,
	changeSkillText,
	createSkillText,
	listSkillFilesText,
	listSkillsText,
	listSkillTagsText,
	movedFileText,
	previewSkillText,
	removeSkillText,
	removedFileText,
	renameSkillText,
	searchSkillText,
} from "../../src/model-channel/output";

describe("the listing text", () => {
	it("writes one bracketed id and path per skill", () => {
		expect(
			listSkillsText([
				{ displayId: "git", path: "/skills/git/SKILL.md" },
				{ displayId: "global:pi", path: "/skills/pi/SKILL.md" },
			]),
		).toBe("[git] /skills/git/SKILL.md\n[global:pi] /skills/pi/SKILL.md");
	});

	it("uses the same shape for related files", () => {
		expect(
			listSkillFilesText([
				{
					displayId: "git/references/GUIDE.md",
					path: "/skills/git/references/GUIDE.md",
				},
			]),
		).toBe("[git/references/GUIDE.md] /skills/git/references/GUIDE.md");
	});

	it("joins tags on one line with commas", () => {
		expect(listSkillTagsText(["networking", "pi", "state"])).toBe(
			"networking, pi, state",
		);
	});

	it("falls back to the empty sentence", () => {
		expect(listSkillsText([])).toBe(EMPTY_LIST_SKILLS);
		expect(listSkillFilesText([])).toBe(EMPTY_LIST_FILES);
		expect(listSkillTagsText([])).toBe(EMPTY_LIST_TAGS);
	});
});

describe("the preview text", () => {
	it("writes the four statistics and the section between separators", () => {
		expect(
			previewSkillText({
				totalLines: 5,
				totalBytes: 40,
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-02T00:00:00.000Z",
				section: "## When to Use\nUse it.",
			}),
		).toBe(
			[
				"Total Lines: 5",
				"Total Bytes: 40",
				"Created At: 2026-01-01T00:00:00.000Z",
				"Updated At: 2026-01-02T00:00:00.000Z",
				"======",
				"## When to Use",
				"Use it.",
				"======",
			].join("\n"),
		);
	});

	it("omits the whole second half when no section was asked for", () => {
		const text = previewSkillText({
			totalLines: 5,
			totalBytes: 40,
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-02T00:00:00.000Z",
		});
		expect(text).not.toContain("======");
		expect(text.split("\n")).toHaveLength(4);
	});

	it("falls back to the empty sentence for a zero-line file", () => {
		expect(
			previewSkillText({
				totalLines: 0,
				totalBytes: 0,
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-02T00:00:00.000Z",
			}),
		).toBe(EMPTY_PREVIEW);
	});
});

describe("the search text", () => {
	it("writes the id, then the frontmatter verbatim", () => {
		expect(
			searchSkillText([
				{
					displayId: "git",
					frontmatter: "---\nname: git\nlicense: MIT\n---",
				},
			]),
		).toBe("[git]\n---\nname: git\nlicense: MIT\n---");
	});

	it("separates several hits with a blank line", () => {
		expect(
			searchSkillText([
				{ displayId: "a", frontmatter: "---\nname: a\n---" },
				{ displayId: "b", frontmatter: "---\nname: b\n---" },
			]),
		).toBe("[a]\n---\nname: a\n---\n\n[b]\n---\nname: b\n---");
	});

	it("falls back to the empty sentence", () => {
		expect(searchSkillText([])).toBe(EMPTY_SEARCH);
	});
});

describe("the load and unload text", () => {
	it("writes the action and one id", () => {
		expect(changeSkillText([{ displayId: "git", action: "Loaded" }])).toBe(
			"Loaded [git]",
		);
	});

	it("writes the ids back to back for a batch", () => {
		expect(
			changeSkillText([
				{ displayId: "git", action: "Loaded" },
				{ displayId: "pi", action: "Loaded" },
			]),
		).toBe("Loaded [git][pi]");
	});

	it("groups mixed actions, one line each, in first-seen order", () => {
		expect(
			changeSkillText([
				{ displayId: "git", action: "Loaded" },
				{ displayId: "pi", action: "Unchanged" },
				{ displayId: "state", action: "Loaded" },
			]),
		).toBe("Loaded [git][state]\nUnchanged [pi]");
	});

	it("writes Unloaded for a cancel, through the same function", () => {
		expect(changeSkillText([{ displayId: "git", action: "Unloaded" }])).toBe(
			"Unloaded [git]",
		);
	});
});

describe("the write text", () => {
	it("names the path create wrote", () => {
		expect(createSkillText("/skills/git/SKILL.md")).toBe(
			"Actual Wrote Path: /skills/git/SKILL.md",
		);
	});

	it("names the folder and the files a removal took", () => {
		expect(
			removeSkillText({
				path: "/skills/git",
				files: ["/skills/git/SKILL.md", "/skills/git/references/a.md"],
			}),
		).toBe(
			[
				"Removed folder: /skills/git",
				"Removed files:",
				"- /skills/git/SKILL.md",
				"- /skills/git/references/a.md",
			].join("\n"),
		);
	});

	it("names the folder and the files a rename moved", () => {
		expect(
			renameSkillText({
				path: "/skills/pi",
				files: ["/skills/pi/SKILL.md"],
			}),
		).toBe(
			["Moved path: /skills/pi", "Moved files:", "- /skills/pi/SKILL.md"].join(
				"\n",
			),
		);
	});

	it("writes one line for a related file", () => {
		expect(removedFileText("/skills/git/references/a.md")).toBe(
			"Removed: /skills/git/references/a.md",
		);
		expect(movedFileText("/skills/git/references/b.md")).toBe(
			"Moved: /skills/git/references/b.md",
		);
	});

	it("keeps the empty sentence available for a create with no content", () => {
		expect(EMPTY_CREATE).toBe("Nothing to write");
	});
});
