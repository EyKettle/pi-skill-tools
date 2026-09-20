import { describe, expect, it } from "vitest";
import { extractSection } from "../skill-section";

describe("extractSection", () => {
	it("extracts a standard ## When to Use section ending at next ## heading", () => {
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
		expect(section).toBeDefined();
		expect(section?.heading).toBe("## When to Use");
		expect(section?.content).toBe(
			"## When to Use\n- Use when doing A\n- Don't use for B",
		);
		expect(section?.lines).toBe(3);
		expect(section?.bytes).toBe(Buffer.byteLength(section?.content ?? "", "utf8"));
	});

	it("extracts section when it extends to the end of the document", () => {
		const markdown = [
			"# Title",
			"## When to Use",
			"Single paragraph at the end.",
		].join("\n");

		const section = extractSection(markdown, "When to Use");
		expect(section).toBeDefined();
		expect(section?.content).toBe("## When to Use\nSingle paragraph at the end.");
		expect(section?.lines).toBe(2);
	});

	it("stops at a level 1 heading (#)", () => {
		const markdown = [
			"## When to Use",
			"Content here.",
			"# Another Document",
			"Trailing.",
		].join("\n");

		const section = extractSection(markdown, "When to Use");
		expect(section).toBeDefined();
		expect(section?.content).toBe("## When to Use\nContent here.");
	});

	it("includes nested subheadings like ### Subtopic", () => {
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

		const section = extractSection(markdown, "When to Use");
		expect(section).toBeDefined();
		expect(section?.content).toBe(
			"## When to Use\nIntro text.\n\n### Subcase 1\nDetails 1",
		);
	});

	it("ignores headings inside fenced code blocks", () => {
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

		const section = extractSection(markdown, "When to Use");
		expect(section).toBeDefined();
		expect(section?.content).toBe("## When to Use\nReal when to use content.");
	});

	it("handles tilde-fenced code blocks (~~~)", () => {
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

		const section = extractSection(markdown, "When to Use");
		expect(section).toBeDefined();
		expect(section?.content).toBe("## When to Use\nReal content.");
	});

	it("is case-insensitive and trims heading title spacing", () => {
		const markdown = [
			"# My Skill",
			"##   when to USE  ",
			"Case-insensitive match.",
			"## Next",
		].join("\n");

		const section = extractSection(markdown, "When to Use");
		expect(section).toBeDefined();
		expect(section?.heading).toBe("##   when to USE  ");
		expect(section?.content).toBe("##   when to USE  \nCase-insensitive match.");
	});

	it("returns undefined when the target heading is absent", () => {
		const markdown = [
			"# Title",
			"## Overview",
			"No when to use here.",
		].join("\n");

		const section = extractSection(markdown, "When to Use");
		expect(section).toBeUndefined();
	});

	it("handles empty or blank markdown text gracefully", () => {
		expect(extractSection("", "When to Use")).toBeUndefined();
		expect(extractSection("   \n\n  ", "When to Use")).toBeUndefined();
	});
});
