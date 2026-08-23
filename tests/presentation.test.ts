/**
 * Presentation primitives (plan Task 5a) — sanitization at the terminal
 * boundary, SGR-aware visible length, and semantic bounding before styling.
 *
 * Hazard/preserve cases follow ~/research/pi/terminal-display-safety.md
 * one category per test so a regression names the category that broke.
 */
import { describe, expect, it } from "vitest";
import {
	boundDisplayValue,
	sanitizeDisplayText,
	visibleLength,
} from "../presentation";
import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import type { ThemeRole } from "../presentation";

const REPLACEMENT = "\uFFFD";

describe("sanitizeDisplayText", () => {
	it("replaces C0 controls except tab, LF, CR (including ESC) with U+FFFD", () => {
		expect(sanitizeDisplayText("a\u001Bb")).toBe(`a${REPLACEMENT}b`);
		expect(sanitizeDisplayText("a\u0007b")).toBe(`a${REPLACEMENT}b`);
		expect(sanitizeDisplayText("a\u0008b")).toBe(`a${REPLACEMENT}b`);
	});

	it("replaces DEL and the C1 block with U+FFFD", () => {
		expect(sanitizeDisplayText("a\u007Fb")).toBe(`a${REPLACEMENT}b`);
		expect(sanitizeDisplayText("a\u009Bb")).toBe(`a${REPLACEMENT}b`);
	});

	it("replaces bidirectional controls with U+FFFD", () => {
		expect(sanitizeDisplayText("ab\u202Ecd")).toBe(`ab${REPLACEMENT}cd`);
		expect(sanitizeDisplayText("ab\u200Fcd")).toBe(`ab${REPLACEMENT}cd`);
		expect(sanitizeDisplayText("ab\u061Ccd")).toBe(`ab${REPLACEMENT}cd`);
	});

	it("replaces the invisible format block with U+FFFD", () => {
		expect(sanitizeDisplayText("ab\u2060cd")).toBe(`ab${REPLACEMENT}cd`);
		expect(sanitizeDisplayText("ab\u2066cd")).toBe(`ab${REPLACEMENT}cd`);
	});

	it("replaces zero-width space and BOM with U+FFFD", () => {
		expect(sanitizeDisplayText("ab\u200Bcd")).toBe(`ab${REPLACEMENT}cd`);
		expect(sanitizeDisplayText("ab\uFEFFcd")).toBe(`ab${REPLACEMENT}cd`);
	});

	it("replaces line and paragraph separators with U+FFFD", () => {
		expect(sanitizeDisplayText("ab\u2028cd")).toBe(`ab${REPLACEMENT}cd`);
		expect(sanitizeDisplayText("ab\u2029cd")).toBe(`ab${REPLACEMENT}cd`);
	});

	it("replaces Unicode noncharacters with U+FFFD", () => {
		expect(sanitizeDisplayText("ab\uFDD0cd")).toBe(`ab${REPLACEMENT}cd`);
		expect(sanitizeDisplayText("ab\uFFFEcd")).toBe(`ab${REPLACEMENT}cd`);
		expect(sanitizeDisplayText("ab\uFFFFcd")).toBe(`ab${REPLACEMENT}cd`);
	});

	it("collapses a run of hazards into one replacement mark", () => {
		expect(sanitizeDisplayText("a\u001B\u001B\u0007b")).toBe(`a${REPLACEMENT}b`);
	});

	it("does not mutate the stored semantic string", () => {
		const stored = "skill\u001B[31mname";
		const displayed = sanitizeDisplayText(stored);
		expect(stored).toBe("skill\u001B[31mname");
		expect(displayed).toBe(`skill${REPLACEMENT}[31mname`);
	});

	it("preserves tab, LF, and CR", () => {
		expect(sanitizeDisplayText("a\tb\nc\rd")).toBe("a\tb\nc\rd");
	});

	it("preserves printable ASCII", () => {
		expect(sanitizeDisplayText("Skill-id_v1.json")).toBe("Skill-id_v1.json");
	});

	it("preserves ZWNJ and ZWJ (emoji clusters / script shaping)", () => {
		const family = "👨\u200D👩\u200D👧\u200D👦";
		expect(sanitizeDisplayText(family)).toBe(family);
		expect(sanitizeDisplayText("a\u200Cb")).toBe("a\u200Cb");
	});

	it("preserves the soft hyphen", () => {
		expect(sanitizeDisplayText("hy\u00ADphen")).toBe("hy\u00ADphen");
	});

	it("preserves combining marks and variation selectors", () => {
		expect(sanitizeDisplayText("e\u0301")).toBe("e\u0301");
		expect(sanitizeDisplayText("❤\uFE0F")).toBe("❤\uFE0F");
	});

	it("preserves surrogate-pair emoji", () => {
		expect(sanitizeDisplayText("😀 skill")).toBe("😀 skill");
	});

	it("preserves CJK text", () => {
		expect(sanitizeDisplayText("技能名称")).toBe("技能名称");
	});
});

describe("visibleLength", () => {
	it("equals string length for unstyled text", () => {
		expect(visibleLength("listed 3 skills")).toBe(15);
	});

	it("discounts SGR styling sequences", () => {
		expect(visibleLength("\x1b[31mred\x1b[0m")).toBe(3);
		expect(visibleLength("\x1b[1;32mok\x1b[0m!")).toBe(3);
	});

	it("counts CJK by terminal columns, not UTF-16 length", () => {
		expect("中".length).toBe(1);
		expect(visibleLength("中")).toBe(2);
		expect(visibleLength("中文")).toBe(4);
	});
});

describe("boundDisplayValue", () => {
	it("returns an unstyled value unchanged when it fits", () => {
		expect(boundDisplayValue("alpha", 8)).toBe("alpha");
	});

	it("truncates the semantic value before styling", () => {
		expect(boundDisplayValue("abcdefghij", 4)).toBe("abcd");
	});

	it("never truncates a styled line", () => {
		const styled = "\x1b[31mabcdefghij\x1b[0m";
		expect(boundDisplayValue(styled, 4)).toBe(styled);
		expect(styled.includes("\x1b[0m")).toBe(true);
		expect(boundDisplayValue(styled, 4)).toBe(styled);
	});

	it("truncates CJK by terminal columns, not UTF-16 length", () => {
		const value = "中文路径";
		expect(value.length).toBe(4);
		expect(boundDisplayValue(value, 4)).toBe("中文");
		expect(boundDisplayValue(value, 3)).toBe("中");
	});

	it("clamps a negative cap to zero instead of slicing from the end", () => {
		expect(boundDisplayValue("abcdefghij", -3)).toBe("");
		expect(boundDisplayValue("abcdefghij", 0)).toBe("");
	});
});

// Compile-time lock: a mistyped role is not a ThemeRole.
// @ts-expect-error "notARole" is not a ThemeRole
const _rejectedRole: ThemeRole = "notARole";
const _roleIsOfficial: ThemeRole extends ThemeColor ? true : never = true;

describe("ThemeRole", () => {
	it("accepts a role this module paints", () => {
		const role: ThemeRole = "toolTitle";
		expect(role).toBe("toolTitle");
	});
});
