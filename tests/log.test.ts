/**
 * The commit log: entry shapes, folding, and marker validation (plan Task 2).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { copyIsCurrent, fold } from "../log";
import type { CommitEntry } from "../log";
import { EMPTY_SET } from "../state";
import type { StateEntry } from "../state";

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

describe("fold", () => {
	it("an empty log folds to the empty set", () => {
		expect(fold([])).toEqual({ ok: true, state: EMPTY_SET });
	});

	it("replays a load as the entry it carries", () => {
		const skill = entry();
		const ref = entry({
			refPath: "references/GUIDE.md",
			displayId: "git/references/GUIDE.md",
			path: "/skills/git/references/GUIDE.md",
			body: "# Guide\n",
			volume: { bytes: 8, lines: 1 },
		});

		const result = fold([
			{ kind: "delta", operations: [{ kind: "load", entry: skill }] },
			{ kind: "delta", operations: [{ kind: "load", entry: ref }] },
		]);

		expect(result).toEqual({ ok: true, state: { entries: [skill, ref] } });
	});

	it("applies a replace to the accumulating body and keeps its slot", () => {
		const skill = entry();
		const ref = entry({
			refPath: "references/GUIDE.md",
			displayId: "git/references/GUIDE.md",
			path: "/skills/git/references/GUIDE.md",
			body: "# Guide\n",
			volume: { bytes: 8, lines: 1 },
		});

		const result = fold([
			{
				kind: "delta",
				operations: [
					{ kind: "load", entry: skill },
					{ kind: "load", entry: ref },
				],
			},
			{
				kind: "delta",
				operations: [
					{
						kind: "replace",
						storage: "global",
						name: "git",
						hunks: [{ start: 1, count: 1, text: "# Git v2\n" }],
					},
				],
			},
		]);

		expect(result).toEqual({
			ok: true,
			state: {
				entries: [
					entry({ body: "# Git v2\n", volume: { bytes: 9, lines: 1 } }),
					ref,
				],
			},
		});
	});

	it("removes every unit of a cascade carried by one entry", () => {
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

		const result = fold([
			{
				kind: "delta",
				operations: [
					{ kind: "load", entry: skill },
					{ kind: "load", entry: guide },
					{ kind: "load", entry: api },
				],
			},
			{
				kind: "delta",
				operations: [
					{ kind: "remove", storage: "global", name: "git" },
					{
						kind: "remove",
						storage: "global",
						name: "git",
						refPath: "references/GUIDE.md",
					},
					{
						kind: "remove",
						storage: "global",
						name: "git",
						refPath: "references/API.md",
					},
				],
			},
		]);

		expect(result).toEqual({ ok: true, state: { entries: [] } });
	});

	it("carries loads and removes of one change together", () => {
		const skill = entry();
		const guide = entry({
			refPath: "references/GUIDE.md",
			displayId: "git/references/GUIDE.md",
			path: "/skills/git/references/GUIDE.md",
			body: "# Guide\n",
			volume: { bytes: 8, lines: 1 },
		});
		const other = entry({
			name: "other",
			displayId: "other",
			path: "/skills/other/SKILL.md",
		});

		const result = fold([
			{
				kind: "delta",
				operations: [
					{ kind: "load", entry: skill },
					{ kind: "load", entry: guide },
				],
			},
			{
				kind: "delta",
				operations: [
					{
						kind: "remove",
						storage: "global",
						name: "git",
						refPath: "references/GUIDE.md",
					},
					{ kind: "load", entry: other },
				],
			},
		]);

		expect(result).toEqual({ ok: true, state: { entries: [skill, other] } });
	});

	it("starts from the baseline on the path", () => {
		const early = entry({ body: "# Early\n", volume: { bytes: 8, lines: 1 } });
		const late = entry({ body: "# Late\n", volume: { bytes: 7, lines: 1 } });
		const guide = entry({
			refPath: "references/GUIDE.md",
			displayId: "git/references/GUIDE.md",
			path: "/skills/git/references/GUIDE.md",
			body: "# Guide\n",
			volume: { bytes: 8, lines: 1 },
		});

		const result = fold([
			{ kind: "delta", operations: [{ kind: "load", entry: early }] },
			{ kind: "baseline", entries: [late] },
			{ kind: "delta", operations: [{ kind: "load", entry: guide }] },
		]);

		expect(result).toEqual({ ok: true, state: { entries: [late, guide] } });
	});

	it("starts from the last baseline", () => {
		const early = entry({ body: "# Early\n", volume: { bytes: 8, lines: 1 } });
		const late = entry({ body: "# Late\n", volume: { bytes: 7, lines: 1 } });
		const guide = entry({
			refPath: "references/GUIDE.md",
			displayId: "git/references/GUIDE.md",
			path: "/skills/git/references/GUIDE.md",
			body: "# Guide\n",
			volume: { bytes: 8, lines: 1 },
		});

		const result = fold([
			{ kind: "baseline", entries: [early] },
			{ kind: "delta", operations: [{ kind: "load", entry: guide }] },
			{ kind: "baseline", entries: [late] },
		]);

		expect(result).toEqual({ ok: true, state: { entries: [late] } });
	});
});

describe("folding fails closed", () => {
	it("reports a malformed load entry", () => {
		const result = fold([
			{ kind: "delta", operations: [{ kind: "load", entry: entry({ name: "Bad Name" }) }] },
		]);

		expect(result).toEqual({ ok: false, index: 0, error: expect.any(String) });
	});

	it("reports an identity loaded twice", () => {
		const result = fold([
			{
				kind: "delta",
				operations: [
					{ kind: "load", entry: entry() },
					{ kind: "load", entry: entry() },
				],
			},
		]);

		expect(result).toEqual({ ok: false, index: 0, error: expect.any(String) });
	});

	it("reports a remove whose target is not loaded", () => {
		const result = fold([
			{
				kind: "delta",
				operations: [{ kind: "remove", storage: "global", name: "absent" }],
			},
		]);

		expect(result).toEqual({ ok: false, index: 0, error: expect.any(String) });
	});

	it("reports a replace whose target is not loaded", () => {
		const result = fold([
			{
				kind: "delta",
				operations: [
					{
						kind: "replace",
						storage: "global",
						name: "absent",
						hunks: [{ start: 1, count: 0, text: "x\n" }],
					},
				],
			},
		]);

		expect(result).toEqual({ ok: false, index: 0, error: expect.any(String) });
	});

	it("reports a patch that does not fit the accumulated body", () => {
		const result = fold([
			{ kind: "delta", operations: [{ kind: "load", entry: entry() }] },
			{
				kind: "delta",
				operations: [
					{
						kind: "replace",
						storage: "global",
						name: "git",
						hunks: [{ start: 9, count: 1, text: "x\n" }],
					},
				],
			},
		]);

		expect(result).toEqual({ ok: false, index: 1, error: expect.any(String) });
	});

	it("reports a baseline entry that is malformed", () => {
		const result = fold([
			{ kind: "baseline", entries: [entry({ volume: { bytes: -1, lines: 1 } })] },
		]);

		expect(result).toEqual({ ok: false, index: 0, error: expect.any(String) });
	});

	it("reports an empty change", () => {
		const result = fold([{ kind: "delta", operations: [] }]);

		expect(result).toEqual({ ok: false, index: 0, error: expect.any(String) });
	});

	it("reports a change whose operations are not a list", () => {
		const result = fold([
			{ kind: "delta", operations: {} } as unknown as CommitEntry,
		]);

		expect(result).toEqual({ ok: false, index: 0, error: expect.any(String) });
	});

	it("reports a baseline that is not a list", () => {
		const result = fold([
			{ kind: "baseline", entries: 42 } as unknown as CommitEntry,
		]);

		expect(result).toEqual({ ok: false, index: 0, error: expect.any(String) });
	});
});

describe("copyIsCurrent", () => {
	it("is current when the marker names the path's last commit entry", () => {
		expect(copyIsCurrent(true, "leaf-2", "leaf-2")).toBe(true);
	});

	it("is not current when the marker does not name it", () => {
		expect(copyIsCurrent(true, "leaf-1", "leaf-2")).toBe(false);
		expect(copyIsCurrent(true, undefined, "leaf-2")).toBe(false);
	});

	it("is not current without a copy", () => {
		expect(copyIsCurrent(false, "leaf-2", "leaf-2")).toBe(false);
	});

	it("treats a path with no commit entry as current", () => {
		expect(copyIsCurrent(true, undefined, undefined)).toBe(true);
		expect(copyIsCurrent(true, "leaf-1", undefined)).toBe(true);
	});
});

describe("module purity", () => {
	it("log.ts imports no filesystem, Pi, session-state, or deps modules", () => {
		const source = readFileSync(new URL("../log.ts", import.meta.url), "utf8");
		const specifiers = Array.from(
			source.matchAll(/from\s+"([^"]+)"/g),
			(match) => match[1],
		);

		expect(specifiers.length).toBeGreaterThan(0);
		for (const specifier of specifiers) {
			expect(specifier, `unexpected import: ${specifier}`).toMatch(/^\.\//);
			expect(specifier).not.toMatch(/node:|@earendil|session-state|\/deps\//);
		}
	});
});
