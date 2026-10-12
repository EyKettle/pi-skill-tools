/**
 * The line diff: hunks in the old text's coordinates, exact reconstruction,
 * and the whole-text fallback (plan Task 2).
 */
import { describe, expect, it } from "vitest";
import { applyHunks, diffText } from "../delta";
import { readFileSync } from "node:fs";

describe("a delta reconstructs the new text exactly", () => {
	it("replaces a middle line as one hunk in the old text's coordinates", () => {
		const hunks = diffText("a\nb\nc\n", "a\nB\nc\n");

		expect(hunks).toEqual([{ start: 2, count: 1, text: "B\n" }]);
		expect(applyHunks("a\nb\nc\n", hunks)).toBe("a\nB\nc\n");
	});

	it("inserts before the first line", () => {
		const hunks = diffText("a\n", "x\na\n");

		expect(hunks).toEqual([{ start: 1, count: 0, text: "x\n" }]);
		expect(applyHunks("a\n", hunks)).toBe("x\na\n");
	});

	it("appends after the last line", () => {
		const hunks = diffText("a\n", "a\nb\n");

		expect(hunks).toEqual([{ start: 2, count: 0, text: "b\n" }]);
		expect(applyHunks("a\n", hunks)).toBe("a\nb\n");
	});

	it("deletes a middle line", () => {
		const hunks = diffText("a\nb\nc\nd\n", "a\nc\nd\n");

		expect(hunks).toEqual([{ start: 2, count: 1, text: "" }]);
		expect(applyHunks("a\nb\nc\nd\n", hunks)).toBe("a\nc\nd\n");
	});

	it("deletes every line", () => {
		const hunks = diffText("a\nb\n", "");

		expect(hunks).toEqual([{ start: 1, count: 2, text: "" }]);
		expect(applyHunks("a\nb\n", hunks)).toBe("");
	});

	it("builds from an empty body", () => {
		const hunks = diffText("", "x\n");

		expect(hunks).toEqual([{ start: 1, count: 0, text: "x\n" }]);
		expect(applyHunks("", hunks)).toBe("x\n");
	});

	it("keeps a missing final newline as a difference", () => {
		const hunks = diffText("a\nb\n", "a\nb");

		expect(hunks).toEqual([{ start: 2, count: 1, text: "b" }]);
		expect(applyHunks("a\nb\n", hunks)).toBe("a\nb");
	});

	it("keeps a CR as a difference", () => {
		const hunks = diffText("a\r\nb\n", "a\nb\n");

		expect(hunks).toEqual([{ start: 1, count: 1, text: "a\n" }]);
		expect(applyHunks("a\r\nb\n", hunks)).toBe("a\nb\n");
	});

	it("finds scattered changes as several hunks", () => {
		const lines = Array.from({ length: 40 }, (_, i) => `line-${i}\n`);
		const next = [...lines];
		next[1] = "LINE-1\n";
		next[19] = "LINE-19\n";
		next[37] = "LINE-37\n";
		const oldText = lines.join("");
		const newText = next.join("");

		const hunks = diffText(oldText, newText);

		expect(hunks).toEqual([
			{ start: 2, count: 1, text: "LINE-1\n" },
			{ start: 20, count: 1, text: "LINE-19\n" },
			{ start: 38, count: 1, text: "LINE-37\n" },
		]);
		expect(applyHunks(oldText, hunks)).toBe(newText);
	});

	it("leaves a text without changes as no hunks", () => {
		const hunks = diffText("a\nb\n", "a\nb\n");

		expect(hunks).toEqual([]);
		expect(applyHunks("a\nb\n", hunks)).toBe("a\nb\n");
	});
});

describe("a delta stays within the document", () => {
	it("falls back to the whole text on abort", () => {
		const hunks = diffText("a\nb\nc\n", "x\ny\nz\n", { maxEditLength: 0 });

		expect(hunks).toEqual([{ start: 1, count: 3, text: "x\ny\nz\n" }]);
		expect(applyHunks("a\nb\nc\n", hunks)).toBe("x\ny\nz\n");
	});

	it("carries the whole text when a rewrite leaves nothing kept", () => {
		const hunks = diffText("a\nb\n", "x\ny\n");

		expect(hunks).toEqual([{ start: 1, count: 2, text: "x\ny\n" }]);
	});


	it("carries the whole text when the encoded diff would not beat it", () => {
		const lines = Array.from({ length: 40 }, (_, i) => `line-${i}\n`);
		const next = lines.map((line, i) => (i % 2 === 0 ? `changed-${i}\n` : line));
		const oldText = lines.join("");
		const newText = next.join("");

		const hunks = diffText(oldText, newText);

		expect(hunks).toEqual([{ start: 1, count: 40, text: newText }]);
		expect(applyHunks(oldText, hunks)).toBe(newText);
	});
});

describe("applying hunks fails closed", () => {
	const base = "a\nb\nc\n";

	it("rejects a hunk past the end of the text", () => {
		expect(applyHunks(base, [{ start: 4, count: 1, text: "x\n" }])).toBeUndefined();
	});

	it("rejects overlapping or unordered hunks", () => {
		expect(
			applyHunks(base, [
				{ start: 2, count: 1, text: "x\n" },
				{ start: 2, count: 1, text: "y\n" },
			]),
		).toBeUndefined();
	});

	it("rejects a hunk whose fields are not line coordinates", () => {
		expect(applyHunks(base, [{ start: 0, count: 1, text: "x\n" }])).toBeUndefined();
		expect(applyHunks(base, [{ start: 1, count: -1, text: "x\n" }])).toBeUndefined();
	});
});

describe("module purity", () => {
	it("delta.ts imports only the diff library and stays off the filesystem", () => {
		const source = readFileSync(new URL("../delta.ts", import.meta.url), "utf8");
		const specifiers = Array.from(
			source.matchAll(/from\s+"([^"]+)"/g),
			(match) => match[1],
		);

		expect(specifiers.length).toBeGreaterThan(0);
		for (const specifier of specifiers) {
			expect(specifier, `unexpected import: ${specifier}`).toMatch(/^diff$|^\.\//);
			expect(specifier).not.toMatch(/node:|@earendil|session-state|\/deps\//);
		}
	});
});
