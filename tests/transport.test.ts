import { describe, expect, it } from "vitest";
import {
	assertValidPayload,
	buildCreateSkillPayload,
	buildFailurePayload,
	buildListSkillsPayload,
	buildListSkillFilesPayload,
	buildListSkillTagsPayload,
	buildSearchSkillsPayload,
	buildViewSkillPayload,
	buildPeekSkillPayload,
	TRANSPORT_VERSION,
	TransportGuardError,
} from "../transport";
import { createFailure } from "../failure";

describe("result transport", () => {
	it("carries the versioned envelope shape", () => {
		const payload = buildListSkillsPayload(3, null, [
			{ id: "git", filePath: "/skills/git/SKILL.md" },
		]);
		expect(payload.version).toBe(TRANSPORT_VERSION);
		expect(payload.tool).toBe("list_skills");
		expect(payload.outcome).toBe("success");
		expect(payload.data.count).toBe(3);
	});

	it("rejects an unsupported version", () => {
		const payload = {
			version: 0,
			tool: "list_skills",
			outcome: "success",
			data: { count: 1, location: null, skills: [] },
		};
		expect(() => assertValidPayload(payload)).toThrow(TransportGuardError);
	});

	it("rejects an unknown tool name", () => {
		const payload = {
			version: 1,
			tool: "list_books",
			outcome: "success",
			data: { count: 1, location: null, skills: [] },
		};
		expect(() => assertValidPayload(payload)).toThrow(TransportGuardError);
	});

	it("rejects an unknown data key (closed family)", () => {
		const payload = {
			version: 1,
			tool: "list_skills",
			outcome: "success",
			data: { count: 1, location: null, skills: [], extra: true },
		};
		expect(() => assertValidPayload(payload)).toThrow(TransportGuardError);
	});

	it("builds the create payload from the content actually written", () => {
		const content = "---\nname: demo\n---\n\nBody\n";
		const payload = buildCreateSkillPayload(
			"demo",
			"/root/demo/SKILL.md",
			content,
		);
		expect(payload.outcome).toBe("success");
		expect(payload.data.content).toBe(content);
		expect(payload.data.lines).toBe(5);
		expect(payload.data.bytes).toBe(Buffer.byteLength(content, "utf8"));
		assertValidPayload(payload);
	});

	it("nests the structured failure in the failure outcome", () => {
		const failure = createFailure("ID_NOT_FOUND", {
			evidence: { kind: "suggestions", suggestions: ["notepad"] },
		});
		const payload = buildFailurePayload("view_skill", failure);
		expect(payload.outcome).toBe("failure");
		expect(payload.failure.code).toBe("ID_NOT_FOUND");
		assertValidPayload(payload);
	});
});

describe("per-tool payload construction", () => {
	it("builds the list_skill_tags payload with the tag stream", () => {
		const payload = buildListSkillTagsPayload(2, null, ["alpha", "beta"]);
		expect(payload.tool).toBe("list_skill_tags");
		expect(payload.outcome).toBe("success");
		expect(payload.data.tags).toEqual(["alpha", "beta"]);
		assertValidPayload(payload);
	});

	it("builds the search payload with filters and matches", () => {
		const payload = buildSearchSkillsPayload(1, "global", { tags: ["git"] }, [
			{ id: "global:git", filePath: "/x/git/SKILL.md" },
		]);
		expect(payload.data.filters).toEqual({ tags: ["git"] });
		assertValidPayload(payload);
	});

	it("builds the list_skill_files payload with target and files", () => {
		const payload = buildListSkillFilesPayload(2, "global:git", [
			{ refId: "references/GUIDE.md", path: "/x/git/references/GUIDE.md" },
			{ refId: "scripts/demo.sh", path: "/x/git/scripts/demo.sh" },
		]);
		expect(payload.data.targetId).toBe("global:git");
		assertValidPayload(payload);
	});

	it("builds the view payload with the display id and content", () => {
		const payload = buildViewSkillPayload(
			"git",
			"/x/git/SKILL.md",
			"---\nname: git\n---\n",
		);
		expect(payload.data.id).toBe("git");
		expect(payload.data.content).toBe("---\nname: git\n---\n");
		assertValidPayload(payload);
	});
});

describe("view_skill empty content", () => {
	it("accepts empty content as a complete answer", () => {
		const payload = buildViewSkillPayload("git", "/x/git/SKILL.md", "");
		expect(() => assertValidPayload(payload)).not.toThrow();
	});

	it("still rejects non-string content", () => {
		const payload = {
			version: 1,
			tool: "view_skill",
			outcome: "success",
			data: { id: "git", path: "/x/git/SKILL.md", content: 42 },
		};
		expect(() => assertValidPayload(payload)).toThrow(TransportGuardError);
	});

	it("still rejects an empty id", () => {
		const payload = {
			version: 1,
			tool: "view_skill",
			outcome: "success",
			data: { id: "", path: "/x/git/SKILL.md", content: "" },
		};
		expect(() => assertValidPayload(payload)).toThrow(TransportGuardError);
	});

	it("still rejects an empty path", () => {
		const payload = {
			version: 1,
			tool: "view_skill",
			outcome: "success",
			data: { id: "git", path: "", content: "" },
		};
		expect(() => assertValidPayload(payload)).toThrow(TransportGuardError);
	});
});

describe("empty outcome semantics", () => {
	it("marks a zero count as the empty outcome", () => {
		const payload = buildListSkillsPayload(0, null, []);
		expect(payload.outcome).toBe("empty");
		assertValidPayload(payload);
	});

	it("keeps a non-empty collection a success outcome", () => {
		const payload = buildListSkillsPayload(1, null, [
			{ id: "git", filePath: "/x/git/SKILL.md" },
		]);
		expect(payload.outcome).toBe("success");
	});

	it("rejects an empty outcome for a non-zero count", () => {
		const payload = {
			version: 1,
			tool: "list_skills",
			outcome: "empty",
			data: { count: 2, location: null, skills: [] },
		};
		expect(() => assertValidPayload(payload)).toThrow(TransportGuardError);
	});

	it("rejects an outcome that is not success or empty", () => {
		const payload = {
			version: 1,
			tool: "list_skills",
			outcome: "pending",
			data: { count: 1, location: null, skills: [] },
		};
		expect(() => assertValidPayload(payload)).toThrow(TransportGuardError);
	});
});

describe("malformed nested values", () => {
	it("rejects a negative count", () => {
		const payload = {
			version: 1,
			tool: "list_skills",
			outcome: "success",
			data: { count: -1, location: null, skills: [] },
		};
		expect(() => assertValidPayload(payload)).toThrow(TransportGuardError);
	});

	it("rejects a skill row missing its path", () => {
		const payload = {
			version: 1,
			tool: "list_skills",
			outcome: "success",
			data: { count: 1, location: null, skills: [{ id: "git" }] },
		};
		expect(() => assertValidPayload(payload)).toThrow(TransportGuardError);
	});

	it("accepts temp as a location enum", () => {
		const payload = {
			version: 1,
			tool: "list_skills",
			outcome: "empty",
			data: { count: 0, location: "temp", skills: [] },
		};
		expect(() => assertValidPayload(payload)).not.toThrow();
	});

	it("rejects an unknown location enum", () => {
		const payload = {
			version: 1,
			tool: "list_skills",
			outcome: "success",
			data: { count: 1, location: "workspace", skills: [] },
		};
		expect(() => assertValidPayload(payload)).toThrow(TransportGuardError);
	});

	it("rejects tags that are not strings", () => {
		const payload = {
			version: 1,
			tool: "list_skill_tags",
			outcome: "success",
			data: { count: 1, location: null, tags: [42] },
		};
		expect(() => assertValidPayload(payload)).toThrow(TransportGuardError);
	});

	it("rejects a count that does not match the collection length", () => {
		const payload = {
			version: 1,
			tool: "list_skills",
			outcome: "success",
			data: {
				count: 2,
				location: null,
				skills: [{ id: "git", filePath: "/x/git/SKILL.md" }],
			},
		};
		expect(() => assertValidPayload(payload)).toThrow(TransportGuardError);
	});

	it("rejects an unknown key in view_skill data (closed family)", () => {
		const payload = {
			version: 1,
			tool: "view_skill",
			outcome: "success",
			data: {
				id: "git",
				path: "/x/git/SKILL.md",
				content: "text",
				format: "full",
			},
		};
		expect(() => assertValidPayload(payload)).toThrow(TransportGuardError);
	});

	it("rejects a failure code outside the closed set", () => {
		const payload = {
			version: 1,
			tool: "view_skill",
			outcome: "failure",
			failure: {
				code: "BOGUS",
				recovery: "recover",
				evidence: { kind: "none" },
			},
		};
		expect(() => assertValidPayload(payload)).toThrow(TransportGuardError);
	});

	it("rejects malformed failure evidence", () => {
		const payload = {
			version: 1,
			tool: "view_skill",
			outcome: "failure",
			failure: {
				code: "ID_NOT_FOUND",
				recovery: "recover",
				evidence: { kind: "candidates", candidates: [{ id: "git" }] },
			},
		};
		expect(() => assertValidPayload(payload)).toThrow(TransportGuardError);
	});

	it("builds and validates a peek_skill payload", () => {
		const payload = buildPeekSkillPayload(
			"git",
			"/skills/git/SKILL.md",
			"## When to Use\n- doing git stuff",
		);
		expect(payload.version).toBe(TRANSPORT_VERSION);
		expect(payload.tool).toBe("peek_skill");
		expect(payload.outcome).toBe("success");
		expect(payload.data.id).toBe("git");
		expect(payload.data.path).toBe("/skills/git/SKILL.md");
		expect(payload.data.content).toBe("## When to Use\n- doing git stuff");
		expect(payload.data.lines).toBe(2);
		expect(payload.data.bytes).toBe(Buffer.byteLength(payload.data.content, "utf8"));
		expect(() => assertValidPayload(payload)).not.toThrow();
	});

	it("rejects peek_skill with mismatched lines or bytes count", () => {
		const payload = {
			version: 1,
			tool: "peek_skill",
			outcome: "success",
			data: {
				id: "git",
				path: "/skills/git/SKILL.md",
				content: "## When to Use\nLine 2",
				lines: 99,
				bytes: 10,
			},
		};
		expect(() => assertValidPayload(payload)).toThrow(TransportGuardError);
	});
});

describe("scope distinction", () => {
	it("distinguishes a selected scope from no selection", () => {
		const all = buildListSkillsPayload(1, null, []);
		const global = buildListSkillsPayload(1, "global", []);
		expect(all.data.location).toBeNull();
		expect(global.data.location).toBe("global");
		expect(all.data.location).not.toBe(global.data.location);
	});
});
