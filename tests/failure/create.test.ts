/**
 * Failure construction: every code builds with the evidence the architecture
 * table assigns it, and malformed evidence is refused (deny by default).
 */
import { describe, expect, it } from "vitest";
import { FAILURE_CODES, recoveryFor } from "../../src/failure/codes";
import {
	createFailure,
	FailureGuardError,
} from "../../src/failure/create";
import type {
	EvidenceByCode,
	FailureCode,
	FailureEvidence,
} from "../../src/failure/types";

/** One valid evidence value per code: the architecture table's 证据 column. */
const VALID_EVIDENCE: { [C in FailureCode]: EvidenceByCode[C] } = {
	ID_NAME_INVALID: { kind: "input", input: "Bad Name" },
	ID_LOCATION_UNKNOWN: {
		kind: "locations",
		locations: ["project", "package", "temp"],
		disabled: ["global"],
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
	NOT_LOADED: { kind: "loaded", id: "global:git", loaded: ["global:notepad"] },
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

describe("createFailure", () => {
	it("builds every code with its own recovery and evidence", () => {
		for (const code of FAILURE_CODES) {
			const failure = createFailure(code, VALID_EVIDENCE[code]);
			expect(failure.code).toBe(code);
			expect(failure.recovery).toBe(recoveryFor(code));
			expect(failure.evidence).toEqual(VALID_EVIDENCE[code]);
		}
	});

	it("defaults the recovery to the vocabulary's fixed text, never a caller's", () => {
		const failure = createFailure("PATH_NOT_FOUND", {
			kind: "path",
			path: "/skills/x/SKILL.md",
		});
		expect(failure.recovery).toBe(recoveryFor("PATH_NOT_FOUND"));
	});

	it("keeps a conflict target as either an id or a path", () => {
		const byPath = createFailure("TARGET_EXISTS", {
			kind: "conflict",
			target: { kind: "path", path: "/skills/x" },
		});
		expect(byPath.evidence).toEqual({
			kind: "conflict",
			target: { kind: "path", path: "/skills/x" },
		});
	});

	it("accepts an empty loaded list: cancelling when nothing is loaded is the case", () => {
		const failure = createFailure("NOT_LOADED", {
			kind: "loaded",
			id: "global:git",
			loaded: [],
		});
		expect(failure.evidence).toEqual({
			kind: "loaded",
			id: "global:git",
			loaded: [],
		});
	});

	describe("guards", () => {
		it("rejects a code outside the closed set", () => {
			expect(() =>
				createFailure(
					"ID_EMPTY_NAME" as never,
					{ kind: "input", input: "x" } as never,
				),
			).toThrow(FailureGuardError);
		});

		it("rejects missing evidence", () => {
			expect(() =>
				createFailure("PATH_NOT_FOUND", undefined as never),
			).toThrow(FailureGuardError);
			expect(() =>
				createFailure("PATH_NOT_FOUND", null as never),
			).toThrow(FailureGuardError);
		});

		it("rejects an evidence kind outside the vocabulary", () => {
			expect(() =>
				createFailure("PATH_NOT_FOUND", { kind: "mystery" } as never),
			).toThrow(FailureGuardError);
		});

		it("rejects empty strings wherever the evidence carries one", () => {
			const malformed: readonly FailureEvidence[] = [
				{ kind: "input", input: "  " },
				{ kind: "path", path: "" },
				{ kind: "pathError", path: "/x", error: " " },
				{ kind: "pathError", path: "", error: "EACCES" },
				{ kind: "section", section: "", path: "/x" },
				{ kind: "section", section: "When to Use", path: "" },
				{ kind: "filter", key: "", pattern: "x" },
				{ kind: "filter", key: "tags", pattern: "" },
				{ kind: "location", location: "" },
				{ kind: "loaded", id: "", loaded: [] },
			];
			for (const evidence of malformed) {
				expect(() =>
					createFailure("ID_NAME_INVALID", evidence as never),
				).toThrow(FailureGuardError);
			}
		});

		it("accepts an empty suggestion list: an empty index has no name to suggest", () => {
			const failure = createFailure("ID_NOT_FOUND", {
				kind: "suggestions",
				names: [],
			});
			expect(failure.evidence).toEqual({ kind: "suggestions", names: [] });
		});

		it("accepts an empty location list: every built-in path can be disabled", () => {
			const failure = createFailure("ID_LOCATION_UNKNOWN", {
				kind: "locations",
				locations: [],
				disabled: [],
			});
			expect(failure.evidence).toEqual({
				kind: "locations",
				locations: [],
				disabled: [],
			});
		});

		it("accepts a disabled list beside the registered one", () => {
			const failure = createFailure("ID_LOCATION_UNKNOWN", {
				kind: "locations",
				locations: ["project"],
				disabled: ["global"],
			});
			expect(failure.evidence).toEqual({
				kind: "locations",
				locations: ["project"],
				disabled: ["global"],
			});
		});

		it("still rejects an empty candidate list: ambiguity means at least two hits", () => {
			expect(() =>
				createFailure("ID_AMBIGUOUS", { kind: "candidates", ids: [] }),
			).toThrow(FailureGuardError);
		});

		it("rejects an empty list entry", () => {
			expect(() =>
				createFailure("ID_LOCATION_UNKNOWN", {
					kind: "locations",
					locations: ["global", ""],
					disabled: [],
				}),
			).toThrow(FailureGuardError);
			expect(() =>
				createFailure("ID_LOCATION_UNKNOWN", {
					kind: "locations",
					locations: ["global"],
					disabled: [""],
				}),
			).toThrow(FailureGuardError);
			expect(() =>
				createFailure("ID_NOT_FOUND", {
					kind: "suggestions",
					names: ["git", " "],
				}),
			).toThrow(FailureGuardError);
			expect(() =>
				createFailure("ID_AMBIGUOUS", {
					kind: "candidates",
					ids: ["global:git", ""],
				}),
			).toThrow(FailureGuardError);
		});

		it("rejects a conflict target that names nothing", () => {
			expect(() =>
				createFailure("TARGET_EXISTS", {
					kind: "conflict",
					target: { kind: "id", id: "" },
				}),
			).toThrow(FailureGuardError);
			expect(() =>
				createFailure("TARGET_EXISTS", {
					kind: "conflict",
					target: { kind: "path", path: " " },
				}),
			).toThrow(FailureGuardError);
			expect(() =>
				createFailure("TARGET_EXISTS", {
					kind: "conflict",
					target: { kind: "mystery" } as never,
				}),
			).toThrow(FailureGuardError);
		});

		it("names the guard error so an unexpected throw is distinguishable", () => {
			try {
				createFailure("PATH_NOT_FOUND", { kind: "path", path: "" });
				expect.unreachable("the guard did not run");
			} catch (error) {
				expect(error).toBeInstanceOf(FailureGuardError);
				expect((error as Error).name).toBe("FailureGuardError");
			}
		});
	});
});
