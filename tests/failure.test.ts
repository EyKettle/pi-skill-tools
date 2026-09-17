import { describe, expect, it } from "vitest";
import { createFailure, FAILURE_CODES, isFailureCode, recoveryFor } from "../failure";
import { FailureGuardError } from "../failure";

describe("failure vocabulary", () => {
	it("is a closed code set with no duplicates", () => {
		expect(new Set(FAILURE_CODES).size).toBe(FAILURE_CODES.length);
		// 21 owned failure origins across the six tools (identity parsing 3,
		// identity resolution 2, path containment 3, file reading 3, listing 1,
		// creation 7, tool seam 2).
		expect(FAILURE_CODES.length).toBe(21);
	});

	it("carries a code, an actionable recovery, and typed evidence", () => {
		const failure = createFailure("ID_NOT_FOUND", {
			evidence: { kind: "suggestions", suggestions: ["notepad"] },
		});
		expect(failure.code).toBe("ID_NOT_FOUND");
		expect(failure.recovery.length).toBeGreaterThan(0);
		expect(failure.evidence).toEqual({
			kind: "suggestions",
			suggestions: ["notepad"],
		});
	});

	it("defaults evidence to the none kind", () => {
		expect(createFailure("FILE_NOT_TEXT").evidence).toEqual({
			kind: "none",
		});
	});

	describe("guards", () => {
		it("rejects an unknown code", () => {
			expect(() => createFailure("BOGUS_CODE" as never)).toThrow(
				FailureGuardError,
			);
		});

		it("rejects an empty recovery", () => {
			expect(() => createFailure("ID_EMPTY_NAME", { recovery: "" })).toThrow(
				FailureGuardError,
			);
			expect(() => createFailure("ID_EMPTY_NAME", { recovery: "   " })).toThrow(
				FailureGuardError,
			);
		});

		it("rejects empty candidates evidence", () => {
			expect(() =>
				createFailure("ID_AMBIGUOUS", {
					evidence: { kind: "candidates", candidates: [] },
				}),
			).toThrow(FailureGuardError);
		});

		it("rejects a candidate without a non-empty id or path", () => {
			expect(() =>
				createFailure("ID_AMBIGUOUS", {
					evidence: {
						kind: "candidates",
						candidates: [{ id: "", path: "/x" }],
					},
				}),
			).toThrow(FailureGuardError);
			expect(() =>
				createFailure("ID_AMBIGUOUS", {
					evidence: {
						kind: "candidates",
						candidates: [{ id: "global:git", path: "" }],
					},
				}),
			).toThrow(FailureGuardError);
		});

		it("rejects empty suggestions evidence", () => {
			expect(() =>
				createFailure("ID_NOT_FOUND", {
					evidence: { kind: "suggestions", suggestions: [] },
				}),
			).toThrow(FailureGuardError);
		});

		it("rejects a suggestion that is not a non-empty string", () => {
			expect(() =>
				createFailure("ID_NOT_FOUND", {
					evidence: { kind: "suggestions", suggestions: [""] },
				}),
			).toThrow(FailureGuardError);
		});

		it("rejects an unknown evidence kind", () => {
			expect(() =>
				createFailure("ID_AMBIGUOUS", {
					evidence: { kind: "unknown" } as never,
				}),
			).toThrow(FailureGuardError);
		});
	});

	describe("origin coverage", () => {
		const ORIGIN_TO_CODE = {
			"parseSkillId empty name": "ID_EMPTY_NAME",
			"parseSkillId name pattern violation": "ID_INVALID_NAME",
			"parseSkillId invalid storage marker": "ID_INVALID_STORAGE",
			"resolveSkillId multiple matches": "ID_AMBIGUOUS",
			"resolveSkillId no matches": "ID_NOT_FOUND",
			"resolveSkillFile absolute ref path": "PATH_ABSOLUTE_REF",
			"resolveSkillFile escape": "PATH_ESCAPE",
			"resolveSkillFile unresolvable": "PATH_UNRESOLVABLE",
			"readSkillFile read failure": "FILE_UNREADABLE",
			"readSkillFile binary content": "FILE_NOT_TEXT",
			"readSkillFile missing frontmatter": "FILE_NO_FRONTMATTER",
			"listSkillFiles readdir failure": "DIR_UNREADABLE",
			"empty skill index": "INDEX_EMPTY",
			"createSkill package storage": "CREATE_PACKAGE_REJECTED",
			"createSkill invalid name": "CREATE_NAME_REJECTED",
			"createSkill duplicate name": "CREATE_NAME_EXISTS",
			"createSkill existing target dir": "CREATE_TARGET_EXISTS",
			"createSkill write failure": "CREATE_WRITE_FAILED",
			"createSkill post-write verify failure": "CREATE_VERIFY_FAILED",
			"create_skill ref path unsupported": "TOOL_REF_PATH_UNSUPPORTED",
			"resolved entry not in registry": "ENTRY_UNREACHABLE",
		} as const;

		it("maps every owned failure origin to exactly one closed code", () => {
			const codes = Object.values(ORIGIN_TO_CODE);
			expect(codes.length).toBe(FAILURE_CODES.length);
			expect(new Set(codes).size).toBe(codes.length);
			for (const code of codes) {
				expect(FAILURE_CODES).toContain(code);
			}
		});

		it("accepts the fixed recovery text for every code", () => {
			for (const code of FAILURE_CODES) {
				expect(recoveryFor(code).length).toBeGreaterThan(0);
			}
		});

		it("gives INDEX_EMPTY an agent-executable recovery", () => {
			expect(recoveryFor("INDEX_EMPTY")).toBe(
				"Ask the user to restart pi or run /reload so the before_agent_start hook fires before the next prompt.",
			);
		});

		it("isFailureCode accepts only closed-set members", () => {
			expect(isFailureCode("ID_NOT_FOUND")).toBe(true);
			expect(isFailureCode("BOGUS")).toBe(false);
			expect(isFailureCode(42)).toBe(false);
			expect(isFailureCode(undefined)).toBe(false);
		});
	});
});
