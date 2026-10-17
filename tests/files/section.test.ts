/**
 * Section extraction: find a heading by title, capture until the next heading
 * of the same or a higher level, and never mistake a fenced line for one.
 */
import { describe, expect, it } from "vitest";
import { extractSection } from "../../src/files/section";

describe("extractSection", () => {
	it("extracts a level-2 section up to the next level-2 heading", () => {
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

		const section = extractSection(markdown, "When to Use");
		expect(section).toEqual({
			heading: "## When to Use",
			content: "## When to Use\n- Use when doing A\n- Don't use for B",
			lines: 3,
			bytes: Buffer.byteLength(
				"## When to Use\n- Use when doing A\n- Don't use for B",
				"utf8",
			),
		});
	});

	it("runs to the end of the document when no heading follows", () => {
		const markdown = "# Title\n## When to Use\nSingle paragraph at the end.";
		expect(extractSection(markdown, "When to Use")?.content).toBe(
			"## When to Use\nSingle paragraph at the end.",
		);
	});

	it("stops at a level-1 heading", () => {
		const markdown = "## When to Use\nContent here.\n# Another Document\nX";
		expect(extractSection(markdown, "When to Use")?.content).toBe(
			"## When to Use\nContent here.",
		);
	});

	it("keeps lower-level subheadings inside the section", () => {
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
		expect(extractSection(markdown, "When to Use")?.content).toBe(
			"## When to Use\nIntro text.\n\n### Subcase 1\nDetails 1",
		);
	});

	it("extracts a level-3 section and stops at a peer heading", () => {
		const markdown = [
			"## Parent",
			"### When to Use",
			"Deep content.",
			"### Sibling",
			"Other.",
		].join("\n");
		expect(extractSection(markdown, "When to Use")?.content).toBe(
			"### When to Use\nDeep content.",
		);
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
			"",
			"## Conclusion",
		].join("\n");
		expect(extractSection(markdown, "When to Use")?.content).toBe(
			"## When to Use\nReal when to use content.",
		);
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
			"## End",
		].join("\n");
		expect(extractSection(markdown, "When to Use")?.content).toBe(
			"## When to Use\nReal content.",
		);
	});

	it("keeps a fence that lives inside the captured section", () => {
		const markdown = [
			"## When to Use",
			"```text",
			"## not a heading",
			"```",
			"After the fence.",
			"## Next",
		].join("\n");
		expect(extractSection(markdown, "When to Use")?.content).toBe(
			"## When to Use\n```text\n## not a heading\n```\nAfter the fence.",
		);
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

		expect(extractSection(markdown, "When to Use")?.content).toBe(
			[
				"## When to Use",
				"````markdown",
				"```md",
				"## When to Use",
				"inner example heading",
				"```",
				"````",
			].join("\n"),
		);
	});

	it("applies the same nesting rule to tilde fences", () => {
		const markdown = [
			"## When to Use",
			"~~~~markdown",
			"~~~",
			"## When to Use",
			"inner",
			"~~~",
			"~~~~",
			"## Next",
		].join("\n");

		expect(extractSection(markdown, "When to Use")?.content).toBe(
			[
				"## When to Use",
				"~~~~markdown",
				"~~~",
				"## When to Use",
				"inner",
				"~~~",
				"~~~~",
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

		expect(extractSection(markdown, "When to Use")?.content).toBe(
			[
				"## When to Use",
				"````text",
				"## not a heading",
				"no closer follows",
			].join("\n"),
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

		expect(extractSection(markdown, "When to Use")?.content).toBe(
			[
				"## When to Use",
				"````",
				"```",
				"~~~",
				"````md",
				"## still code",
				"````",
			].join("\n"),
		);
	});

	it("ignores an indented code line that looks like a heading", () => {
		const markdown = [
			"## When to Use",
			"Intro.",
			"    ## indented code, not a heading",
			"Still the same section.",
		].join("\n");
		expect(extractSection(markdown, "When to Use")?.content).toBe(
			"## When to Use\nIntro.\n    ## indented code, not a heading\nStill the same section.",
		);
	});

	it("matches case-insensitively and drops closing hashes", () => {
		const markdown = [
			"# My Skill",
			"##   when to USE  ##",
			"Case-insensitive match.",
			"## Next",
		].join("\n");
		const section = extractSection(markdown, "When to Use");
		expect(section?.heading).toBe("##   when to USE  ##");
		expect(section?.content).toBe(
			"##   when to USE  ##\nCase-insensitive match.",
		);
	});

	it("normalizes CRLF line endings", () => {
		const markdown = "## When to Use\r\nContent.\r\n## Next\r\nX";
		expect(extractSection(markdown, "When to Use")?.content).toBe(
			"## When to Use\nContent.",
		);
	});

	it("trims trailing blank lines from the section", () => {
		const markdown = "## When to Use\nContent.\n\n\n## Next";
		expect(extractSection(markdown, "When to Use")?.content).toBe(
			"## When to Use\nContent.",
		);
	});

	it("returns undefined when the heading is absent", () => {
		expect(
			extractSection("# Title\n## Overview\nNo such section.", "When to Use"),
		).toBeUndefined();
	});

	it("returns undefined for empty or blank text", () => {
		expect(extractSection("", "When to Use")).toBeUndefined();
		expect(extractSection("   \n\n  ", "When to Use")).toBeUndefined();
	});
});
