/**
 * Frontmatter: the leading YAML block, dotted-path lookup, and the search
 * filter grammar (string containment, list containment, /regex/).
 */
import { describe, expect, it } from "vitest";
import {
	compileFilter,
	getByPath,
	matchesFrontmatter,
	parseFrontmatterBlock,
} from "../../src/discovery/frontmatter";
import { recoveryFor } from "../../src/failure/codes";

const doc = `---
name: notepad
license: MIT
description: A small stateful notebook
metadata:
  tags: [state, recovery]
---

# Body
`;

const data = parseFrontmatterBlock(doc).data;

function matches(
	filter: Record<string, string | readonly string[]>,
): boolean {
	const compiled = compileFilter(filter);
	if (!compiled.ok) throw new Error("the filter should compile");
	return matchesFrontmatter(data, compiled.value);
}

describe("parseFrontmatterBlock", () => {
	it("extracts the data, the raw block, and the body offset", () => {
		const parsed = parseFrontmatterBlock(doc);
		expect(parsed.data.name).toBe("notepad");
		expect(parsed.raw?.startsWith("---")).toBe(true);
		expect(parsed.raw?.trimEnd().endsWith("---")).toBe(true);
		expect(doc.slice(parsed.bodyStart).startsWith("\n# Body")).toBe(true);
	});

	it("tolerates a BOM before the opening fence", () => {
		expect(parseFrontmatterBlock(`\uFEFF${doc}`).data.name).toBe("notepad");
	});

	it("returns empty data when the block is absent", () => {
		expect(parseFrontmatterBlock("# Body\n")).toEqual({
			data: {},
			bodyStart: 0,
		});
	});

	it("returns empty data when the block is unclosed", () => {
		expect(parseFrontmatterBlock("---\nname: x\n# Body\n").data).toEqual({});
	});

	it("returns empty data on malformed YAML", () => {
		expect(parseFrontmatterBlock("---\na: [1, 2\n---\n").data).toEqual({});
	});

	it("returns empty data when the block is not a mapping", () => {
		expect(parseFrontmatterBlock("---\n- a\n- b\n---\n").data).toEqual({});
	});
});

describe("getByPath", () => {
	it("reads a top-level key", () => {
		expect(getByPath(data, "name")).toBe("notepad");
	});

	it("reads a dotted path", () => {
		expect(getByPath(data, "metadata.tags")).toEqual(["state", "recovery"]);
	});

	it("returns undefined for a missing path", () => {
		expect(getByPath(data, "metadata.missing")).toBeUndefined();
	});

	it("returns undefined when a segment is not an object", () => {
		expect(getByPath(data, "name.length")).toBeUndefined();
	});
});

describe("matchesFrontmatter", () => {
	it("matches a scalar by substring, case-sensitively", () => {
		expect(matches({ license: "MIT" })).toBe(true);
		expect(matches({ license: "IT" })).toBe(true);
		expect(matches({ license: "mit" })).toBe(false);
	});

	it("matches an array value when one element contains the string", () => {
		expect(matches({ "metadata.tags": "recover" })).toBe(true);
		expect(matches({ "metadata.tags": "absent" })).toBe(false);
	});

	it("matches a list filter when any item is contained", () => {
		expect(matches({ "metadata.tags": ["absent", "state"] })).toBe(true);
		expect(matches({ "metadata.tags": ["absent"] })).toBe(false);
	});

	it("treats an empty list filter as matching nothing", () => {
		expect(matches({ "metadata.tags": [] })).toBe(false);
	});

	it("matches a /regex/ against the value", () => {
		expect(matches({ name: "/^note/" })).toBe(true);
		expect(matches({ name: "/^pad/" })).toBe(false);
		expect(matches({ "metadata.tags": "/cover/" })).toBe(true);
	});

	it("reads a lone slash as the literal string it is", () => {
		expect(matches({ license: "/" })).toBe(false);
	});

	it("ANDs across keys", () => {
		expect(matches({ license: "MIT", "metadata.tags": ["state"] })).toBe(true);
		expect(matches({ license: "MIT", "metadata.tags": ["absent"] })).toBe(
			false,
		);
	});

	it("fails closed on a missing key", () => {
		expect(matches({ nope: "x" })).toBe(false);
	});

	it("fails closed on a non-scalar document value", () => {
		expect(matches({ metadata: "state" })).toBe(false);
	});
});

describe("compileFilter", () => {
	it("reports an invalid pattern with its key and source", () => {
		const compiled = compileFilter({ name: "/([a-z/" });
		expect(compiled.ok).toBe(false);
		if (compiled.ok) return;
		expect(compiled.failure.code).toBe("FILTER_INVALID");
		expect(compiled.failure.recovery).toBe(recoveryFor("FILTER_INVALID"));
		expect(compiled.failure.evidence).toEqual({
			kind: "filter",
			key: "name",
			pattern: "([a-z",
		});
	});

	it("names the first offending key when several are invalid", () => {
		const compiled = compileFilter({
			license: "((",
			name: "/([/",
		});
		expect(compiled.ok).toBe(false);
		if (compiled.ok) return;
		expect(compiled.failure.evidence).toEqual({
			kind: "filter",
			key: "name",
			pattern: "([",
		});
	});
});
