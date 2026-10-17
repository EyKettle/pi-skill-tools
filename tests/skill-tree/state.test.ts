/**
 * The loaded set's algebra: load outcomes, the cascade a cancel reaches, and
 * the closed encoding of the copy.
 */
import { describe, expect, it } from "vitest";
import {
	COPY_VERSION,
	cascadeTargets,
	decodeCopy,
	distinctLocations,
	encodeCopy,
	identityOf,
	isStateEntry,
	loadEntry,
	removeIds,
} from "../../src/skill-tree/state";
import type { LoadedSet, StateEntry } from "../../src/skill-tree/types";

function entry(overrides: Partial<StateEntry> = {}): StateEntry {
	return {
		id: "global:git",
		path: "/skills/git/SKILL.md",
		body: "# Git\n",
		...overrides,
	};
}

const guide = entry({
	id: "global:git/references/GUIDE.md",
	path: "/skills/git/references/GUIDE.md",
	body: "# Guide\n",
});

const project = entry({
	id: "project:git",
	path: "/work/git/SKILL.md",
	body: "# Project Git\n",
});

describe("loadEntry", () => {
	it("appends a new identity in load order", () => {
		const result = loadEntry([], entry());
		expect(result.outcome).toBe("Loaded");
		expect(result.state).toEqual([entry()]);
	});

	it("replaces a matching identity in place", () => {
		const result = loadEntry([entry(), guide], entry({ body: "# Git v2\n" }));
		expect(result.outcome).toBe("Refreshed");
		expect(result.state).toEqual([
			entry({ body: "# Git v2\n" }),
			guide,
		]);
	});

	it("leaves an identical entry unchanged", () => {
		const result = loadEntry([entry()], entry());
		expect(result.outcome).toBe("Unchanged");
		expect(result.state).toEqual([entry()]);
	});

	it("leaves the entry unchanged when only the path moved", () => {
		const result = loadEntry(
			[entry()],
			entry({ path: "/moved/git/SKILL.md" }),
		);
		expect(result.outcome).toBe("Unchanged");
		expect(result.state[0].path).toBe("/skills/git/SKILL.md");
	});

	it("refreshes the body and keeps the path the entry was first loaded from", () => {
		const result = loadEntry(
			[entry()],
			entry({ path: "/moved/git/SKILL.md", body: "# Git v2\n" }),
		);
		expect(result.outcome).toBe("Refreshed");
		expect(result.state).toEqual([
			{ id: "global:git", path: "/skills/git/SKILL.md", body: "# Git v2\n" },
		]);
	});
});

describe("removeIds", () => {
	it("removes every named entry and keeps the order of the rest", () => {
		expect(removeIds([entry(), guide, project], [guide.id])).toEqual([
			entry(),
			project,
		]);
	});

	it("removes nothing for an empty set of ids", () => {
		expect(removeIds([entry()], [])).toEqual([entry()]);
	});
});

describe("identityOf", () => {
	it("reads a location, a name, and an optional ref path", () => {
		expect(identityOf("global:git")).toEqual({
			location: "global",
			name: "git",
			refPath: undefined,
		});
		expect(identityOf("global:git/references/a.md")).toEqual({
			location: "global",
			name: "git",
			refPath: "references/a.md",
		});
	});

	it("rejects a bare name, an empty name, and an empty ref", () => {
		expect(identityOf("git")).toBeUndefined();
		expect(identityOf("global:")).toBeUndefined();
		expect(identityOf("global:git/")).toBeUndefined();
	});

	it("rejects a name outside the character set", () => {
		expect(identityOf("global:Bad Name")).toBeUndefined();
		expect(identityOf("Bad!Location:git")).toBeUndefined();
	});
});

describe("cascadeTargets", () => {
	const state: LoadedSet = [entry(), guide, project];

	it("a main-document id reaches the skill and every related file", () => {
		expect(cascadeTargets(state, { name: "git" }).map((e) => e.id)).toEqual([
			"global:git",
			"global:git/references/GUIDE.md",
			"project:git",
		]);
	});

	it("a location-qualified id reaches only that location's entries", () => {
		expect(
			cascadeTargets(state, { location: "global", name: "git" }).map(
				(e) => e.id,
			),
		).toEqual(["global:git", "global:git/references/GUIDE.md"]);
	});

	it("a related-file id reaches that file and the files below it", () => {
		const deep = entry({
			id: "global:git/references/sub/deep.md",
			path: "/skills/git/references/sub/deep.md",
			body: "# Deep\n",
		});
		expect(
			cascadeTargets([entry(), guide, deep], {
				location: "global",
				name: "git",
				refPath: "references",
			}).map((e) => e.id),
		).toEqual([
			"global:git/references/GUIDE.md",
			"global:git/references/sub/deep.md",
		]);
	});

	it("reaches nothing for an absent name", () => {
		expect(cascadeTargets(state, { name: "absent" })).toEqual([]);
	});
});

describe("distinctLocations", () => {
	it("lists the locations of the reached entries in encounter order", () => {
		expect(distinctLocations([entry(), guide, project])).toEqual([
			"global",
			"project",
		]);
	});

	it("is empty for no entries", () => {
		expect(distinctLocations([])).toEqual([]);
	});
});

describe("the copy encoding", () => {
	it("round-trips the state and its marker", () => {
		const copy = encodeCopy([entry(), guide], "leaf-2");
		expect(copy).toEqual({
			version: COPY_VERSION,
			marker: "leaf-2",
			entries: [entry(), guide],
		});
		expect(decodeCopy(copy)).toEqual(copy);
		expect(decodeCopy(encodeCopy([], ""))).toEqual({
			version: COPY_VERSION,
			marker: "",
			entries: [],
		});
	});

	it("decodes an unrecognized version as absent", () => {
		expect(
			decodeCopy({ version: COPY_VERSION + 1, marker: "", entries: [] }),
		).toBeUndefined();
		expect(decodeCopy({ marker: "", entries: [] })).toBeUndefined();
	});

	it("decodes an unknown field as absent", () => {
		expect(
			decodeCopy({
				version: COPY_VERSION,
				marker: "",
				entries: [],
				extra: true,
			}),
		).toBeUndefined();
	});

	it("decodes a malformed entry as absent, never as a partial set", () => {
		expect(
			decodeCopy({
				version: COPY_VERSION,
				marker: "",
				entries: [entry(), entry({ id: "Bad Name" })],
			}),
		).toBeUndefined();
		expect(
			decodeCopy({
				version: COPY_VERSION,
				marker: "",
				entries: [entry({ path: "skills/git/SKILL.md" })],
			}),
		).toBeUndefined();
	});

	it("decodes duplicate identities as absent", () => {
		expect(
			decodeCopy({
				version: COPY_VERSION,
				marker: "",
				entries: [entry(), entry()],
			}),
		).toBeUndefined();
	});

	it("decodes a non-object as absent", () => {
		expect(decodeCopy(null)).toBeUndefined();
		expect(decodeCopy("nope")).toBeUndefined();
	});
});

describe("isStateEntry", () => {
	it("accepts a full id with an absolute path and a string body", () => {
		expect(isStateEntry(entry())).toBe(true);
	});

	it("rejects a bare id, a relative path, and an unknown field", () => {
		expect(isStateEntry({ ...entry(), id: "git" })).toBe(false);
		expect(isStateEntry({ ...entry(), path: "SKILL.md" })).toBe(false);
		expect(isStateEntry({ ...entry(), extra: 1 })).toBe(false);
	});
});
