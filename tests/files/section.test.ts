/**
 * The heading representation of one file: where each heading stands, how the
 * headings nest, and which lines belong to a section's own body.
 */
import { describe, expect, it } from "vitest";
import { parseSections, projectSections, selectSections } from "../../src/files/section";

const PATH = "/skills/x/SKILL.md";

describe("parseSections", () => {
	it("gives every heading its physical line, level and title", () => {
		const markdown = [
			"# My Skill",
			"",
			"## Overview",
			"This is overview.",
			"",
			"## When to Use",
			"- Use when doing A",
			"- Don't use for B",
			"",
			"## Instructions",
			"Step 1: do this.",
		].join("\n");

		const document = parseSections(markdown, PATH);

		expect(
			document.headings.map((heading) => [heading.line, heading.level, heading.title]),
		).toEqual([
			[1, 1, "My Skill"],
			[3, 2, "Overview"],
			[6, 2, "When to Use"],
			[10, 2, "Instructions"],
		]);
	});

	it("keeps the heading line as the file carries it", () => {
		const markdown = "##   when to USE  ##\nCase-insensitive title.\n";

		const document = parseSections(markdown, PATH);

		expect(document.headings[0]?.heading).toBe("##   when to USE  ##");
		expect(document.headings[0]?.title).toBe("when to USE");
	});

	it("nests a heading under the nearest heading of a lower level", () => {
		const markdown = [
			"# Skill",
			"## Parent",
			"### Child",
			"## Sibling",
			"#### Grandchild",
			"# Other",
		].join("\n");

		const document = parseSections(markdown, PATH);
		const [skill, parent, child, sibling, grandchild, other] = document.headings;

		expect(skill?.children).toEqual([parent, sibling]);
		expect(parent?.children).toEqual([child]);
		expect(child?.children).toEqual([]);
		expect(sibling?.children).toEqual([grandchild]);
		expect(grandchild?.children).toEqual([]);
		expect(other?.children).toEqual([]);
		expect(document.headings.flatMap((heading) => heading.children)).not.toContain(other);
	});

	it("gives a section the lines between its heading and the next heading", () => {
		const markdown = [
			"## When to Use",
			"Intro text.",
			"",
			"### Subcase 1",
			"Details 1",
			"",
			"## Next Section",
			"Done.",
		].join("\n");

		const document = parseSections(markdown, PATH);
		const [parent, child, next] = document.headings;

		expect(parent?.content).toBe("Intro text.");
		expect(parent?.contentLines).toEqual([2]);
		expect(child?.content).toBe("Details 1");
		expect(child?.contentLines).toEqual([5]);
		expect(next?.content).toBe("Done.");
		expect(next?.contentLines).toEqual([8]);
	});

	it("leaves a heading without a body an empty one", () => {
		const document = parseSections("# Skill\n", PATH);

		expect(document.headings[0]?.content).toBe("");
		expect(document.headings[0]?.contentLines).toEqual([]);
	});

	it("ignores headings inside backtick fences", () => {
		const markdown = [
			"## Overview",
			"Here is an example:",
			"```markdown",
			"## When to Use",
			"This is code, not a real section.",
			"```",
			"",
			"## When to Use",
			"Real when to use content.",
		].join("\n");

		const document = parseSections(markdown, PATH);

		expect(document.headings.map((heading) => heading.title)).toEqual([
			"Overview",
			"When to Use",
		]);
		expect(document.headings[1]?.line).toBe(8);
	});

	it("ignores headings inside tilde fences", () => {
		const markdown = [
			"## Overview",
			"~~~",
			"## When to Use",
			"Fake heading.",
			"~~~",
			"## When to Use",
			"Real content.",
		].join("\n");

		const document = parseSections(markdown, PATH);

		expect(document.headings.map((heading) => heading.line)).toEqual([1, 6]);
	});

	it("keeps the section whole when a four-backtick fence holds a three-backtick one", () => {
		const markdown = [
			"## When to Use",
			"````markdown",
			"```md",
			"## When to Use",
			"inner example heading",
			"```",
			"````",
			"## Next",
		].join("\n");

		const document = parseSections(markdown, PATH);

		expect(document.headings.map((heading) => heading.line)).toEqual([1, 8]);
		expect(document.headings[0]?.content).toBe(
			[
				"````markdown",
				"```md",
				"## When to Use",
				"inner example heading",
				"```",
				"````",
			].join("\n"),
		);
	});

	it("keeps everything after an unclosed fence inside it", () => {
		const markdown = [
			"## When to Use",
			"````text",
			"## not a heading",
			"no closer follows",
		].join("\n");

		const document = parseSections(markdown, PATH);

		expect(document.headings.map((heading) => heading.line)).toEqual([1]);
		expect(document.headings[0]?.content).toBe(
			["````text", "## not a heading", "no closer follows"].join("\n"),
		);
	});

	it("does not close on a shorter, differently marked, or annotated run", () => {
		const markdown = [
			"## When to Use",
			"````",
			"```",
			"~~~",
			"````md",
			"## still code",
			"````",
			"## Next",
		].join("\n");

		const document = parseSections(markdown, PATH);

		expect(document.headings.map((heading) => heading.line)).toEqual([1, 8]);
	});

	it("ignores an indented code line that looks like a heading", () => {
		const markdown = [
			"## When to Use",
			"Intro.",
			"    ## indented code, not a heading",
			"Still the same section.",
		].join("\n");

		const document = parseSections(markdown, PATH);

		expect(document.headings.map((heading) => heading.title)).toEqual(["When to Use"]);
		expect(document.headings[0]?.content).toBe(
			"Intro.\n    ## indented code, not a heading\nStill the same section.",
		);
	});

	it("normalizes CRLF line endings without moving the headings", () => {
		const markdown = "## When to Use\r\nContent.\r\n## Next\r\nX";

		const document = parseSections(markdown, PATH);

		expect(document.headings.map((heading) => heading.line)).toEqual([1, 3]);
		expect(document.headings[0]?.content).toBe("Content.");
	});

	it("finds no heading in an empty file", () => {
		expect(parseSections("", PATH).headings).toEqual([]);
	});

	it("finds no heading in a file that carries none", () => {
		const document = parseSections("Just a paragraph.\n\nAnd another one.\n", PATH);

		expect(document.headings).toEqual([]);
	});

	it("carries the path the headings came from", () => {
		expect(parseSections("# Skill\n", PATH).path).toBe(PATH);
	});
});


const SELECTION_DOCUMENT = parseSections(
	[
		"# Skill",
		"",
		"## When to Use",
		"Use it here.",
		"",
		"### Details",
		"More.",
		"",
		"## Other",
		"Other.",
		"",
		"## When to Use",
		"Again.",
	].join("\n"),
	PATH,
);

describe("selectSections", () => {
	it("resolves a name that reaches one heading", () => {
		const selection = selectSections(SELECTION_DOCUMENT, [
			{ kind: "name", name: "Other" },
		]);

		expect(selection.selected.map((heading) => heading.line)).toEqual([9]);
		expect(selection.issues).toEqual([]);
	});

	it("matches a name without regard to case", () => {
		const selection = selectSections(SELECTION_DOCUMENT, [
			{ kind: "name", name: "other" },
		]);

		expect(selection.selected.map((heading) => heading.line)).toEqual([9]);
	});

	it("reports a name that reaches no heading", () => {
		const selection = selectSections(SELECTION_DOCUMENT, [
			{ kind: "name", name: "Nope" },
		]);

		expect(selection.selected).toEqual([]);
		expect(selection.issues).toHaveLength(1);
		expect(selection.issues[0]?.selector).toEqual({ kind: "name", name: "Nope" });
		expect(selection.issues[0]?.failure.code).toBe("SECTION_NOT_FOUND");
		expect(selection.issues[0]?.failure.evidence).toEqual({
			kind: "section",
			path: PATH,
			selector: { kind: "name", name: "Nope" },
		});
	});

	it("reports a name that reaches several headings with the candidates in source order", () => {
		const selection = selectSections(SELECTION_DOCUMENT, [
			{ kind: "name", name: "When to Use" },
		]);

		expect(selection.selected).toEqual([]);
		expect(selection.issues).toHaveLength(1);
		expect(selection.issues[0]?.failure.code).toBe("SECTION_AMBIGUOUS");
		expect(selection.issues[0]?.failure.evidence).toEqual({
			kind: "sectionAmbiguous",
			path: PATH,
			name: "When to Use",
			candidates: [
				{ heading: "## When to Use", line: 3 },
				{ heading: "## When to Use", line: 12 },
			],
		});
	});

	it("resolves a line address to the heading that stands there", () => {
		const selection = selectSections(SELECTION_DOCUMENT, [{ kind: "line", line: 6 }]);

		expect(selection.selected.map((heading) => heading.line)).toEqual([6]);
		expect(selection.issues).toEqual([]);
	});

	it("reports a line address that is not a heading", () => {
		const selection = selectSections(SELECTION_DOCUMENT, [{ kind: "line", line: 4 }]);

		expect(selection.selected).toEqual([]);
		expect(selection.issues[0]?.failure.code).toBe("SECTION_NOT_FOUND");
		expect(selection.issues[0]?.failure.evidence).toEqual({
			kind: "section",
			path: PATH,
			selector: { kind: "line", line: 4 },
		});
	});

	it("keeps a numeric heading name a name", () => {
		const document = parseSections("## 42\nThe answer.\n", PATH);

		const byName = selectSections(document, [{ kind: "name", name: "42" }]);
		const byLine = selectSections(document, [{ kind: "line", line: 42 }]);

		expect(byName.selected.map((heading) => heading.line)).toEqual([1]);
		expect(byLine.selected).toEqual([]);
		expect(byLine.issues[0]?.failure.code).toBe("SECTION_NOT_FOUND");
	});

	it("resolves every selector on its own", () => {
		const selection = selectSections(SELECTION_DOCUMENT, [
			{ kind: "name", name: "Other" },
			{ kind: "name", name: "Nope" },
			{ kind: "line", line: 6 },
		]);

		expect(selection.selected.map((heading) => heading.line)).toEqual([6, 9]);
		expect(selection.issues).toHaveLength(1);
		expect(selection.issues[0]?.selector).toEqual({ kind: "name", name: "Nope" });
	});

	it("keeps one heading when two selectors reach it", () => {
		const selection = selectSections(SELECTION_DOCUMENT, [
			{ kind: "name", name: "Other" },
			{ kind: "line", line: 9 },
		]);

		expect(selection.selected.map((heading) => heading.line)).toEqual([9]);
	});
});

describe("projectSections", () => {
	it.each(["hide", "tree", "expand"] as const)("preserves projection inputs for %s", (subsectionVisibility) => {
		const document = parseSections("## Parent\nParent body.\n### Child\nChild body.\n## Peer\nPeer body.\n", PATH);
		const selection = { selected: [document.headings[2], document.headings[0]], issues: [] };
		const originalDocument = structuredClone(document);
		const originalSelection = structuredClone(selection);

		projectSections(document, selection, subsectionVisibility);

		expect(document).toEqual(originalDocument);
		expect(selection).toEqual(originalSelection);
	});
	it("shows the whole tree when nothing was selected", () => {
		const projection = projectSections(SELECTION_DOCUMENT, undefined);

		expect(projection.mode).toBe("tree");
		if (projection.mode !== "tree") return;
		expect(projection.headings).toEqual([
			{ line: 1, heading: "# Skill" },
			{ line: 3, heading: "## When to Use" },
			{ line: 6, heading: "### Details" },
			{ line: 9, heading: "## Other" },
			{ line: 12, heading: "## When to Use" },
		]);
	});

	it("counts the heading lines the tree shows", () => {
		expect(projectSections(SELECTION_DOCUMENT, undefined).viewedLines).toBe(5);
	});

	it("keeps a parent's body apart from its descendant's body", () => {
		const selection = selectSections(SELECTION_DOCUMENT, [
			{ kind: "line", line: 3 },
			{ kind: "line", line: 6 },
		]);

		const projection = projectSections(SELECTION_DOCUMENT, selection);

		expect(projection.mode).toBe("sections");
		if (projection.mode !== "sections") return;
		expect(projection.sections).toEqual([
			{
				heading: "## When to Use",
				content: "Use it here.",
				subSections: [{ line: 6, heading: "### Details" }],
			},
			{
				heading: "### Details",
				content: "More.",
				subSections: [],
			},
		]);
	});

	it("counts the heading, the body and the directory a section shows", () => {
		const selection = selectSections(SELECTION_DOCUMENT, [{ kind: "line", line: 3 }]);

		expect(projectSections(SELECTION_DOCUMENT, selection).viewedLines).toBe(3);
	});

	it("counts a source line once when two sections show it", () => {
		const selection = selectSections(SELECTION_DOCUMENT, [
			{ kind: "line", line: 3 },
			{ kind: "line", line: 6 },
		]);

		expect(projectSections(SELECTION_DOCUMENT, selection).viewedLines).toBe(4);
	});
});
