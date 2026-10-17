/**
 * The assembly: the write order, settling against the session tree, the
 * history gap, and the shared load/cancel use case.
 */
import { describe, expect, it } from "vitest";
import { createSkillTree } from "../../src/skill-tree/assembly";
import { fold } from "../../src/skill-tree/log";
import type {
	CommitEntry,
	SkillTreePorts,
	SkillTreeReport,
	StoredCopy,
} from "../../src/skill-tree/types";
import { formatSkillId } from "../../src/discovery/skill-id";
import { createFailure } from "../../src/failure/create";
import type { Index, RegistryEntry } from "../../src/discovery/types";
import type { PathCommit } from "../../src/skill-tree/types";

function registryEntry(location: string, name: string): RegistryEntry {
	return {
		location,
		name,
		id: formatSkillId(location, name),
		filePath: `/${location}/${name}/SKILL.md`,
		baseDir: `/${location}/${name}`,
		frontmatter: {},
	};
}

function indexOf(...entries: RegistryEntry[]): Index {
	return {
		locations: ["global", "project", "package", "temp"].map((id) => ({
			id,
			writable: id === "global" || id === "project",
		})),
		entries,
	};
}

interface Harness {
	readonly ports: SkillTreePorts;
	path: PathCommit[];
	copy: unknown;
	writes: StoredCopy[];
	failWrites: boolean;
	leaf: string;
	appends: CommitEntry[];
	segments: string[];
	reports: SkillTreeReport[];
	history: boolean;
	files: Map<string, { path: string; text: string }>;
	order: string[];
}

function harness(): Harness {
	const h = {
		path: [] as PathCommit[],
		copy: undefined as unknown,
		writes: [] as StoredCopy[],
		failWrites: false,
		leaf: "",
		appends: [] as CommitEntry[],
		segments: [] as string[],
		reports: [] as SkillTreeReport[],
		history: true,
		files: new Map<string, { path: string; text: string }>(),
		order: [] as string[],
	};
	const ports: SkillTreePorts = {
		readCopy: () => h.copy,
		writeCopy: (copy) => {
			h.order.push("copy");
			if (h.failWrites) throw new Error("write lock held");
			h.writes.push(copy);
			h.copy = copy;
		},
		readPath: () => h.path,
		leafId: () => h.leaf,
		appendEntry: (entry) => {
			h.order.push("append");
			h.appends.push(entry);
		},
		registerSegment: (text) => {
			h.order.push("register");
			h.segments.push(text);
		},
		report: (report) => {
			h.reports.push(report);
		},
		historyEnabled: () => h.history,
		readBody: (entry, refPath) => {
			const id = formatSkillId(entry.location, entry.name, refPath);
			const file = h.files.get(id);
			if (file === undefined) {
				return {
					ok: false,
					failure: createFailure("PATH_NOT_FOUND", {
						kind: "path",
						path: `${entry.baseDir}/${refPath ?? "SKILL.md"}`,
					}),
				};
			}
			return { ok: true, path: file.path, text: file.text };
		},
	};
	return Object.assign(h, { ports });
}

const GIT = registryEntry("global", "git");
const OTHER = registryEntry("global", "other");
const PROJECT_GIT = registryEntry("project", "git");

function file(h: Harness, entry: RegistryEntry, text: string, refPath?: string) {
	const id = formatSkillId(entry.location, entry.name, refPath);
	h.files.set(id, {
		path: refPath === undefined ? entry.filePath : `${entry.baseDir}/${refPath}`,
		text,
	});
}

function commit(entry: CommitEntry, id: string): PathCommit {
	return { id, entry };
}

describe("the write order", () => {
	it("appends the log entry before the copy and the republish", () => {
		const h = harness();
		file(h, GIT, "# Git\n");
		h.leaf = "leaf-1";
		const tree = createSkillTree(h.ports);

		const result = tree.importSkills(indexOf(GIT), ["git"]);

		expect(result).toEqual({
			ok: true,
			results: [{ displayId: "git", action: "Loaded" }],
		});
		expect(h.order).toEqual(["append", "copy", "register"]);
		expect(h.appends[0]).toEqual({
			kind: "change",
			operations: [
				{
					kind: "load",
					entry: {
						id: "global:git",
						path: "/global/git/SKILL.md",
						body: "# Git\n",
					},
				},
			],
		});
		expect(h.writes[0].marker).toBe("leaf-1");
		expect(h.segments.at(-1)).toBe(
			'<SKILL id="global:git" path="/global/git/SKILL.md">\n# Git\n</SKILL>',
		);
	});

	it("lands a refresh as a replacement carrying the line diff", () => {
		const h = harness();
		const before = "# Git\n\nline two\nline three\n";
		const after = "# Git v2\n\nline two\nline three\n";
		file(h, GIT, before);
		h.leaf = "leaf-1";
		const tree = createSkillTree(h.ports);
		tree.importSkills(indexOf(GIT), ["git"]);

		file(h, GIT, after);
		h.leaf = "leaf-2";
		const result = tree.importSkills(indexOf(GIT), ["git"]);

		expect(result).toEqual({
			ok: true,
			results: [{ displayId: "git", action: "Refreshed" }],
		});
		expect(h.appends.at(-1)).toEqual({
			kind: "change",
			operations: [
				{
					kind: "replace",
					id: "global:git",
					payload: {
						kind: "diff",
						blocks: [{ start: 1, count: 1, text: "# Git v2\n" }],
					},
				},
			],
		});
	});

	it("lands nothing when a reload changes nothing", () => {
		const h = harness();
		file(h, GIT, "# Git\n");
		const tree = createSkillTree(h.ports);
		tree.importSkills(indexOf(GIT), ["git"]);
		const orderLength = h.order.length;
		const appends = h.appends.length;

		const result = tree.importSkills(indexOf(GIT), ["git"]);

		expect(result).toEqual({
			ok: true,
			results: [{ displayId: "git", action: "Unchanged" }],
		});
		expect(h.order.length).toBe(orderLength);
		expect(h.appends.length).toBe(appends);
	});

	it("keeps memory and the log advanced when the copy write is refused", () => {
		const h = harness();
		file(h, GIT, "# Git\n");
		file(h, OTHER, "# Other\n");
		h.leaf = "leaf-1";
		h.failWrites = true;
		const tree = createSkillTree(h.ports);

		const first = tree.importSkills(indexOf(GIT, OTHER), ["git"]);

		expect(first.ok).toBe(true);
		expect(h.appends.length).toBe(1);
		expect(h.writes.length).toBe(0);
		expect(tree.state.map((entry) => entry.id)).toEqual(["global:git"]);

		h.failWrites = false;
		h.leaf = "leaf-2";
		tree.importSkills(indexOf(GIT, OTHER), ["other"]);

		expect(h.writes.length).toBe(1);
		expect(h.writes[0].marker).toBe("leaf-2");
		expect(h.writes[0].entries.map((entry) => entry.id)).toEqual([
			"global:git",
			"global:other",
		]);
	});

	it("folds to exactly the memory state when a reload moves the file", () => {
		const h = harness();
		file(h, GIT, "# Git\n");
		const tree = createSkillTree(h.ports);
		tree.importSkills(indexOf(GIT), ["git"]);
		h.leaf = "leaf-2";
		// The same identity now reads from a new path with a new body.
		h.files.set("global:git", {
			path: "/project/git/SKILL.md",
			text: "# Git v2\n",
		});

		const result = tree.importSkills(indexOf(GIT), ["git"]);

		expect(result).toEqual({
			ok: true,
			results: [{ displayId: "git", action: "Refreshed" }],
		});
		expect(tree.state).toEqual([
			{ id: "global:git", path: "/global/git/SKILL.md", body: "# Git v2\n" },
		]);
		const folded = fold(h.appends);
		expect(folded).toEqual({ ok: true, state: tree.state });
	});

	it("lands nothing when a moved file keeps its body", () => {
		const h = harness();
		file(h, GIT, "# Git\n");
		const tree = createSkillTree(h.ports);
		tree.importSkills(indexOf(GIT), ["git"]);
		const appends = h.appends.length;
		h.files.set("global:git", {
			path: "/project/git/SKILL.md",
			text: "# Git\n",
		});

		const result = tree.importSkills(indexOf(GIT), ["git"]);

		expect(result).toEqual({
			ok: true,
			results: [{ displayId: "git", action: "Unchanged" }],
		});
		expect(h.appends.length).toBe(appends);
		expect(tree.state[0].path).toBe("/global/git/SKILL.md");
	});
});

describe("settling against the path", () => {
	const loadedPath: PathCommit[] = [
		commit(
			{
				kind: "change",
				operations: [
					{ kind: "load", entry: { id: "global:git", path: "/global/git/SKILL.md", body: "# Git\n" } },
				],
			},
			"c1",
		),
	];

	it("trusts a copy whose marker names the path's last entry", () => {
		const h = harness();
		h.path = loadedPath;
		h.copy = { version: 1, marker: "c1", entries: [] };
		const tree = createSkillTree(h.ports);

		tree.start();

		expect(tree.state).toEqual([]);
		expect(h.writes).toEqual([]);
		expect(h.order).toEqual(["register"]);
	});

	it("folds the path and rewrites the copy when the marker diverges", () => {
		const h = harness();
		h.path = loadedPath;
		h.copy = { version: 1, marker: "stale", entries: [] };
		const tree = createSkillTree(h.ports);

		tree.start();

		expect(tree.state.map((entry) => entry.id)).toEqual(["global:git"]);
		expect(h.writes[0].marker).toBe("c1");
	});

	it("trusts the copy when the path has no commit entry", () => {
		const h = harness();
		h.copy = {
			version: 1,
			marker: "anything",
			entries: [{ id: "global:git", path: "/global/git/SKILL.md", body: "# Git\n" }],
		};
		const tree = createSkillTree(h.ports);

		tree.start();

		expect(tree.state.map((entry) => entry.id)).toEqual(["global:git"]);
	});

	it("folds from a baseline even when the marker matches", () => {
		const h = harness();
		h.path = [
			commit(
				{
					kind: "change",
					operations: [
						{ kind: "load", entry: { id: "global:git", path: "/old/SKILL.md", body: "# Old\n" } },
					],
				},
				"c1",
			),
			commit(
				{
					kind: "baseline",
					entries: [{ id: "global:git", path: "/new/SKILL.md", body: "# New\n" }],
				},
				"c2",
			),
		];
		h.copy = {
			version: 1,
			marker: "c2",
			entries: [{ id: "global:git", path: "/stale/SKILL.md", body: "# Stale\n" }],
		};
		const tree = createSkillTree(h.ports);

		tree.start();

		expect(tree.state[0].path).toBe("/new/SKILL.md");
	});

	it("falls back to the copy and reports once when the fold aborts", () => {
		const h = harness();
		h.path = [
			commit(
				{
					kind: "change",
					operations: [
						{ kind: "load", entry: { id: "Bad Name", path: "/x/SKILL.md", body: "x" } },
					],
				},
				"c1",
			),
		];
		h.copy = {
			version: 1,
			marker: "stale",
			entries: [{ id: "global:git", path: "/global/git/SKILL.md", body: "# Git\n" }],
		};
		const tree = createSkillTree(h.ports);

		tree.start();
		tree.start();

		expect(tree.state.map((entry) => entry.id)).toEqual(["global:git"]);
		expect(h.reports).toEqual([
			{ kind: "fold-aborted", error: expect.any(String) },
		]);
	});

	it("treats a malformed copy as absent and folds instead", () => {
		const h = harness();
		h.path = loadedPath;
		h.copy = { version: 9, marker: "c1", entries: [] };
		const tree = createSkillTree(h.ports);

		tree.start();

		expect(tree.state.map((entry) => entry.id)).toEqual(["global:git"]);
	});
});

describe("navigation", () => {
	it("folds to the new leaf and marks the copy with the path's last entry", () => {
		const h = harness();
		h.path = [
			commit(
				{
					kind: "change",
					operations: [
						{ kind: "load", entry: { id: "global:git", path: "/global/git/SKILL.md", body: "# Git\n" } },
					],
				},
				"c1",
			),
		];
		h.copy = { version: 1, marker: "stale", entries: [] };
		const tree = createSkillTree(h.ports);

		tree.navigate();

		expect(tree.state.map((entry) => entry.id)).toEqual(["global:git"]);
		expect(h.writes[0].marker).toBe("c1");
		expect(h.segments.at(-1)).toContain('<SKILL id="global:git"');
	});

	it("falls back to the copy when the fold aborts", () => {
		const h = harness();
		h.path = [
			commit(
				{
					kind: "change",
					operations: [
						{ kind: "load", entry: { id: "Bad Name", path: "/x/SKILL.md", body: "x" } },
					],
				},
				"c1",
			),
		];
		h.copy = {
			version: 1,
			marker: "x",
			entries: [{ id: "global:git", path: "/global/git/SKILL.md", body: "# Git\n" }],
		};
		const tree = createSkillTree(h.ports);

		tree.navigate();

		expect(tree.state.map((entry) => entry.id)).toEqual(["global:git"]);
		expect(h.reports).toHaveLength(1);
	});
});

describe("the history switch", () => {
	it("does not append while history is off, clears the marker, and reports once", () => {
		const h = harness();
		file(h, GIT, "# Git\n");
		h.history = false;
		const tree = createSkillTree(h.ports);

		tree.importSkills(indexOf(GIT), ["git"]);

		expect(h.appends).toEqual([]);
		expect(h.writes[0].marker).toBe("");
		expect(tree.state.map((entry) => entry.id)).toEqual(["global:git"]);
		expect(h.reports).toEqual([{ kind: "history-off" }]);
		expect(h.segments.at(-1)).toContain("<SKILL");
	});

	it("writes a baseline on the first change after history resumes", () => {
		const h = harness();
		file(h, GIT, "# Git\n");
		file(h, OTHER, "# Other\n");
		h.history = false;
		const tree = createSkillTree(h.ports);
		tree.importSkills(indexOf(GIT, OTHER), ["git"]);

		h.history = true;
		h.leaf = "leaf-2";
		tree.importSkills(indexOf(GIT, OTHER), ["other"]);

		expect(h.appends.at(-1)).toEqual({
			kind: "baseline",
			entries: [
				{ id: "global:git", path: "/global/git/SKILL.md", body: "# Git\n" },
				{ id: "global:other", path: "/global/other/SKILL.md", body: "# Other\n" },
			],
		});
		expect(h.writes.at(-1)?.marker).toBe("leaf-2");
		expect(h.reports).toHaveLength(1);
	});

	it("clears the copy's marker at start while history is off", () => {
		const h = harness();
		h.history = false;
		h.copy = {
			version: 1,
			marker: "c1",
			entries: [{ id: "global:git", path: "/global/git/SKILL.md", body: "# Git\n" }],
		};
		const tree = createSkillTree(h.ports);

		tree.start();

		expect(tree.state.map((entry) => entry.id)).toEqual(["global:git"]);
		expect(h.writes[0].marker).toBe("");
	});

	it("treats a cleared marker over a non-empty path as a gap at start", () => {
		const h = harness();
		h.copy = {
			version: 1,
			marker: "",
			entries: [{ id: "global:git", path: "/global/git/SKILL.md", body: "# Git\n" }],
		};
		h.path = [
			commit(
				{
					kind: "change",
					operations: [
						{ kind: "load", entry: { id: "global:other", path: "/global/other/SKILL.md", body: "# Other\n" } },
					],
				},
				"c1",
			),
		];
		file(h, OTHER, "# Other\n");
		const tree = createSkillTree(h.ports);
		tree.start();

		expect(tree.state.map((entry) => entry.id)).toEqual(["global:git"]);

		h.leaf = "leaf-2";
		tree.importSkills(indexOf(GIT, OTHER), ["other"]);

		expect(h.appends.at(-1)?.kind).toBe("baseline");
	});
});

describe("the import use case", () => {
	it("resolves a related-file id and loads that file as its own entry", () => {
		const h = harness();
		file(h, GIT, "# Guide\n", "references/GUIDE.md");
		const tree = createSkillTree(h.ports);

		const result = tree.importSkills(indexOf(GIT), [
			"global:git/references/GUIDE.md",
		]);

		expect(result).toEqual({
			ok: true,
			results: [
				{ displayId: "git/references/GUIDE.md", action: "Loaded" },
			],
		});
		expect(tree.state[0].path).toBe("/global/git/references/GUIDE.md");
	});

	it("reports an empty batch", () => {
		const h = harness();
		const tree = createSkillTree(h.ports);

		const result = tree.importSkills(indexOf(GIT), []);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.failure.code).toBe("BATCH_EMPTY");
	});

	it("keeps the location prefix in a report when the name exists twice", () => {
		const h = harness();
		file(h, GIT, "# Git\n");
		file(h, PROJECT_GIT, "# Project Git\n");
		const tree = createSkillTree(h.ports);

		const result = tree.importSkills(indexOf(GIT, PROJECT_GIT), [
			"global:git",
		]);

		expect(result).toEqual({
			ok: true,
			results: [{ displayId: "global:git", action: "Loaded" }],
		});
	});

	it("resolves through the index and reports its failure", () => {
		const h = harness();
		const tree = createSkillTree(h.ports);

		const result = tree.importSkills(indexOf(GIT), ["absent"]);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.failure.code).toBe("ID_NOT_FOUND");
	});

	it("reports an ambiguous name", () => {
		const h = harness();
		const tree = createSkillTree(h.ports);

		const result = tree.importSkills(indexOf(GIT, PROJECT_GIT), ["git"]);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.failure.code).toBe("ID_AMBIGUOUS");
	});

	it("returns the reader's failure and lands nothing", () => {
		const h = harness();
		const tree = createSkillTree(h.ports);

		const result = tree.importSkills(indexOf(GIT), ["git"]);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.failure.code).toBe("PATH_NOT_FOUND");
		expect(h.appends).toEqual([]);
		expect(h.segments).toEqual([]);
	});

	it("is atomic: a failing id prevents every load", () => {
		const h = harness();
		file(h, GIT, "# Git\n");
		const tree = createSkillTree(h.ports);

		const result = tree.importSkills(indexOf(GIT), ["git", "absent"]);

		expect(result.ok).toBe(false);
		expect(h.appends).toEqual([]);
		expect(tree.state).toEqual([]);
	});
});

describe("the cancel use case", () => {
	it("removes the skill and every related file it reaches", () => {
		const h = harness();
		file(h, GIT, "# Git\n");
		file(h, GIT, "# Guide\n", "references/GUIDE.md");
		const tree = createSkillTree(h.ports);
		tree.importSkills(indexOf(GIT), ["git", "git/references/GUIDE.md"]);
		h.leaf = "leaf-2";

		const result = tree.cancelSkills(indexOf(GIT), ["git"]);

		expect(result).toEqual({
			ok: true,
			results: [{ displayId: "git", action: "Unloaded" }],
		});
		expect(h.appends.at(-1)).toEqual({
			kind: "change",
			operations: [
				{ kind: "remove", id: "global:git" },
				{ kind: "remove", id: "global:git/references/GUIDE.md" },
			],
		});
		expect(tree.state).toEqual([]);
	});

	it("removes one related file alone", () => {
		const h = harness();
		file(h, GIT, "# Git\n");
		file(h, GIT, "# Guide\n", "references/GUIDE.md");
		const tree = createSkillTree(h.ports);
		tree.importSkills(indexOf(GIT), ["git", "git/references/GUIDE.md"]);

		tree.cancelSkills(indexOf(GIT), ["git/references/GUIDE.md"]);

		expect(tree.state.map((entry) => entry.id)).toEqual(["global:git"]);
	});

	it("reports an id that is not loaded, with what is loaded", () => {
		const h = harness();
		file(h, GIT, "# Git\n");
		const tree = createSkillTree(h.ports);
		tree.importSkills(indexOf(GIT), ["git"]);

		const result = tree.cancelSkills(indexOf(GIT), ["other"]);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.failure.code).toBe("NOT_LOADED");
		expect(result.failure.evidence).toEqual({
			kind: "loaded",
			id: "other",
			loaded: ["global:git"],
		});
	});

	it("keeps the location prefix in an unload report when the name exists twice", () => {
		const h = harness();
		file(h, GIT, "# Git\n");
		file(h, PROJECT_GIT, "# Project Git\n");
		const tree = createSkillTree(h.ports);
		tree.importSkills(indexOf(GIT, PROJECT_GIT), ["global:git", "project:git"]);

		const result = tree.cancelSkills(indexOf(GIT, PROJECT_GIT), [
			"global:git",
		]);

		expect(result).toEqual({
			ok: true,
			results: [{ displayId: "global:git", action: "Unloaded" }],
		});
	});

	it("reports a bare name that the loaded set holds twice", () => {
		const h = harness();
		file(h, GIT, "# Git\n");
		file(h, PROJECT_GIT, "# Project Git\n");
		const tree = createSkillTree(h.ports);
		tree.importSkills(indexOf(GIT, PROJECT_GIT), ["global:git", "project:git"]);

		const result = tree.cancelSkills(indexOf(GIT, PROJECT_GIT), ["git"]);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.failure.code).toBe("ID_AMBIGUOUS");
		expect(result.failure.evidence).toEqual({
			kind: "candidates",
			ids: ["global:git", "project:git"],
		});
	});

	it("is atomic: one failing id prevents every removal", () => {
		const h = harness();
		file(h, GIT, "# Git\n");
		const tree = createSkillTree(h.ports);
		tree.importSkills(indexOf(GIT), ["git"]);

		const result = tree.cancelSkills(indexOf(GIT), ["git", "absent"]);

		expect(result.ok).toBe(false);
		expect(tree.state.map((entry) => entry.id)).toEqual(["global:git"]);
		expect(h.appends).toHaveLength(1);
	});

	it("reports an empty batch", () => {
		const h = harness();
		const tree = createSkillTree(h.ports);

		const result = tree.cancelSkills(indexOf(GIT), []);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.failure.code).toBe("BATCH_EMPTY");
	});
});
