/**
 * Task 4 correlation suite (plan Task 4, design.md §错误处理) — the per-call
 * failure store plus the shared tool seam. A structured failure is associated
 * with exactly one tool call and retrievable only by that call's own tool; a
 * second association for one unclaimed call leaves neither retrievable;
 * release and clear are asserted. Isolation is by call identity, not tool
 * name; a claim additionally requires an exact tool-name match.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createFailure, recoveryFor } from "../failure";
import type { Failure } from "../failure";
import { associate, claim, clear, release } from "../correlation";
import { failEmptyIndex, failError } from "../tools/shared";
import type { FailureSource } from "../tools/shared";

beforeEach(() => {
	clear();
});

describe("correlation store", () => {
	it("returns undefined when nothing is associated with the call", () => {
		expect(claim("call-1", "view_skill")).toBeUndefined();
	});

	it("returns the failure only to the owning call and tool", () => {
		const failure = createFailure("ID_NOT_FOUND");
		associate("call-1", "view_skill", failure);
		expect(claim("call-1", "view_skill")).toEqual(failure);
	});

	it("discloses nothing to a different tool name", () => {
		associate("call-1", "view_skill", createFailure("ID_NOT_FOUND"));
		expect(claim("call-1", "list_skills")).toBeUndefined();
	});

	it("isolates by call identity, not by tool name", () => {
		associate("call-1", "view_skill", createFailure("ID_NOT_FOUND"));
		// same tool name, different call — nothing crosses the call boundary
		expect(claim("call-2", "view_skill")).toBeUndefined();
	});

	it("leaves neither failure retrievable after a second association for one unclaimed call", () => {
		associate("call-1", "view_skill", createFailure("ID_NOT_FOUND"));
		associate("call-1", "view_skill", createFailure("FILE_UNREADABLE"));
		expect(claim("call-1", "view_skill")).toBeUndefined();
	});

	it("keeps distinct calls independent", () => {
		const a = createFailure("ID_NOT_FOUND");
		const b = createFailure("FILE_UNREADABLE");
		associate("call-1", "view_skill", a);
		associate("call-2", "list_skill_files", b);
		expect(claim("call-1", "view_skill")).toEqual(a);
		expect(claim("call-2", "list_skill_files")).toEqual(b);
	});

	it("release removes the association", () => {
		associate("call-1", "view_skill", createFailure("ID_NOT_FOUND"));
		release("call-1");
		expect(claim("call-1", "view_skill")).toBeUndefined();
	});

	it("clear removes every association", () => {
		associate("call-1", "view_skill", createFailure("ID_NOT_FOUND"));
		associate("call-2", "list_skills", createFailure("INDEX_EMPTY"));
		clear();
		expect(claim("call-1", "view_skill")).toBeUndefined();
		expect(claim("call-2", "list_skills")).toBeUndefined();
	});

	it("claim is idempotent-safe: repeated claims return the same failure", () => {
		const failure = createFailure("ID_NOT_FOUND");
		associate("call-1", "view_skill", failure);
		expect(claim("call-1", "view_skill")).toEqual(failure);
		expect(claim("call-1", "view_skill")).toEqual(failure);
	});
});

describe("shared tool seam (failError)", () => {
	it("associates the failure with the call and throws the model text from the same source", () => {
		const source: FailureSource = {
			error: "no skill named 'x'",
			code: "ID_NOT_FOUND",
			evidence: { kind: "none" },
		};
		expect(() => failError("call-1", "view_skill", source)).toThrow(
			"error: no skill named 'x'\nsuggestions: Check the spelling with list_skills; a bare name resolves across all locations.",
		);
		// structured channel derives from the same source object
		expect(claim("call-1", "view_skill")).toEqual({
			code: "ID_NOT_FOUND",
			recovery: recoveryFor("ID_NOT_FOUND"),
			evidence: { kind: "none" },
		});
	});

	it("derives the failure recovery from recoveryFor(code)", () => {
		const source: FailureSource = {
			error:
				"skill id 'x' is ambiguous (2 matches); qualify with a storage prefix: global:x, project:x",
			code: "ID_AMBIGUOUS",
			evidence: {
				kind: "candidates",
				candidates: [
					{ id: "global:x", path: "/a" },
					{ id: "project:x", path: "/b" },
				],
			},
		};
		expect(() => failError("call-1", "view_skill", source)).toThrow(
			"error: skill id 'x' is ambiguous (2 matches); qualify with a storage prefix: global:x, project:x\nsuggestions: Qualify the name with a storage prefix to pick one location.",
		);
		const failure = claim("call-1", "view_skill") as Failure;
		expect(failure.code).toBe("ID_AMBIGUOUS");
		expect(failure.recovery).toBe(recoveryFor("ID_AMBIGUOUS"));
		expect(failure.evidence).toEqual(source.evidence);
	});

	it("does not leak the associated failure to a different tool", () => {
		const source: FailureSource = {
			error: "boom",
			code: "FILE_UNREADABLE",
			evidence: { kind: "none" },
		};
		expect(() => failError("call-1", "view_skill", source)).toThrow(
			"error: boom\nsuggestions: Check the file's existence and read permissions.",
		);
		expect(claim("call-1", "list_skills")).toBeUndefined();
	});

	it("failEmptyIndex associates INDEX_EMPTY and keeps the canonical empty-index text", () => {
		expect(() => failEmptyIndex("call-1", "list_skills")).toThrow(
			"error: skill index is not yet populated; the before_agent_start cache has not captured any skills\n" +
				"suggestions: Ask the user to restart pi or run /reload so the before_agent_start hook fires before the next prompt",
		);
		const failure = claim("call-1", "list_skills") as Failure;
		expect(failure.code).toBe("INDEX_EMPTY");
	});
});
