/**
 * The card as the terminal receives it: hazardous characters replaced, lines
 * bounded by display width, and the labels row for a load or unload.
 */
import { describe, expect, it } from "vitest";
import {
	boundToWidth,
	displayWidth,
	renderCard,
	sanitizeTerminalText,
} from "../../src/tui-channel/cards";
import { presentRow } from "../../src/tui-channel/presentation";
import {
	buildCancelSkillPayload,
	buildImportSkillPayload,
	buildListSkillsPayload,
} from "../../src/tui-channel/payload";

/** A theme that marks a role by its name: assertions see the role, not ANSI. */
const theme = {
	fg(role: string, text: string) {
		return `[${role}]${text}[/${role}]`;
	},
};

function render(
	projection: Parameters<typeof renderCard>[0],
	width = 120,
): string[] {
	return renderCard(projection, theme).render(width);
}

describe("sanitizeTerminalText", () => {
	it("replaces control characters, bidi overrides, and the BOM", () => {
		expect(sanitizeTerminalText("a\u0000b")).toBe("a\uFFFDb");
		expect(sanitizeTerminalText("a\u202eb")).toBe("a\uFFFDb");
		expect(sanitizeTerminalText("\ufeffa")).toBe("\uFFFDa");
		expect(sanitizeTerminalText("a\u001b[31mb")).toBe("a\uFFFD[31mb");
	});

	it("collapses a run into one replacement", () => {
		expect(sanitizeTerminalText("a\u0001\u0002\u0003b")).toBe("a\uFFFDb");
	});

	it("keeps ordinary text, CJK, and emoji untouched", () => {
		expect(sanitizeTerminalText("git 技能 🎉")).toBe("git 技能 🎉");
	});
});

describe("boundToWidth", () => {
	it("returns a line that fits unchanged", () => {
		expect(boundToWidth("abc", 5)).toBe("abc");
	});

	it("cuts by visible columns, not by code units", () => {
		expect(boundToWidth("abcdef", 3)).toBe("abc");
		expect(displayWidth(boundToWidth("技能技能", 4))).toBeLessThanOrEqual(4);
	});

	it("clamps a negative cap to an empty line", () => {
		expect(boundToWidth("abc", -1)).toBe("");
	});

	it("leaves a styled line alone rather than cutting inside a sequence", () => {
		const styled = "\u001b[31mabcdef\u001b[0m";
		expect(boundToWidth(styled, 2)).toBe(styled);
	});
});

describe("renderCard", () => {
	it("paints the call and result slots with their roles", () => {
		const projection = presentRow(
			buildListSkillsPayload({ count: 1 }),
			{
				tool: "list_skills",
				args: {},
				expanded: false,
				content: "[git] /skills/git/SKILL.md\n",
			},
		);
		expect(render(projection)).toEqual([
			"[toolTitle]List[/toolTitle][text] [/text][customMessageLabel]skills[/customMessageLabel]",
			"[toolOutput]Listed 1 skill[/toolOutput]",
		]);
	});

	it("renders the full arguments when expanded", () => {
		const projection = presentRow(
			buildListSkillsPayload({ count: 1, location: "global" }),
			{
				tool: "list_skills",
				args: { location: "global", detail: false },
				expanded: true,
				content: "[git] /skills/git/SKILL.md\n",
			},
		);
		expect(render(projection)).toEqual([
			"[toolTitle]List[/toolTitle][text] [/text][text](1)[/text]",
			"location: global",
			"detail: false",
			"[toolOutput][git] /skills/git/SKILL.md[/toolOutput]",
		]);
	});

	it("puts the load labels on one row, space-separated", () => {
		const projection = presentRow(
			buildImportSkillPayload({ displayIds: ["git", "pi"] }),
			{ tool: "import_skill", args: {}, expanded: false },
		);
		expect(render(projection)).toEqual([
			"[success]Skill::git[/success] [success]Skill::pi[/success]",
		]);
	});

	it("renders a cancel label with the error role", () => {
		const projection = presentRow(
			buildCancelSkillPayload({ displayIds: ["git"] }),
			{ tool: "cancel_skill", args: {}, expanded: false },
		);
		expect(render(projection)).toEqual(["[error]Skill::git[/error]"]);
	});

	it("never emits a hazardous character or an over-wide line", () => {
		const projection = presentRow(
			buildListSkillsPayload({ count: 1 }),
			{
				tool: "list_skills",
				args: {},
				expanded: false,
				content: "[a\u202eb] /skills/\u0000bad/SKILL.md\n",
			},
		);
		const lines = render(projection, 20);
		for (const line of lines) {
			expect(line).not.toMatch(/[\u0000-\u0008\u202e]/);
			expect(displayWidth(line)).toBeLessThanOrEqual(20);
		}
	});
});
