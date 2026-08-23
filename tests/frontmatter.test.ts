import { describe, expect, it } from "vitest";
import {
	getByPath,
	matchesFrontmatter,
	parseFrontmatterBlock,
	dumpFrontmatter,
} from "../frontmatter";

const doc = `---
name: notepad
license: MIT
metadata:
  tags: [state, recovery]
  hermes:
    tags: [orchestration]
---

# Body
`;

describe("parseFrontmatterBlock", () => {
	it("extracts data and the raw block", () => {
		const result = parseFrontmatterBlock(doc);
		expect(result.data.name).toBe("notepad");
		expect(result.raw?.startsWith("---")).toBe(true);
		expect(result.raw?.trimEnd().endsWith("---")).toBe(true);
	});

	it("returns empty data when frontmatter is absent", () => {
		expect(parseFrontmatterBlock("# Body\n").data).toEqual({});
	});

	it("returns empty data on malformed YAML", () => {
		expect(parseFrontmatterBlock("---\na: [1, 2\n---\n").data).toEqual({});
	});
});

describe("getByPath", () => {
	const data = parseFrontmatterBlock(doc).data;

	it("reads a top-level key", () => {
		expect(getByPath(data, "name")).toBe("notepad");
	});

	it("reads a dotted path", () => {
		expect(getByPath(data, "metadata.tags")).toEqual(["state", "recovery"]);
	});

	it("reads a deeply dotted path", () => {
		expect(getByPath(data, "metadata.hermes.tags")).toEqual(["orchestration"]);
	});

	it("returns undefined for a missing path", () => {
		expect(getByPath(data, "metadata.missing")).toBeUndefined();
	});
});

describe("matchesFrontmatter", () => {
	const data = parseFrontmatterBlock(doc).data;

	it("matches a scalar by stringified equality", () => {
		expect(matchesFrontmatter(data, { license: "MIT" })).toBe(true);
	});

	it("matches an array by non-empty intersection", () => {
		expect(matchesFrontmatter(data, { "metadata.tags": ["recovery"] })).toBe(
			true,
		);
	});

	it("ANDs across keys", () => {
		expect(
			matchesFrontmatter(data, { license: "MIT", "metadata.tags": ["state"] }),
		).toBe(true);
		expect(
			matchesFrontmatter(data, { license: "MIT", "metadata.tags": ["absent"] }),
		).toBe(false);
	});

	it("fails closed on a missing key", () => {
		expect(matchesFrontmatter(data, { nope: "x" })).toBe(false);
	});

	it("fails closed on an empty array filter", () => {
		expect(matchesFrontmatter(data, { "metadata.tags": [] })).toBe(false);
	});

	it("matches a scalar filter against an array value by membership", () => {
		expect(matchesFrontmatter(data, { "metadata.tags": "state" })).toBe(true);
	});
});

describe("dumpFrontmatter", () => {
	it("emits a minimal frontmatter block", () => {
		expect(
			dumpFrontmatter({ name: "x", description: "y", license: "MIT" }),
		).toBe(`---\nname: x\ndescription: y\nlicense: MIT\n---\n`);
	});

	it("emits metadata as indented YAML", () => {
		const out = dumpFrontmatter({
			name: "x",
			description: "y",
			metadata: { tags: ["a"] },
		});
		expect(out).toContain("tags:");
		expect(out).toContain("- a");
	});

	it("keeps a description containing `:` valid", () => {
		const out = dumpFrontmatter({
			name: "x",
			description: "a: b",
			license: "MIT",
		});
		expect(out).toContain('description: "a: b"');
	});
	it.each(["- foo", "? x", "a\nb", "123", "true", "null", "a: b", ""])(
		"re-parses the string scalar %j back to the original string",
		(value) => {
			const parsed = parseFrontmatterBlock(
				dumpFrontmatter({ description: value }),
			);
			expect(parsed.data).not.toEqual({});
			expect(parsed.data.description).toBe(value);
		},
	);

	it("keeps non-string scalars as their YAML types", () => {
		const parsed = parseFrontmatterBlock(
			dumpFrontmatter({ count: 123, active: true, extra: null }),
		);
		expect(parsed.data.count).toBe(123);
		expect(parsed.data.active).toBe(true);
		expect(parsed.data.extra).toBeNull();
	});

	it("emits only the requested keys, in caller order", () => {
		const out = dumpFrontmatter(
			{ name: "a", description: "b", license: "MIT" },
			{ keys: ["license", "name"] },
		);
		expect(out).toBe(`---\nlicense: MIT\nname: a\n---\n`);
	});
});
