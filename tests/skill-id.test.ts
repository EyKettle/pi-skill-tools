import { describe, expect, it } from "vitest";
import {
	formatSkillId,
	parseSkillId,
	refPathOf,
	resolveSkillId,
} from "../skill-id";

describe("parseSkillId", () => {
	it("parses a bare name", () => {
		expect(parseSkillId("notepad")).toEqual({
			storage: undefined,
			name: "notepad",
			refPath: undefined,
		});
	});

	it("parses a storage prefix", () => {
		expect(parseSkillId("global:notepad")).toEqual({
			storage: "global",
			name: "notepad",
			refPath: undefined,
		});
	});

	it("parses the temp storage prefix", () => {
		expect(parseSkillId("temp:identity")).toEqual({
			storage: "temp",
			name: "identity",
			refPath: undefined,
		});
	});

	it("parses a ref path with nested segments", () => {
		expect(parseSkillId("global:skill-authoring/references/a/b.md")).toEqual({
			storage: "global",
			name: "skill-authoring",
			refPath: "references/a/b.md",
		});
	});

	it("parses a ref path without a storage prefix", () => {
		expect(parseSkillId("notepad/references/x.md")).toEqual({
			storage: undefined,
			name: "notepad",
			refPath: "references/x.md",
		});
	});

	it("treats an unknown prefix as part of nothing and errors", () => {
		expect(parseSkillId("bogus:notepad").error).toBeDefined();
	});

	it("rejects an empty name", () => {
		expect(parseSkillId("global:").error).toBeDefined();
	});

	it("rejects a name with invalid characters", () => {
		expect(parseSkillId("Global_Skill").error).toBeDefined();
	});
});

describe("formatSkillId", () => {
	it("renders storage and name", () => {
		expect(formatSkillId("global", "notepad")).toBe("global:notepad");
	});

	it("renders a ref path", () => {
		expect(formatSkillId("package", "pi-subagents", "references/a.md")).toBe(
			"package:pi-subagents/references/a.md",
		);
	});
});

describe("refPathOf", () => {
	it("returns undefined for a skill-only id", () => {
		expect(refPathOf("git")).toBeUndefined();
	});

	it("returns the ref path for a storage-prefixed document id", () => {
		expect(refPathOf("global:git/references/GUIDE.md")).toBe(
			"references/GUIDE.md",
		);
	});

	it("returns undefined for a malformed id", () => {
		expect(refPathOf("a:b:c")).toBeUndefined();
	});

	it("returns undefined for a non-string id", () => {
		expect(refPathOf(123)).toBeUndefined();
		expect(refPathOf(null)).toBeUndefined();
		expect(refPathOf(undefined)).toBeUndefined();
		expect(refPathOf({})).toBeUndefined();
	});
});

describe("resolveSkillId", () => {
	const entries = [
		{
			storage: "global" as const,
			name: "coding",
			filePath: "/g/coding/SKILL.md",
		},
		{
			storage: "project" as const,
			name: "coding",
			filePath: "/p/coding/SKILL.md",
		},
		{
			storage: "global" as const,
			name: "notepad",
			filePath: "/g/notepad/SKILL.md",
		},
		{
			storage: "global" as const,
			name: "notepds",
			filePath: "/g/notepds/SKILL.md",
		},
	];

	it("resolves a unique bare name", () => {
		expect(resolveSkillId(entries, undefined, "notepad")).toEqual({
			storage: "global",
			name: "notepad",
		});
	});

	it("errors with every candidate id when a bare name is ambiguous", () => {
		const result = resolveSkillId(entries, undefined, "coding");
		expect(result.error).toContain("global:coding");
		expect(result.error).toContain("project:coding");
	});

	it("resolves an ambiguous name when a storage prefix is given", () => {
		expect(resolveSkillId(entries, "project", "coding")).toEqual({
			storage: "project",
			name: "coding",
		});
	});

	it("resolves a same-storage shadow duplicate via an explicit prefix without ambiguity", () => {
		// A §3.3 shadow copy shares the winner's id (storage:name); it is the
		// same skill, not a second candidate. An explicit prefix must resolve
		// uniquely (design.md §4) instead of reporting ambiguity.
		const withShadow = [
			...entries,
			{
				storage: "global" as const,
				name: "notepad",
				filePath: "/g-shadow/notepad/SKILL.md",
			},
		];
		expect(resolveSkillId(withShadow, "global", "notepad")).toEqual({
			storage: "global",
			name: "notepad",
		});
	});

	it("keeps bare-name ambiguity across distinct locations when a shadow copy exists", () => {
		// Dedupe merges same-id copies only; genuinely distinct locations must
		// still report ambiguity for a bare name, and the candidate list must
		// not repeat the shadowed id.
		const withShadowAndDistinct = [
			...entries,
			{
				storage: "global" as const,
				name: "notepad",
				filePath: "/g-shadow/notepad/SKILL.md",
			},
			{
				storage: "project" as const,
				name: "notepad",
				filePath: "/p/notepad/SKILL.md",
			},
		];
		const result = resolveSkillId(withShadowAndDistinct, undefined, "notepad");
		expect(result.error).toBeDefined();
		if (result.error === undefined) return;
		expect(result.code).toBe("ID_AMBIGUOUS");
		expect(result.evidence).toEqual({
			kind: "candidates",
			candidates: [
				{ id: "global:notepad", path: "/g/notepad/SKILL.md" },
				{ id: "project:notepad", path: "/p/notepad/SKILL.md" },
			],
		});
	});

	it("suggests near names when nothing matches", () => {
		const result = resolveSkillId(entries, undefined, "notepd");
		expect(result.error).toContain("notepad");
	});

	it("carries ID_EMPTY_NAME on an empty parsed name", () => {
		const result = parseSkillId("global:");
		expect(result.error).toBeDefined();
		expect(result.code).toBe("ID_EMPTY_NAME");
		expect(result.evidence).toEqual({ kind: "none" });
	});

	it("carries ID_INVALID_NAME on an invalid parsed name", () => {
		const result = parseSkillId("Global_Skill");
		expect(result.error).toBeDefined();
		expect(result.code).toBe("ID_INVALID_NAME");
		expect(result.evidence).toEqual({ kind: "none" });
	});

	it("reports a non-marker prefix as an invalid name", () => {
		const result = parseSkillId("bogus:notepad");
		expect(result.error).toBeDefined();
		expect(result.code).toBe("ID_INVALID_NAME");
		expect(result.evidence).toEqual({ kind: "none" });
	});

	it("carries ID_INVALID_STORAGE when a colon-carrying ref path makes the prefix look like a marker", () => {
		const result = parseSkillId("git/references/a:b.md");
		expect(result.error).toBeDefined();
		expect(result.error).toContain("storage marker");
		expect(result.code).toBe("ID_INVALID_STORAGE");
		expect(result.evidence).toEqual({ kind: "none" });
	});

	it("carries ID_AMBIGUOUS with candidate entries holding verified paths", () => {
		const result = resolveSkillId(entries, undefined, "coding");
		expect(result.error).toBeDefined();
		if (result.error === undefined) return;
		expect(result.code).toBe("ID_AMBIGUOUS");
		expect(result.evidence).toEqual({
			kind: "candidates",
			candidates: [
				{ id: "global:coding", path: "/g/coding/SKILL.md" },
				{ id: "project:coding", path: "/p/coding/SKILL.md" },
			],
		});
	});

	it("carries ID_NOT_FOUND with candidate entries holding verified paths", () => {
		const result = resolveSkillId(entries, undefined, "notepd");
		expect(result.error).toBeDefined();
		if (result.error === undefined) return;
		expect(result.code).toBe("ID_NOT_FOUND");
		expect(result.evidence).toEqual({
			kind: "candidates",
			candidates: [
				{ id: "global:notepad", path: "/g/notepad/SKILL.md" },
				{ id: "global:notepds", path: "/g/notepds/SKILL.md" },
			],
		});
	});
});
