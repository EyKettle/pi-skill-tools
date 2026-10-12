/**
 * The loaded set's render: attributed wrapping and block assembly (plan
 * Task 3).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderSkillBlock } from "../skill-block";
import type { StateEntry } from "../state";

function entry(overrides: Partial<StateEntry> = {}): StateEntry {
	return {
		storage: "global",
		name: "git",
		displayId: "git",
		path: "/skills/git/SKILL.md",
		body: "# Git\n",
		volume: { bytes: 6, lines: 1 },
		...overrides,
	};
}

describe("renderSkillBlock", () => {
	it("renders one entry as one attributed block", () => {
		const text = renderSkillBlock({ entries: [entry()] });

		expect(text).toBe(
			'<SKILL name="git" location="/skills/git/SKILL.md">\n# Git\n\n</SKILL>',
		);
	});

	it("renders several entries in load order joined by a blank line", () => {
		const ref = entry({
			refPath: "references/GUIDE.md",
			displayId: "git/references/GUIDE.md",
			path: "/skills/git/references/GUIDE.md",
			body: "# Guide\n",
			volume: { bytes: 8, lines: 1 },
		});

		const text = renderSkillBlock({ entries: [entry(), ref] });

		expect(text).toBe(
			'<SKILL name="git" location="/skills/git/SKILL.md">\n# Git\n\n</SKILL>\n\n' +
				'<SKILL name="git" location="/skills/git/references/GUIDE.md">\n# Guide\n\n</SKILL>',
		);
	});

	it("renders the empty set as an empty string", () => {
		expect(renderSkillBlock({ entries: [] })).toBe("");
	});
});

describe("single source", () => {
	it("the wrapper's one definition lives in skill-block.ts", () => {
		const blockSource = readFileSync(
			new URL("../skill-block.ts", import.meta.url),
			"utf8",
		);
		const toolSource = readFileSync(
			new URL("../tools/view-skill.ts", import.meta.url),
			"utf8",
		);

		expect(blockSource).toContain("export function wrapSkillBlock(");
		expect(toolSource).not.toContain("function wrapSkillBlock(");
	});

	it("skill-block.ts stays a pure module", () => {
		const source = readFileSync(
			new URL("../skill-block.ts", import.meta.url),
			"utf8",
		);
		const specifiers = Array.from(
			source.matchAll(/from\s+"([^"]+)"/g),
			(match) => match[1],
		);

		for (const specifier of specifiers) {
			expect(specifier, `unexpected import: ${specifier}`).toMatch(/^\.\//);
			expect(specifier).not.toMatch(/node:|@earendil|session-state|\/deps\//);
		}
	});
});
