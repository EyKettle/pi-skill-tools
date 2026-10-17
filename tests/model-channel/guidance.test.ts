/**
 * The appended guidance: the document's two lines, verbatim.
 */
import { describe, expect, it } from "vitest";
import { GUIDANCE_TEXT } from "../../src/model-channel/guidance";

describe("GUIDANCE_TEXT", () => {
	it("carries the document's two lines word for word", () => {
		expect(GUIDANCE_TEXT).toBe(
			"Load skills with skill tools. Read tool will truncated long files and repeat contents you already have.\n" +
				"Skill tools ensures context uniqueness of skill documents. Feel free to use skill tools.",
		);
	});

	it("states the reason for switching and the reassurance, in two lines", () => {
		const lines = GUIDANCE_TEXT.split("\n");
		expect(lines).toHaveLength(2);
		expect(lines[0]).toContain("skill tools");
		expect(lines[1]).toContain("context uniqueness");
	});
});
