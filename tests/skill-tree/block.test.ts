/**
 * The mount text: one attributed block per loaded entry, joined without a
 * blank line, and nothing for an empty set.
 */
import { describe, expect, it } from "vitest";
import { renderMount } from "../../src/skill-tree/block";
import type { StateEntry } from "../../src/skill-tree/types";

function entry(overrides: Partial<StateEntry> = {}): StateEntry {
	return {
		id: "global:git",
		path: "/skills/git/SKILL.md",
		body: "# Git\n",
		...overrides,
	};
}

describe("renderMount", () => {
	it("wraps one entry as one attributed block", () => {
		expect(renderMount([entry()])).toBe(
			'<SKILL id="global:git" path="/skills/git/SKILL.md">\n# Git\n</SKILL>',
		);
	});

	it("adds the line break a body without a final newline lacks", () => {
		expect(renderMount([entry({ body: "# Git" })])).toBe(
			'<SKILL id="global:git" path="/skills/git/SKILL.md">\n# Git\n</SKILL>',
		);
	});

	it("renders an empty body as an empty content line", () => {
		expect(renderMount([entry({ body: "" })])).toBe(
			'<SKILL id="global:git" path="/skills/git/SKILL.md">\n\n</SKILL>',
		);
	});

	it("joins several entries without a blank line", () => {
		const guide = entry({
			id: "global:git/references/GUIDE.md",
			path: "/skills/git/references/GUIDE.md",
			body: "# Guide\n",
		});

		expect(renderMount([entry(), guide])).toBe(
			'<SKILL id="global:git" path="/skills/git/SKILL.md">\n# Git\n</SKILL>\n' +
				'<SKILL id="global:git/references/GUIDE.md" path="/skills/git/references/GUIDE.md">\n# Guide\n</SKILL>',
		);
	});

	it("renders the empty set as an empty string", () => {
		expect(renderMount([])).toBe("");
	});
});
