/**
 * Skill IDs: the `{location}:{name}/{type}/{file}` grammar, the display
 * folding rule, and name resolution against the index.
 */
import { describe, expect, it } from "vitest";
import {
	displaySkillId,
	formatSkillId,
	parseSkillId,
	resolveSkillId,
} from "../../src/discovery/skill-id";
import { recoveryFor } from "../../src/failure/codes";
import type { Index, RegistryEntry } from "../../src/discovery/types";

const LOCATIONS = ["global", "project", "package", "temp"] as const;

function entry(location: string, name: string): RegistryEntry {
	return {
		location,
		name,
		id: formatSkillId(location, name),
		filePath: `/${location}/${name}/SKILL.md`,
		baseDir: `/${location}/${name}`,
		frontmatter: {},
	};
}

function indexOf(entries: readonly RegistryEntry[]): Index {
	return {
		locations: LOCATIONS.map((id) => ({ id, writable: false })),
		entries,
	};
}

describe("parseSkillId", () => {
	it("parses a bare name", () => {
		expect(parseSkillId("notepad", LOCATIONS)).toEqual({
			ok: true,
			value: { location: undefined, name: "notepad", refPath: undefined },
		});
	});

	it("parses a registered location prefix", () => {
		expect(parseSkillId("global:notepad", LOCATIONS)).toEqual({
			ok: true,
			value: { location: "global", name: "notepad", refPath: undefined },
		});
	});

	it("parses a configured location prefix", () => {
		expect(parseSkillId("extra:notepad", [...LOCATIONS, "extra"])).toEqual({
			ok: true,
			value: { location: "extra", name: "notepad", refPath: undefined },
		});
	});

	it("parses a ref path with nested segments", () => {
		expect(
			parseSkillId("global:skill-authoring/references/a/b.md", LOCATIONS),
		).toEqual({
			ok: true,
			value: {
				location: "global",
				name: "skill-authoring",
				refPath: "references/a/b.md",
			},
		});
	});

	it("parses a ref path without a location prefix", () => {
		expect(parseSkillId("notepad/references/x.md", LOCATIONS)).toEqual({
			ok: true,
			value: {
				location: undefined,
				name: "notepad",
				refPath: "references/x.md",
			},
		});
	});

	it("keeps a colon in the ref path out of the prefix decision", () => {
		expect(parseSkillId("git/references/a:b.md", LOCATIONS)).toEqual({
			ok: true,
			value: {
				location: undefined,
				name: "git",
				refPath: "references/a:b.md",
			},
		});
	});

	it("reports an unregistered prefix with the registered locations", () => {
		const parsed = parseSkillId("bogus:notepad", LOCATIONS);
		expect(parsed.ok).toBe(false);
		if (parsed.ok) return;
		expect(parsed.failure.code).toBe("ID_LOCATION_UNKNOWN");
		expect(parsed.failure.recovery).toBe(recoveryFor("ID_LOCATION_UNKNOWN"));
		expect(parsed.failure.evidence).toEqual({
			kind: "locations",
			locations: [...LOCATIONS],
		});
	});

	it("reports an empty name with the raw input", () => {
		const parsed = parseSkillId("global:", LOCATIONS);
		expect(parsed.ok).toBe(false);
		if (parsed.ok) return;
		expect(parsed.failure.code).toBe("ID_NAME_INVALID");
		expect(parsed.failure.evidence).toEqual({
			kind: "input",
			input: "global:",
		});
	});

	it("reports a name outside the character set", () => {
		for (const raw of ["Global_Skill", "notepad.md", ":name"]) {
			const parsed = parseSkillId(raw, LOCATIONS);
			expect(parsed.ok).toBe(false);
			if (parsed.ok) continue;
			expect(parsed.failure.code).toBe(
				raw.includes(":") ? "ID_LOCATION_UNKNOWN" : "ID_NAME_INVALID",
			);
			expect(parsed.failure.evidence).toEqual(
				raw.includes(":")
					? { kind: "locations", locations: [...LOCATIONS] }
					: { kind: "input", input: raw },
			);
		}
	});

	it("drops a trailing separator that names no file", () => {
		expect(parseSkillId("notepad/", LOCATIONS)).toEqual({
			ok: true,
			value: { location: undefined, name: "notepad", refPath: undefined },
		});
	});
});

describe("formatSkillId", () => {
	it("renders location and name", () => {
		expect(formatSkillId("global", "notepad")).toBe("global:notepad");
	});

	it("renders a ref path", () => {
		expect(formatSkillId("package", "pi-subagents", "references/a.md")).toBe(
			"package:pi-subagents/references/a.md",
		);
	});
});

describe("displaySkillId", () => {
	it("folds the location prefix when no other location has the name", () => {
		const index = indexOf([entry("global", "notepad")]);
		expect(displaySkillId(index, index.entries[0])).toBe("notepad");
	});

	it("keeps the location prefix when the name exists elsewhere", () => {
		const index = indexOf([entry("global", "coding"), entry("project", "coding")]);
		expect(index.entries.map((e) => displaySkillId(index, e))).toEqual([
			"global:coding",
			"project:coding",
		]);
	});

	it("appends the ref path and folds nothing else", () => {
		const index = indexOf([entry("global", "notepad")]);
		expect(
			displaySkillId(index, index.entries[0], "references/x.md"),
		).toBe("notepad/references/x.md");
	});
});

describe("resolveSkillId", () => {
	const index = indexOf([
		entry("global", "coding"),
		entry("project", "coding"),
		entry("global", "notepad"),
		entry("global", "notepds"),
	]);

	it("resolves a unique bare name", () => {
		const resolved = resolveSkillId(index, "notepad");
		expect(resolved.ok).toBe(true);
		if (!resolved.ok) return;
		expect(resolved.entry.id).toBe("global:notepad");
		expect(resolved.refPath).toBeUndefined();
	});

	it("carries the ref path through unvalidated", () => {
		const resolved = resolveSkillId(index, "notepad/references/x.md");
		expect(resolved.ok).toBe(true);
		if (!resolved.ok) return;
		expect(resolved.entry.id).toBe("global:notepad");
		expect(resolved.refPath).toBe("references/x.md");
	});

	it("resolves an ambiguous name when a location prefix is given", () => {
		const resolved = resolveSkillId(index, "project:coding");
		expect(resolved.ok).toBe(true);
		if (!resolved.ok) return;
		expect(resolved.entry.id).toBe("project:coding");
	});

	it("reports ambiguity with every candidate's full id", () => {
		const resolved = resolveSkillId(index, "coding");
		expect(resolved.ok).toBe(false);
		if (resolved.ok) return;
		expect(resolved.failure.code).toBe("ID_AMBIGUOUS");
		expect(resolved.failure.evidence).toEqual({
			kind: "candidates",
			ids: ["global:coding", "project:coding"],
		});
	});

	it("suggests the nearest names when nothing matches", () => {
		const resolved = resolveSkillId(index, "notepd");
		expect(resolved.ok).toBe(false);
		if (resolved.ok) return;
		expect(resolved.failure.code).toBe("ID_NOT_FOUND");
		expect(resolved.failure.evidence).toEqual({
			kind: "suggestions",
			names: ["notepad", "notepds"],
		});
	});

	it("scopes suggestions to the requested location", () => {
		const resolved = resolveSkillId(index, "project:notepd");
		expect(resolved.ok).toBe(false);
		if (resolved.ok) return;
		expect(resolved.failure.evidence).toEqual({
			kind: "suggestions",
			names: [],
		});
	});

	it("reports an empty index without inventing a suggestion", () => {
		const resolved = resolveSkillId(indexOf([]), "notepad");
		expect(resolved.ok).toBe(false);
		if (resolved.ok) return;
		expect(resolved.failure.code).toBe("ID_NOT_FOUND");
		expect(resolved.failure.evidence).toEqual({
			kind: "suggestions",
			names: [],
		});
	});

	it("forwards the parse failure for an unregistered location", () => {
		const resolved = resolveSkillId(index, "bogus:notepad");
		expect(resolved.ok).toBe(false);
		if (resolved.ok) return;
		expect(resolved.failure.code).toBe("ID_LOCATION_UNKNOWN");
	});

	it("reports an unregistered location when none is registered at all", () => {
		const resolved = resolveSkillId(
			{ locations: [], entries: [] },
			"global:notepad",
		);
		expect(resolved.ok).toBe(false);
		if (resolved.ok) return;
		expect(resolved.failure.code).toBe("ID_LOCATION_UNKNOWN");
		expect(resolved.failure.evidence).toEqual({
			kind: "locations",
			locations: [],
		});
	});
});
