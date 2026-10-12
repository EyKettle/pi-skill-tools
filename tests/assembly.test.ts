/**
 * The session assembly: the write order, the divergence dispositions, and
 * the history-off path (plan Task 4).
 */
import { describe, expect, it } from "vitest";
import { COMMIT_ENTRY_TYPE, createAssembly } from "../index";
import type { AssemblyPorts, PathCommit, StoredCopy } from "../index";
import type { CommitEntry } from "../log";
import { encode } from "../state";
import type { StateEntry } from "../state";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

function entry(overrides: Partial<StateEntry> = {}): StateEntry {
	return {
		id: "git",
		path: "/skills/git/SKILL.md",
		body: "# Git\n",
		volume: { bytes: 6, lines: 1 },
		...overrides,
	};
}

function commit(entryValue: CommitEntry, id: string): PathCommit {
	return { id, entry: entryValue };
}

interface Harness {
	ports: AssemblyPorts;
	path: PathCommit[];
	navigatePath: PathCommit[];
	copy: unknown;
	writes: StoredCopy[];
	failWrites: boolean;
	appends: CommitEntry[];
	segments: string[];
	notices: string[];
	history: boolean;
	leaf: string | undefined;
	order: string[];
}

function harness(): Harness {
	const h = {
		path: [] as PathCommit[],
		navigatePath: [] as PathCommit[],
		copy: undefined as unknown,
		writes: [] as StoredCopy[],
		failWrites: false,
		appends: [] as CommitEntry[],
		segments: [] as string[],
		notices: [] as string[],
		history: true,
		leaf: undefined as string | undefined,
		order: [] as string[],
	};
	const ports: AssemblyPorts = {
		store: {
			read: () => h.copy,
			write: (_ctx, value) => {
				h.order.push("copy");
				if (h.failWrites) {
					throw new Error("write lock held");
				}
				h.writes.push(value);
				h.copy = value;
			},
		},
		historyEnabled: () => h.history,
		pathCommits: (_ctx, fromId) => (fromId == null ? h.path : h.navigatePath),
		leafId: () => h.leaf,
		appendCommit: (value) => {
			h.order.push("append");
			h.appends.push(value);
		},
		registerSegment: (text) => {
			h.order.push("register");
			h.segments.push(text);
		},
		notify: (_ctx, message) => {
			h.notices.push(message);
		},
	};
	return Object.assign(h, { ports });
}

const ctx = {} as ExtensionContext;

describe("the write order", () => {
	it("appends the log entry before the copy and the republish", () => {
		const h = harness();
		const assembly = createAssembly(h.ports);
		h.leaf = "leaf-1";

		const result = assembly.change(ctx, { loads: [entry()] });

		expect(result.ok).toBe(true);
		expect(h.order).toEqual(["append", "copy", "register"]);
		expect(h.appends[0]).toEqual({
			kind: "delta",
			operations: [{ kind: "load", entry: entry() }],
		});
		expect(h.writes[0].marker).toBe("leaf-1");
		expect(h.segments.at(-1)).toBe(
			'<SKILL id="git" location="/skills/git/SKILL.md">\n# Git\n\n</SKILL>',
		);
	});

	it("keeps memory and the log advanced when the copy write is refused", () => {
		const h = harness();
		const assembly = createAssembly(h.ports);
		h.leaf = "leaf-1";
		h.failWrites = true;

		const first = assembly.change(ctx, { loads: [entry()] });

		expect(first.ok).toBe(true);
		expect(h.appends.length).toBe(1);
		expect(h.writes.length).toBe(0);
		expect(assembly.current().entries).toEqual([entry()]);
		expect(h.order).toEqual(["append", "copy", "register"]);

		h.failWrites = false;
		h.leaf = "leaf-2";
		const other = entry({ id: "other", path: "/skills/other/SKILL.md" });
		assembly.change(ctx, { loads: [other] });

		expect(h.writes.length).toBe(1);
		expect(h.writes[0].marker).toBe("leaf-2");
		expect(h.writes[0].state.entries).toEqual([entry(), other]);
	});
});

describe("settling against the path", () => {
	it("trusts a copy whose marker names the path's last commit entry", () => {
		const h = harness();
		const assembly = createAssembly(h.ports);
		h.path = [
			commit({ kind: "delta", operations: [{ kind: "load", entry: entry() }] }, "c1"),
		];
		h.copy = { marker: "c1", state: encode({ entries: [entry()] }) };

		assembly.start(ctx);

		expect(assembly.current().entries).toEqual([entry()]);
		expect(h.order).toEqual(["register"]);
	});

	it("folds the path and rewrites the copy when the marker diverges", () => {
		const h = harness();
		const assembly = createAssembly(h.ports);
		h.path = [
			commit({ kind: "delta", operations: [{ kind: "load", entry: entry() }] }, "c1"),
		];
		h.copy = { marker: "stale", state: encode({ entries: [] }) };

		assembly.start(ctx);

		expect(assembly.current().entries).toEqual([entry()]);
		expect(h.writes[0].marker).toBe("c1");
	});

	it("trusts the copy when the path has no commit entry", () => {
		const h = harness();
		const assembly = createAssembly(h.ports);
		h.copy = { marker: "anything", state: encode({ entries: [entry()] }) };

		assembly.start(ctx);

		expect(assembly.current().entries).toEqual([entry()]);
		expect(h.notices.length).toBe(1);
	});

	it("falls back to the copy and reports once when the fold aborts", () => {
		const h = harness();
		const assembly = createAssembly(h.ports);
		h.path = [
			commit(
				{
					kind: "delta",
					operations: [{ kind: "load", entry: entry({ id: "Bad Name" }) }],
				},
				"c1",
			),
		];
		h.copy = { marker: "stale", state: encode({ entries: [entry()] }) };

		assembly.start(ctx);
		assembly.start(ctx);

		expect(assembly.current().entries).toEqual([entry()]);
		expect(h.notices.length).toBe(1);
	});
});

describe("navigation", () => {
	it("folds to the new leaf and marks the copy with the last commit entry", () => {
		const h = harness();
		const assembly = createAssembly(h.ports);
		h.navigatePath = [
			commit({ kind: "delta", operations: [{ kind: "load", entry: entry() }] }, "c1"),
		];
		h.leaf = "leaf-9";

		assembly.navigate(ctx, "leaf-9");

		expect(assembly.current().entries).toEqual([entry()]);
		expect(h.writes[0].marker).toBe("c1");
		expect(h.segments.at(-1)).toContain('<SKILL id="git"');
	});
});

describe("the history switch", () => {
	it("does not append while history is off and marks the gap", () => {
		const h = harness();
		const assembly = createAssembly(h.ports);
		h.history = false;

		assembly.change(ctx, { loads: [entry()] });

		expect(h.appends.length).toBe(0);
		expect(h.writes[0].marker).toBeUndefined();
		expect(assembly.current().entries).toEqual([entry()]);
		expect(h.notices.length).toBe(1);
	});

	it("writes a baseline on the first change after history resumes", () => {
		const h = harness();
		const assembly = createAssembly(h.ports);
		h.history = false;
		assembly.change(ctx, { loads: [entry()] });
		h.history = true;
		h.leaf = "leaf-2";
		const other = entry({ id: "other", path: "/skills/other/SKILL.md" });

		assembly.change(ctx, { loads: [other] });

		expect(h.appends.at(-1)).toEqual({
			kind: "baseline",
			entries: [entry(), other],
		});
		expect(h.notices.length).toBe(2);
	});
});

describe("changes", () => {
	it("lands a replacement as a delta with the line diff", () => {
		const h = harness();
		const assembly = createAssembly(h.ports);
		assembly.change(ctx, { loads: [entry()] });
		h.leaf = "leaf-2";

		assembly.change(ctx, {
			loads: [entry({ body: "# Git v2\n", volume: { bytes: 9, lines: 1 } })],
		});

		expect(h.appends.at(-1)).toEqual({
			kind: "delta",
			operations: [
				{
					kind: "replace",
					id: "git",
					hunks: [{ start: 1, count: 1, text: "# Git v2\n" }],
				},
			],
		});
	});

	it("lands a cascade cancel as removes and reports what left", () => {
		const h = harness();
		const assembly = createAssembly(h.ports);
		const guide = entry({
			id: "git/references/GUIDE.md",
			path: "/skills/git/references/GUIDE.md",
			body: "# Guide\n",
			volume: { bytes: 8, lines: 1 },
		});
		assembly.change(ctx, { loads: [entry(), guide] });
		h.leaf = "leaf-2";

		const result = assembly.change(ctx, { cancels: ["git"] });

		expect(result).toEqual({ ok: true, outcomes: [], removed: [entry(), guide] });
		expect(h.appends.at(-1)).toEqual({
			kind: "delta",
			operations: [
				{ kind: "remove", id: "git" },
				{ kind: "remove", id: "git/references/GUIDE.md" },
			],
		});
	});

	it("lands nothing when the change fails", () => {
		const h = harness();
		const assembly = createAssembly(h.ports);

		const result = assembly.change(ctx, { cancels: ["absent"] });

		expect(result.ok).toBe(false);
		expect(h.appends.length).toBe(0);
		expect(h.writes.length).toBe(0);
		expect(h.segments.length).toBe(0);
	});

	it("lands nothing when a reload changes nothing", () => {
		const h = harness();
		const assembly = createAssembly(h.ports);
		assembly.change(ctx, { loads: [entry()] });
		h.order.length = 0;

		const result = assembly.change(ctx, { loads: [entry()] });

		expect(result).toEqual({ ok: true, outcomes: ["unchanged"], removed: [] });
		expect(h.order).toEqual([]);
	});
});

describe("the lifecycle", () => {
	it("re-registers the current block on demand", () => {
		const h = harness();
		const assembly = createAssembly(h.ports);

		assembly.ready();

		expect(h.segments).toEqual([""]);
	});

	it("clears memory on shutdown", () => {
		const h = harness();
		const assembly = createAssembly(h.ports);
		assembly.change(ctx, { loads: [entry()] });

		assembly.shutdown();

		expect(assembly.current().entries).toEqual([]);
	});
});

describe("the commit entry type", () => {
	it("names the customType the entries ride", () => {
		expect(COMMIT_ENTRY_TYPE).toBe("skill-tools-commit");
	});
});
