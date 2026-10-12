/**
 * The loaded skill set's algebra (plan Task 1): load outcomes, cancel by an
 * id's shape, and closed serialization.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { EMPTY_SET, STATE_VERSION, cancel, decode, encode, load } from "../state";
import type { LoadedSet, StateEntry } from "../state";

function entry(overrides: Partial<StateEntry> = {}): StateEntry {
	return {
		storage: "global",
		name: "git",
		displayId: "git",
		path: "/skills/git/SKILL.md",
		body: "# Git\n",
		volume: { bytes: 6, lines: 1 },
		...overrides,
	};
}

describe("loading", () => {
	it("adds every file as its own entry, in load order", () => {
		const skill = entry();
		const ref = entry({
			refPath: "references/GUIDE.md",
			displayId: "git/references/GUIDE.md",
			path: "/skills/git/references/GUIDE.md",
			body: "# Guide\n",
			volume: { bytes: 8, lines: 1 },
		});

		const result = load(EMPTY_SET, [skill, ref]);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.outcomes).toEqual(["added", "added"]);
		expect(result.set.entries).toEqual([skill, ref]);
	});
});

describe("reloading", () => {
	it("replaces a matching identity in place and reports replaced", () => {
		const skill = entry();
		const guide = entry({
			refPath: "references/GUIDE.md",
			displayId: "git/references/GUIDE.md",
			path: "/skills/git/references/GUIDE.md",
			body: "# Guide\n",
			volume: { bytes: 8, lines: 1 },
		});
		const loaded = load(EMPTY_SET, [skill, guide]);
		expect(loaded.ok).toBe(true);
		if (!loaded.ok) return;

		const updated = entry({ body: "# Git v2\n", volume: { bytes: 9, lines: 1 } });
		const result = load(loaded.set, [updated]);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.outcomes).toEqual(["replaced"]);
		expect(result.set.entries).toEqual([updated, guide]);
	});

	it("leaves an identical entry unchanged", () => {
		const loaded = load(EMPTY_SET, [entry()]);
		expect(loaded.ok).toBe(true);
		if (!loaded.ok) return;

		const result = load(loaded.set, [entry()]);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.outcomes).toEqual(["unchanged"]);
		expect(result.set.entries).toEqual([entry()]);
	});
});

describe("cancelling", () => {
	function loaded(): {
		skill: StateEntry;
		guide: StateEntry;
		api: StateEntry;
		set: LoadedSet;
	} {
		const skill = entry();
		const guide = entry({
			refPath: "references/GUIDE.md",
			displayId: "git/references/GUIDE.md",
			path: "/skills/git/references/GUIDE.md",
			body: "# Guide\n",
			volume: { bytes: 8, lines: 1 },
		});
		const api = entry({
			refPath: "references/API.md",
			displayId: "git/references/API.md",
			path: "/skills/git/references/API.md",
			body: "# API\n",
			volume: { bytes: 6, lines: 1 },
		});
		const result = load(EMPTY_SET, [skill, guide, api]);
		if (!result.ok) throw new Error("setup load failed");
		return { skill, guide, api, set: result.set };
	}

	it("removes a ref-path entry alone", () => {
		const { skill, guide, api, set } = loaded();

		const result = cancel(set, ["git/references/GUIDE.md"]);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.removed).toEqual([guide]);
		expect(result.set.entries).toEqual([skill, api]);
	});

	it("removes the skill and every entry under it", () => {
		const { skill, guide, api, set } = loaded();

		const result = cancel(set, ["git"]);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.removed).toEqual([skill, guide, api]);
		expect(result.set.entries).toEqual([]);
	});
});

describe("cancel failures", () => {
	function loaded(): { set: LoadedSet } {
		const result = load(EMPTY_SET, [
			entry(),
			entry({
				refPath: "references/GUIDE.md",
				displayId: "git/references/GUIDE.md",
				path: "/skills/git/references/GUIDE.md",
				body: "# Guide\n",
				volume: { bytes: 8, lines: 1 },
			}),
		]);
		if (!result.ok) throw new Error("setup load failed");
		return { set: result.set };
	}

	function twoStorages(): {
		globalSkill: StateEntry;
		globalRef: StateEntry;
		projectSkill: StateEntry;
		set: LoadedSet;
	} {
		const globalSkill = entry({ displayId: "global:git" });
		const globalRef = entry({
			refPath: "references/GUIDE.md",
			displayId: "global:git/references/GUIDE.md",
			path: "/skills/git/references/GUIDE.md",
			body: "# Guide\n",
			volume: { bytes: 8, lines: 1 },
		});
		const projectSkill = entry({
			storage: "project",
			displayId: "project:git",
			path: "/work/git/SKILL.md",
		});
		const result = load(EMPTY_SET, [globalSkill, globalRef, projectSkill]);
		if (!result.ok) throw new Error("setup load failed");
		return { globalSkill, globalRef, projectSkill, set: result.set };
	}

	it("cancelling an id that is not loaded is a defined failure", () => {
		const { set } = loaded();

		const result = cancel(set, ["absent"]);

		expect(result).toEqual({
			ok: false,
			failures: [{ index: 0, id: "absent", kind: "not-loaded" }],
		});
	});

	it("reports a storage that holds no such skill as not loaded", () => {
		const { set } = loaded();

		const result = cancel(set, ["project:git"]);

		expect(result).toEqual({
			ok: false,
			failures: [{ index: 0, id: "project:git", kind: "not-loaded" }],
		});
	});

	it("fails an id that does not parse with the parser's code", () => {
		const { set } = loaded();

		const result = cancel(set, ["Bad Name"]);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.failures.length).toBe(1);
		const failure = result.failures[0];
		expect(failure.kind).toBe("invalid-id");
		expect(failure.id).toBe("Bad Name");
		if (failure.kind !== "invalid-id") return;
		expect(failure.code).toBe("ID_INVALID_NAME");
	});

	it("is ambiguous for a bare name that two storages hold", () => {
		const { set } = twoStorages();

		const result = cancel(set, ["git"]);

		expect(result).toEqual({
			ok: false,
			failures: [
				{
					index: 0,
					id: "git",
					kind: "ambiguous",
					candidates: [
						{ id: "global:git", path: "/skills/git/SKILL.md" },
						{ id: "project:git", path: "/work/git/SKILL.md" },
					],
				},
			],
		});
	});

	it("reaches one storage when the id carries its prefix", () => {
		const { globalSkill, globalRef, projectSkill, set } = twoStorages();

		const result = cancel(set, ["global:git"]);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.removed).toEqual([globalSkill, globalRef]);
		expect(result.set.entries).toEqual([projectSkill]);
	});
});

describe("batch atomicity", () => {
	it("a load batch does not land when any identity is malformed", () => {
		const loaded = load(EMPTY_SET, [entry()]);
		if (!loaded.ok) throw new Error("setup load failed");

		const result = load(loaded.set, [
			entry({ name: "other" }),
			entry({ name: "Bad Name" }),
		]);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.failures).toEqual([{ index: 1, error: expect.any(String) }]);
		expect(loaded.set.entries).toEqual([entry()]);
	});

	it("a load batch does not land when an entry's volume is malformed", () => {
		const loaded = load(EMPTY_SET, [entry()]);
		if (!loaded.ok) throw new Error("setup load failed");

		const result = load(loaded.set, [
			entry({ name: "other" }),
			entry({
				refPath: "references/GUIDE.md",
				volume: { bytes: -1, lines: 1 },
			}),
		]);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.failures).toEqual([{ index: 1, error: expect.any(String) }]);
		expect(loaded.set.entries).toEqual([entry()]);
	});

	it("a cancel batch with any failing id removes nothing", () => {
		const skill = entry();
		const guide = entry({
			refPath: "references/GUIDE.md",
			displayId: "git/references/GUIDE.md",
			path: "/skills/git/references/GUIDE.md",
			body: "# Guide\n",
			volume: { bytes: 8, lines: 1 },
		});
		const loaded = load(EMPTY_SET, [skill, guide]);
		if (!loaded.ok) throw new Error("setup load failed");

		const result = cancel(loaded.set, ["git/references/GUIDE.md", "absent"]);

		expect(result).toEqual({
			ok: false,
			failures: [{ index: 1, id: "absent", kind: "not-loaded" }],
		});
	});

	it("an empty batch changes nothing", () => {
		const loaded = load(EMPTY_SET, [entry()]);
		if (!loaded.ok) throw new Error("setup load failed");

		expect(load(loaded.set, [])).toEqual({ ok: true, set: loaded.set, outcomes: [] });
		expect(cancel(loaded.set, [])).toEqual({ ok: true, set: loaded.set, removed: [] });
	});
});

describe("serialization", () => {
	it("round-trips a set through encode and decode", () => {
		const set: LoadedSet = {
			entries: [
				entry(),
				entry({
					refPath: "references/GUIDE.md",
					displayId: "git/references/GUIDE.md",
					path: "/skills/git/references/GUIDE.md",
					body: "# Guide\n",
					volume: { bytes: 8, lines: 1 },
				}),
			],
		};

		expect(encode(set)).toEqual({ version: STATE_VERSION, entries: set.entries });
		expect(decode(encode(set))).toEqual(set);
	});

	it("decodes an unrecognized version as an empty set", () => {
		expect(decode({ version: STATE_VERSION + 1, entries: [entry()] })).toEqual(
			EMPTY_SET,
		);
		expect(decode({ entries: [entry()] })).toEqual(EMPTY_SET);
	});

	it("decodes a malformed entry as an empty set, never a partial one", () => {
		const good = entry();
		const bad = entry({ name: "Bad Name" });

		const decoded = decode({ version: STATE_VERSION, entries: [good, bad] });

		expect(decoded).toEqual(EMPTY_SET);
	});

	it("decodes duplicate identities as an empty set", () => {
		expect(
			decode({ version: STATE_VERSION, entries: [entry(), entry()] }),
		).toEqual(EMPTY_SET);
	});

	it("decodes a value that is not an encoded set as an empty set", () => {
		expect(decode(null)).toEqual(EMPTY_SET);
		expect(decode("nope")).toEqual(EMPTY_SET);
		expect(decode({ version: STATE_VERSION, entries: "nope" })).toEqual(EMPTY_SET);
		expect(decode({ version: STATE_VERSION, entries: [], extra: 1 })).toEqual(EMPTY_SET);
	});
});

describe("module purity", () => {
	it("state.ts imports no filesystem, Pi, session-state, or deps modules", () => {
		const source = readFileSync(new URL("../state.ts", import.meta.url), "utf8");
		const specifiers = Array.from(
			source.matchAll(/from\s+"([^"]+)"/g),
			(match) => match[1],
		);

		expect(specifiers).toContain("./skill-id");
		for (const specifier of specifiers) {
			expect(specifier, `unexpected import: ${specifier}`).toMatch(/^\.\//);
			expect(specifier).not.toMatch(/session-state|\/deps\//);
		}
	});
});
