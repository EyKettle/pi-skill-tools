/**
 * The failure frame: the three lines, and the one sentence each evidence kind
 * renders.
 */
import { describe, expect, it } from "vitest";
import { failureText, reasonText } from "../../src/model-channel/failure-text";
import { createFailure } from "../../src/failure/create";
import { FAILURE_CODES, recoveryFor } from "../../src/failure/codes";
import type { EvidenceByCode, FailureCode } from "../../src/failure/types";

/** One valid evidence value per code: the architecture table's 证据 column. */
const EVIDENCE: { [C in FailureCode]: EvidenceByCode[C] } = {
	ID_NAME_INVALID: { kind: "input", input: "Bad Name" },
	ID_LOCATION_UNKNOWN: {
		kind: "locations",
		locations: ["global", "project"],
		disabled: ["temp"],
	},
	ID_NOT_FOUND: { kind: "suggestions", names: ["notepad", "git"] },
	ID_AMBIGUOUS: { kind: "candidates", ids: ["global:git", "project:git"] },
	REF_PATH_INVALID: { kind: "input", input: "../outside.md" },
	PATH_NOT_FOUND: { kind: "path", path: "/skills/x/SKILL.md" },
	READ_FAILED: {
		kind: "pathError",
		path: "/skills/x/SKILL.md",
		error: "EACCES: permission denied",
	},
	FILE_NOT_TEXT: { kind: "path", path: "/skills/x/logo.png" },
	SECTION_NOT_FOUND: {
		kind: "section",
		section: "When to Use",
		path: "/skills/x/SKILL.md",
	},
	FILTER_INVALID: { kind: "filter", key: "metadata.tags", pattern: "([a-z" },
	BATCH_EMPTY: { kind: "none" },
	NOT_LOADED: { kind: "loaded", id: "git", loaded: ["notepad"] },
	LOCATION_READ_ONLY: { kind: "location", location: "package" },
	TARGET_EXISTS: {
		kind: "conflict",
		target: { kind: "id", id: "global:git" },
	},
	WRITE_FAILED: {
		kind: "pathError",
		path: "/skills/x/SKILL.md",
		error: "ENOSPC: no space left on device",
	},
};

describe("failureText", () => {
	it("writes the three lines with the code's recovery", () => {
		const failure = createFailure("PATH_NOT_FOUND", {
			kind: "path",
			path: "/skills/x/SKILL.md",
		});
		expect(failureText(failure)).toBe(
			[
				"ErrorCode: PATH_NOT_FOUND",
				'Reason: The path "/skills/x/SKILL.md" cannot be read as requested.',
				`Suggestion: ${recoveryFor("PATH_NOT_FOUND")}`,
			].join("\n"),
		);
	});

	it("gives every code a three-line frame with a non-empty reason", () => {
		for (const code of FAILURE_CODES) {
			const text = failureText(createFailure(code, EVIDENCE[code]));
			const lines = text.split("\n");
			expect(lines, code).toHaveLength(3);
			expect(lines[0]).toBe(`ErrorCode: ${code}`);
			expect(lines[1].startsWith("Reason: ")).toBe(true);
			expect(lines[1].length).toBeGreaterThan("Reason: ".length);
			expect(lines[2]).toBe(`Suggestion: ${recoveryFor(code)}`);
		}
	});
});

describe("reasonText", () => {
	it("renders each evidence kind from its own facts", () => {
		expect(reasonText({ kind: "none" })).toBe(
			"No further detail was recorded.",
		);
		expect(reasonText({ kind: "input", input: "Bad Name" })).toBe(
			'The input "Bad Name" is not usable.',
		);
		expect(reasonText({ kind: "path", path: "/x" })).toBe(
			'The path "/x" cannot be read as requested.',
		);
		expect(reasonText({ kind: "pathError", path: "/x", error: "EACCES" })).toBe(
			'The path "/x" failed: EACCES',
		);
		expect(
			reasonText({ kind: "section", section: "When to Use", path: "/x" }),
		).toBe('The file "/x" has no section "When to Use".');
		expect(
			reasonText({ kind: "filter", key: "tags", pattern: "([a-z" }),
		).toBe('The filter "tags" has an invalid pattern: ([a-z');
		expect(reasonText({ kind: "location", location: "package" })).toBe(
			'The location "package" is read-only.',
		);
	});

	it("lists what a location or a suggestion search found", () => {
		expect(
			reasonText({
				kind: "locations",
				locations: ["global", "project"],
				disabled: [],
			}),
		).toBe(
			"The location is not registered; registered locations: global, project.",
		);
		expect(reasonText({ kind: "locations", locations: [], disabled: [] })).toBe(
			"No discovery location is registered.",
		);
		expect(
			reasonText({
				kind: "locations",
				locations: ["project"],
				disabled: ["global"],
			}),
		).toBe(
			"The location is not registered or is disabled; registered locations: project; disabled locations: global.",
		);
		expect(reasonText({ kind: "suggestions", names: ["git", "pi"] })).toBe(
			"No skill matches; the closest names are: git, pi.",
		);
		expect(reasonText({ kind: "suggestions", names: [] })).toBe(
			"No skill matches, and no close name exists.",
		);
		expect(
			reasonText({ kind: "candidates", ids: ["global:git", "project:git"] }),
		).toBe("Several skills match: global:git, project:git.");
	});

	it("names what is loaded when a cancel misses", () => {
		expect(
			reasonText({ kind: "loaded", id: "git", loaded: ["notepad"] }),
		).toBe('"git" is not loaded; loaded now: notepad.');
		expect(reasonText({ kind: "loaded", id: "git", loaded: [] })).toBe(
			'"git" is not loaded, and nothing is loaded.',
		);
	});

	it("names the object a conflict collided with", () => {
		expect(
			reasonText({
				kind: "conflict",
				target: { kind: "id", id: "global:git" },
			}),
		).toBe('"global:git" already exists.');
		expect(
			reasonText({
				kind: "conflict",
				target: { kind: "path", path: "/skills/git" },
			}),
		).toBe('"/skills/git" already exists.');
	});

	it("never repeats the code name, so the sentence is not a lookup", () => {
		for (const code of FAILURE_CODES) {
			expect(reasonText(EVIDENCE[code])).not.toContain(code);
		}
	});
});
