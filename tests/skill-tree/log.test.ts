/**
 * The commit log: folding a path into the state it produces, including the
 * baseline that bridges a history gap.
 */
import { describe, expect, it } from "vitest";
import { fold } from "../../src/skill-tree/log";
import type {
	CommitEntry,
	StateEntry,
} from "../../src/skill-tree/types";

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

const api = entry({
	id: "global:git/references/API.md",
	path: "/skills/git/references/API.md",
	body: "# API\n",
});

describe("fold", () => {
	it("folds an empty log to the empty set", () => {
		expect(fold([])).toEqual({ ok: true, state: [] });
	});

	it("replays each change's operations in order", () => {
		const entries: CommitEntry[] = [
			{
				kind: "change",
				operations: [
					{ kind: "load", entry: entry() },
					{ kind: "load", entry: guide },
				],
			},
		];
		expect(fold(entries)).toEqual({ ok: true, state: [entry(), guide] });
	});

	it("applies a diff replacement to the accumulating body and keeps its slot", () => {
		const entries: CommitEntry[] = [
			{
				kind: "change",
				operations: [
					{ kind: "load", entry: entry() },
					{ kind: "load", entry: guide },
				],
			},
			{
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
			},
		];

		expect(fold(entries)).toEqual({
			ok: true,
			state: [entry({ body: "# Git v2\n" }), guide],
		});
	});

	it("applies a whole-body replacement", () => {
		const entries: CommitEntry[] = [
			{ kind: "change", operations: [{ kind: "load", entry: entry() }] },
			{
				kind: "change",
				operations: [
					{
						kind: "replace",
						id: "global:git",
						payload: { kind: "body", body: "# Rewritten\n" },
					},
				],
			},
		];

		expect(fold(entries)).toEqual({
			ok: true,
			state: [entry({ body: "# Rewritten\n" })],
		});
	});

	it("removes every unit of a cascade carried by one entry", () => {
		const entries: CommitEntry[] = [
			{
				kind: "change",
				operations: [
					{ kind: "load", entry: entry() },
					{ kind: "load", entry: guide },
					{ kind: "load", entry: api },
				],
			},
			{
				kind: "change",
				operations: [
					{ kind: "remove", id: "global:git" },
					{ kind: "remove", id: "global:git/references/GUIDE.md" },
					{ kind: "remove", id: "global:git/references/API.md" },
				],
			},
		];

		expect(fold(entries)).toEqual({ ok: true, state: [] });
	});

	it("carries loads and removes of one change together", () => {
		const other = entry({ id: "global:other", path: "/skills/other/SKILL.md" });
		const entries: CommitEntry[] = [
			{
				kind: "change",
				operations: [
					{ kind: "load", entry: entry() },
					{ kind: "load", entry: guide },
				],
			},
			{
				kind: "change",
				operations: [
					{ kind: "remove", id: "global:git/references/GUIDE.md" },
					{ kind: "load", entry: other },
				],
			},
		];

		expect(fold(entries)).toEqual({ ok: true, state: [entry(), other] });
	});

	it("starts from the last baseline on the path", () => {
		const early = entry({ body: "# Early\n" });
		const late = entry({ body: "# Late\n" });
		const entries: CommitEntry[] = [
			{ kind: "change", operations: [{ kind: "load", entry: early }] },
			{ kind: "baseline", entries: [late] },
			{ kind: "change", operations: [{ kind: "load", entry: guide }] },
		];

		expect(fold(entries)).toEqual({ ok: true, state: [late, guide] });
	});
});

describe("folding fails closed", () => {
	it("reports a malformed load entry", () => {
		const result = fold([
			{
				kind: "change",
				operations: [{ kind: "load", entry: entry({ id: "Bad Name" }) }],
			},
		]);
		expect(result).toEqual({ ok: false, index: 0, error: expect.any(String) });
	});

	it("reports an identity loaded twice", () => {
		const result = fold([
			{
				kind: "change",
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
			{ kind: "change", operations: [{ kind: "remove", id: "global:absent" }] },
		]);
		expect(result).toEqual({ ok: false, index: 0, error: expect.any(String) });
	});

	it("reports a replace whose target is not loaded", () => {
		const result = fold([
			{
				kind: "change",
				operations: [
					{
						kind: "replace",
						id: "global:absent",
						payload: { kind: "body", body: "x\n" },
					},
				],
			},
		]);
		expect(result).toEqual({ ok: false, index: 0, error: expect.any(String) });
	});

	it("reports a patch that does not fit the accumulated body", () => {
		const result = fold([
			{ kind: "change", operations: [{ kind: "load", entry: entry() }] },
			{
				kind: "change",
				operations: [
					{
						kind: "replace",
						id: "global:git",
						payload: {
							kind: "diff",
							blocks: [{ start: 9, count: 1, text: "x\n" }],
						},
					},
				],
			},
		]);
		expect(result).toEqual({ ok: false, index: 1, error: expect.any(String) });
	});

	it("reports a malformed baseline", () => {
		const result = fold([
			{ kind: "baseline", entries: [entry({ body: 42 as never })] },
		]);
		expect(result).toEqual({ ok: false, index: 0, error: expect.any(String) });
	});

	it("reports an empty change", () => {
		expect(fold([{ kind: "change", operations: [] }])).toEqual({
			ok: false,
			index: 0,
			error: expect.any(String),
		});
	});

	it("reports a change whose operations are not a list", () => {
		const result = fold([
			{ kind: "change", operations: {} } as unknown as CommitEntry,
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
