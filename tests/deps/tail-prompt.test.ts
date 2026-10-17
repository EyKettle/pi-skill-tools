/**
 * The tail-prompt segment contract this extension contributes: the payload
 * field by field, and the two events the contract publishes.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
	buildSkillToolsSegment,
	TAIL_PROMPT_READY_EVENT,
	TAIL_PROMPT_REGISTER_EVENT,
} from "../../src/deps/tail-prompt";

describe("the skill-tools segment", () => {
	it("matches the contract field by field", () => {
		expect(buildSkillToolsSegment("a body\n")).toEqual({
			id: "skill-tools",
			position: 10,
			source: { kind: "text", text: "a body\n" },
		});
	});

	it("ships the text verbatim, empty included", () => {
		expect(buildSkillToolsSegment("")).toEqual({
			id: "skill-tools",
			position: 10,
			source: { kind: "text", text: "" },
		});
	});

	it("names the two events the contract publishes", () => {
		expect(TAIL_PROMPT_REGISTER_EVENT).toBe("tail-prompt:register");
		expect(TAIL_PROMPT_READY_EVENT).toBe("tail-prompt:ready");
	});
});

describe("the mirror", () => {
	it("imports nothing: the contract is mirrored, not imported", () => {
		const source = readFileSync(
			new URL("../../src/deps/tail-prompt.ts", import.meta.url),
			"utf8",
		);
		const specifiers = Array.from(
			source.matchAll(/from\s+"([^"]+)"/g),
			(match) => match[1],
		);

		expect(specifiers).toEqual([]);
	});
});
