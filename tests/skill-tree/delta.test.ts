/**
 * The line diff: blocks in the old text's coordinates, exact reconstruction,
 * and the whole-body fallback that keeps a replacement within the document.
 */
import { describe, expect, it } from "vitest";
import {
	applyReplacement,
	buildReplacement,
} from "../../src/skill-tree/delta";

function diff(before: string, after: string, options = {}) {
	const payload = buildReplacement(before, after, options);
	return payload;
}

function blocksOf(before: string, after: string) {
	const payload = diff(before, after);
	expect(payload.kind).toBe("diff");
	if (payload.kind !== "diff") throw new Error("expected a diff payload");
	return payload.blocks;
}

describe("buildReplacement", () => {
	it("replaces a middle line as one block in the old text's coordinates", () => {
		expect(blocksOf("a\nb\nc\n", "a\nB\nc\n")).toEqual([
			{ start: 2, count: 1, text: "B\n" },
		]);
	});

	it("inserts before the first line", () => {
		expect(blocksOf("a\n", "x\na\n")).toEqual([
			{ start: 1, count: 0, text: "x\n" },
		]);
	});

	it("appends after the last line", () => {
		expect(blocksOf("a\n", "a\nb\n")).toEqual([
			{ start: 2, count: 0, text: "b\n" },
		]);
	});

	it("deletes a middle line", () => {
		expect(blocksOf("a\nb\nc\nd\n", "a\nc\nd\n")).toEqual([
			{ start: 2, count: 1, text: "" },
		]);
	});

	it("carries the whole body when deleting every line", () => {
		// The empty body is smaller than any block that spells the deletion.
		const payload = diff("a\nb\n", "");
		expect(payload).toEqual({ kind: "body", body: "" });
		expect(applyReplacement("a\nb\n", payload)).toBe("");
	});

	it("carries the whole body when building from an empty body", () => {
		const payload = diff("", "x\n");
		expect(payload).toEqual({ kind: "body", body: "x\n" });
		expect(applyReplacement("", payload)).toBe("x\n");
	});

	it("keeps a missing final newline as a difference", () => {
		expect(blocksOf("a\nb\n", "a\nb")).toEqual([
			{ start: 2, count: 1, text: "b" },
		]);
	});

	it("keeps a CR as a difference", () => {
		expect(blocksOf("a\r\nb\n", "a\nb\n")).toEqual([
			{ start: 1, count: 1, text: "a\n" },
		]);
	});

	it("finds scattered changes as several blocks", () => {
		const lines = Array.from({ length: 40 }, (_, index) => `line-${index}\n`);
		const next = [...lines];
		next[1] = "LINE-1\n";
		next[19] = "LINE-19\n";
		next[37] = "LINE-37\n";
		const before = lines.join("");
		const after = next.join("");

		expect(blocksOf(before, after)).toEqual([
			{ start: 2, count: 1, text: "LINE-1\n" },
			{ start: 20, count: 1, text: "LINE-19\n" },
			{ start: 38, count: 1, text: "LINE-37\n" },
		]);
		expect(applyReplacement(before, diff(before, after))).toBe(after);
	});

	it("leaves an unchanged text as no blocks", () => {
		expect(blocksOf("a\nb\n", "a\nb\n")).toEqual([]);
	});
});

describe("the whole-body fallback", () => {
	it("falls back when the diff aborts", () => {
		const payload = buildReplacement("a\nb\nc\n", "x\ny\nz\n", {
			maxEditLength: 0,
		});
		expect(payload).toEqual({ kind: "body", body: "x\ny\nz\n" });
		expect(applyReplacement("a\nb\nc\n", payload)).toBe("x\ny\nz\n");
	});

	it("falls back when a rewrite leaves nothing kept", () => {
		expect(buildReplacement("a\nb\n", "x\ny\n")).toEqual({
			kind: "body",
			body: "x\ny\n",
		});
	});

	it("falls back when the stored diff would not beat the body", () => {
		const lines = Array.from({ length: 40 }, (_, index) => `line-${index}\n`);
		const next = lines.map((line, index) =>
			index % 2 === 0 ? `changed-${index}\n` : line,
		);
		const before = lines.join("");
		const after = next.join("");

		expect(buildReplacement(before, after)).toEqual({
			kind: "body",
			body: after,
		});
	});
});

describe("applyReplacement", () => {
	const base = "a\nb\nc\n";

	it("applies blocks to the old text", () => {
		expect(
			applyReplacement(base, {
				kind: "diff",
				blocks: [{ start: 2, count: 1, text: "B\n" }],
			}),
		).toBe("a\nB\nc\n");
	});

	it("returns the body of a whole-body payload", () => {
		expect(applyReplacement(base, { kind: "body", body: "x\n" })).toBe("x\n");
	});

	it("rejects a block past the end of the text", () => {
		expect(
			applyReplacement(base, {
				kind: "diff",
				blocks: [{ start: 4, count: 1, text: "x\n" }],
			}),
		).toBeUndefined();
	});

	it("rejects overlapping or unordered blocks", () => {
		expect(
			applyReplacement(base, {
				kind: "diff",
				blocks: [
					{ start: 2, count: 1, text: "x\n" },
					{ start: 2, count: 1, text: "y\n" },
				],
			}),
		).toBeUndefined();
	});

	it("rejects coordinates that are not line numbers", () => {
		expect(
			applyReplacement(base, {
				kind: "diff",
				blocks: [{ start: 0, count: 1, text: "x\n" }],
			}),
		).toBeUndefined();
		expect(
			applyReplacement(base, {
				kind: "diff",
				blocks: [{ start: 1, count: -1, text: "x\n" }],
			}),
		).toBeUndefined();
	});
});
