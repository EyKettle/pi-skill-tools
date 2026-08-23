/**
 * Thrown-failure seam (shared stash + unknown synthesis).
 *
 * failError throws, so Pi wipes details and correlation.release() has
 * already run by render time. The stash is the recoverable payload a
 * renderer can read after that release, keyed by call identity and exact
 * tool name.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createFailure } from "../failure";
import { claim, clear, release } from "../correlation";
import { buildFailurePayload, buildListSkillsPayload } from "../transport";
import {
	clearThrownFailures,
	failEmptyIndex,
	failError,
	recoverThrownFailure,
	resolveCallPayload,
	unknownFailurePayload,
} from "../tools/shared";
import type { FailureSource } from "../tools/shared";

const notFound: FailureSource = {
	error: "no skill named 'x'",
	suggestions: "check the id with list_skills",
	code: "ID_NOT_FOUND",
	evidence: { kind: "none" },
};

beforeEach(() => {
	clear();
	clearThrownFailures();
});

describe("thrown-failure stash", () => {
	it("returns undefined when nothing was thrown for the call", () => {
		expect(recoverThrownFailure("call-1", "view_skill")).toBeUndefined();
	});

	it("recovers the failure payload for the owning call and tool after release", () => {
		expect(() => failError("call-1", "view_skill", notFound)).toThrow(
			"error: no skill named 'x'\nsuggestions: check the id with list_skills",
		);
		release("call-1");
		expect(claim("call-1", "view_skill")).toBeUndefined();
		expect(recoverThrownFailure("call-1", "view_skill")).toEqual(
			buildFailurePayload(
				"view_skill",
				createFailure("ID_NOT_FOUND", { evidence: { kind: "none" } }),
			),
		);
	});

	it("discloses nothing to a non-owning tool name", () => {
		expect(() => failError("call-1", "view_skill", notFound)).toThrow();
		release("call-1");
		expect(recoverThrownFailure("call-1", "list_skills")).toBeUndefined();
	});

	it("discloses nothing to a non-owning call identity", () => {
		expect(() => failError("call-1", "view_skill", notFound)).toThrow();
		release("call-1");
		expect(recoverThrownFailure("call-2", "view_skill")).toBeUndefined();
	});

	it("keeps the owner's payload after a non-owning recover", () => {
		expect(() => failError("call-1", "view_skill", notFound)).toThrow();
		release("call-1");
		expect(recoverThrownFailure("call-1", "list_skills")).toBeUndefined();
		expect(recoverThrownFailure("call-1", "view_skill")?.failure.code).toBe(
			"ID_NOT_FOUND",
		);
	});

	it("recovers the same payload on a second recover (redraw)", () => {
		expect(() => failError("call-1", "view_skill", notFound)).toThrow();
		release("call-1");
		const first = recoverThrownFailure("call-1", "view_skill");
		const second = recoverThrownFailure("call-1", "view_skill");
		expect(first).toEqual(second);
		expect(first?.failure.code).toBe("ID_NOT_FOUND");
	});

	it("keeps distinct calls independent", () => {
		expect(() => failError("call-1", "view_skill", notFound)).toThrow();
		expect(() => failEmptyIndex("call-2", "list_skills")).toThrow();
		release("call-1");
		release("call-2");
		expect(recoverThrownFailure("call-1", "view_skill")?.failure.code).toBe(
			"ID_NOT_FOUND",
		);
		expect(recoverThrownFailure("call-2", "list_skills")?.failure.code).toBe(
			"INDEX_EMPTY",
		);
		expect(recoverThrownFailure("call-1", "list_skills")).toBeUndefined();
		expect(recoverThrownFailure("call-2", "view_skill")).toBeUndefined();
	});

	it("a second throw for the same call overwrites; the renderer sees the latest payload", () => {
		expect(() => failError("call-1", "view_skill", notFound)).toThrow();
		expect(() => failEmptyIndex("call-1", "view_skill")).toThrow();
		release("call-1");
		expect(recoverThrownFailure("call-1", "view_skill")?.failure.code).toBe(
			"INDEX_EMPTY",
		);
	});

	it("clears every stashed payload", () => {
		expect(() => failError("call-1", "view_skill", notFound)).toThrow();
		expect(() => failEmptyIndex("call-2", "list_skills")).toThrow();
		clearThrownFailures();
		expect(recoverThrownFailure("call-1", "view_skill")).toBeUndefined();
		expect(recoverThrownFailure("call-2", "list_skills")).toBeUndefined();
	});
});

describe("unknown-failure synthesis", () => {
	it("builds ENTRY_UNREACHABLE through the closed payload family", () => {
		const payload = unknownFailurePayload("list_skills");
		expect(payload).toEqual(
			buildFailurePayload(
				"list_skills",
				createFailure("ENTRY_UNREACHABLE", { evidence: { kind: "none" } }),
			),
		);
	});

	it("names the tool that asked, not a shared placeholder", () => {
		expect(unknownFailurePayload("create_skill").tool).toBe("create_skill");
		expect(unknownFailurePayload("view_skill").tool).toBe("view_skill");
	});
});

describe("resolveCallPayload", () => {
	const listed = buildListSkillsPayload(0, null, []);
	const tagged = unknownFailurePayload("list_skill_tags");

	it("takes a fresh details payload first", () => {
		const payload = resolveCallPayload({
			tool: "list_skills",
			details: { payload: listed },
			retained: tagged,
			isError: true,
			toolCallId: "call-1",
		});
		expect(payload).toEqual(listed);
	});

	it("falls back to retained state when details have no payload", () => {
		const payload = resolveCallPayload({
			tool: "list_skills",
			details: {},
			retained: listed,
			isError: false,
			toolCallId: "call-1",
		});
		expect(payload).toEqual(listed);
	});

	it("falls back to the thrown-failure stash when details and state are empty", () => {
		expect(() => failError("call-1", "view_skill", notFound)).toThrow();
		release("call-1");
		const payload = resolveCallPayload({
			tool: "view_skill",
			details: undefined,
			retained: undefined,
			isError: true,
			toolCallId: "call-1",
		});
		expect(payload).toEqual(
			buildFailurePayload(
				"view_skill",
				createFailure("ID_NOT_FOUND", { evidence: { kind: "none" } }),
			),
		);
	});

	it("lets fresh details win over a retained payload", () => {
		const payload = resolveCallPayload({
			tool: "search_skills",
			details: { payload: listed },
			retained: tagged,
			isError: false,
			toolCallId: "call-1",
		});
		expect(payload).toBe(listed);
		expect(payload).not.toBe(tagged);
	});

	it("synthesizes unknown-failure when isError and nothing was recovered", () => {
		const payload = resolveCallPayload({
			tool: "create_skill",
			details: { payload: null },
			retained: undefined,
			isError: true,
			toolCallId: "call-1",
		});
		expect(payload).toEqual(unknownFailurePayload("create_skill"));
	});

	it("does not synthesize when the result is not an error", () => {
		const payload = resolveCallPayload({
			tool: "list_skills",
			details: undefined,
			retained: undefined,
			isError: false,
			toolCallId: undefined,
		});
		expect(payload).toBeUndefined();
	});

	it("does not hand one call's stashed payload to another tool", () => {
		expect(() => failError("call-1", "view_skill", notFound)).toThrow();
		release("call-1");
		const payload = resolveCallPayload({
			tool: "list_skills",
			details: undefined,
			retained: undefined,
			isError: true,
			toolCallId: "call-1",
		});
		expect(payload).toEqual(unknownFailurePayload("list_skills"));
		expect(payload).not.toEqual(
			buildFailurePayload(
				"view_skill",
				createFailure("ID_NOT_FOUND", { evidence: { kind: "none" } }),
			),
		);
	});

	it("treats a non-object details payload as missing", () => {
		const payload = resolveCallPayload({
			tool: "list_skills",
			details: { payload: "not-a-payload" },
			retained: listed,
			isError: false,
			toolCallId: "call-1",
		});
		expect(payload).toEqual(listed);
	});
});
