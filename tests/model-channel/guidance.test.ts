/**
 * The appended guidance: the document's `## 追加引导` block, verbatim.
 *
 * The document is the single authority for this text; the constant is a copy
 * that must not drift from it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GUIDANCE_TEXT, PREVIEW_GUIDANCE_TEXT } from "../../src/model-channel/guidance";

const DOCUMENT = path.join(
	import.meta.dirname,
	"../../docs_zh-Hans/arch/model-channel.md",
);

/** One `text` fence under `## 追加引导`, without its fence lines. */
function documentedGuidance(index: 0 | 1): string {
	const text = readFileSync(DOCUMENT, "utf8");
	const section = text.indexOf("## 追加引导");
	expect(section).toBeGreaterThanOrEqual(0);
	const blocks = [...text.slice(section).matchAll(/```text\n([\s\S]*?)\n```/g)];
	const block = blocks[index];
	if (!block) throw new Error(`Documented guidance block ${index} is missing`);
	return block[1];
}

describe("GUIDANCE_TEXT", () => {
	it("carries the document's loaded-skill guidance word for word", () => {
		expect(GUIDANCE_TEXT).toBe(documentedGuidance(0));
	});
});

describe("PREVIEW_GUIDANCE_TEXT", () => {
	it("carries the document's preview-only guidance word for word", () => {
		expect(PREVIEW_GUIDANCE_TEXT).toBe(documentedGuidance(1));
	});
});
