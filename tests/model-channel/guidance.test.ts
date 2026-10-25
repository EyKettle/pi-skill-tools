/**
 * The appended guidance: the document's `## 追加引导` block, verbatim.
 *
 * The document is the single authority for this text; the constant is a copy
 * that must not drift from it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GUIDANCE_TEXT } from "../../src/model-channel/guidance";

const DOCUMENT = path.join(
	import.meta.dirname,
	"../../docs_zh-CN/arch/model-channel.md",
);

/** The first `text` fence under `## 追加引导`, without its fence lines. */
function documentedGuidance(): string {
	const text = readFileSync(DOCUMENT, "utf8");
	const section = text.indexOf("## 追加引导");
	expect(section).toBeGreaterThanOrEqual(0);
	const fence = text.indexOf("```text\n", section);
	expect(fence).toBeGreaterThanOrEqual(0);
	const start = fence + "```text\n".length;
	const end = text.indexOf("```", start);
	expect(end).toBeGreaterThan(start);
	return text.slice(start, end).replace(/\n$/, "");
}

describe("GUIDANCE_TEXT", () => {
	it("carries the document's 追加引导 block word for word", () => {
		expect(GUIDANCE_TEXT).toBe(documentedGuidance());
	});
});
