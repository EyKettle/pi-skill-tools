/**
 * Task 5c — induced component / invalidation / malformed-model
 * failures degrade to the design's width-safe fallback; a rebuild
 * reconstructs from retained data, not from themed children.
 *
 * Evidence: real @earendil-works/pi-tui Text/Container and the real
 * dark theme (pi-tui-rendering-harness.md). A stub renderer voids it.
 */
import { describe, expect, it } from "vitest";
import { Text, Container } from "../deps/pi-tui";
import { testTheme } from "../deps/pi-theme";
import {
	paintProjectedRow,
	presentRow,
	projectRow,
	rebuildPresentation,
	retainPresentation,
	visibleLength,
} from "../presentation";
import type { ProjectInput, SlotComponents } from "../presentation";
import { buildListSkillsPayload } from "../transport";
import type { TransportPayload } from "../transport";

const theme = testTheme("dark");

const SGR = /\x1b\[[0-9;]*m/g;

function keyHint(binding: string, fallback: string): string {
	if (binding !== "app.tools.expand") {
		throw new Error(`unexpected keybinding '${binding}'`);
	}
	return `Ctrl+O ${fallback}`;
}

const realComponents: SlotComponents = { Text, Container };

function visible(lines: string[]): string[] {
	return lines.map((line) => line.replace(SGR, "").trimEnd());
}

function contentWidth(lines: string[]): number {
	return Math.max(0, ...visible(lines).map((line) => visibleLength(line)));
}

/** Real Text that throws once, then constructs the genuine component. */
function onceThrowingText(): SlotComponents["Text"] {
	let thrown = false;
	return class {
		#inner: { render(width: number): string[] };
		constructor(content: string, paddingX?: number, paddingY?: number) {
			if (!thrown) {
				thrown = true;
				throw new Error("induced component failure");
			}
			this.#inner = new Text(content, paddingX, paddingY);
		}
		render(width: number): string[] {
			return this.#inner.render(width);
		}
	};
}

const listPayload = buildListSkillsPayload(2, null, [
	{ id: "git", filePath: "/skills/git/SKILL.md" },
	{ id: "notes", filePath: "/skills/notes/SKILL.md" },
]);

const settled: ProjectInput = {
	tool: "list_skills",
	phase: "collapsed",
	payload: listPayload,
	keyHint,
};

describe("malformed-model fallback", () => {
	it("missing payload on a settled row uses Result details unavailable, success shell", () => {
		const presented = presentRow(
			{ tool: "list_skills", phase: "collapsed", keyHint },
			theme,
			realComponents,
		);
		const lines = presented.render(80);
		expect(visible(lines)).toEqual(["list_skills · Result details unavailable"]);
		expect(visible(lines).join("\n")).not.toContain("to expand");
		expect(lines[0]).not.toContain(theme.fg("error", "Result details unavailable"));
		expect(lines[0]).toContain(theme.fg("toolTitle", "list_skills"));
	});

	it("a malformed success payload uses the same fixed wording as a missing one", () => {
		const malformed = {
			version: 1,
			tool: "list_skills",
			outcome: "success",
		} as unknown as TransportPayload;
		const lines = presentRow(
			{ tool: "list_skills", phase: "collapsed", payload: malformed, keyHint },
			theme,
			realComponents,
		).render(80);
		expect(visible(lines)).toEqual(["list_skills · Result details unavailable"]);
		expect(visible(lines).join("\n")).not.toMatch(/error:/);
		expect(visible(lines).join("\n")).not.toMatch(/suggestions:/);
	});

	it("a malformed error payload uses Tool execution failed, not model prose", () => {
		const malformed = {
			version: 1,
			tool: "list_skills",
			outcome: "failure",
			failure: { code: "NOT_A_CODE" },
		} as unknown as TransportPayload;
		const lines = presentRow(
			{ tool: "list_skills", phase: "collapsed", payload: malformed, keyHint },
			theme,
			realComponents,
		).render(80);
		expect(visible(lines)).toEqual(["list_skills · Tool execution failed"]);
		expect(lines[0]).toContain(theme.fg("error", "Tool execution failed"));
		expect(visible(lines).join("\n")).not.toContain("NOT_A_CODE");
	});

	it("a success payload for a different tool is not rendered as that success", () => {
		const lines = presentRow(
			{
				tool: "search_skills",
				phase: "collapsed",
				payload: listPayload,
				keyHint,
			},
			theme,
			realComponents,
		).render(80);
		expect(visible(lines)).toEqual([
			"search_skills · Result details unavailable",
		]);
		expect(visible(lines).join("\n")).not.toContain("listed");
	});
});

describe("component-failure fallback", () => {
	it("a throwing Text constructor degrades to the success-shell fallback on a composed row", () => {
		const lines = presentRow(settled, theme, {
			Text: onceThrowingText(),
			Container,
		}).render(80);
		expect(visible(lines)).toEqual(["list_skills · Result details unavailable"]);
		expect(contentWidth(lines)).toBeLessThanOrEqual(80);
		expect(lines[0]).toContain(theme.fg("toolTitle", "list_skills"));
	});
});

describe("invalidation-failure fallback", () => {
	it("a throwing rebuild degrades to the width-safe fallback instead of escaping", () => {
		const presented = presentRow(settled, theme, realComponents);
		expect(visible(presented.render(80)).join("\n")).toContain("listed");
		const lines = rebuildPresentation(presented.retained, theme, {
			Text: onceThrowingText(),
			Container,
		}).render(80);
		expect(visible(lines)).toEqual(["list_skills · Result details unavailable"]);
		expect(contentWidth(lines)).toBeLessThanOrEqual(80);
	});
});

describe("rebuild from retained data", () => {
	it("reconstructs the settled row from stored input, not pending", () => {
		const presented = presentRow(settled, theme, realComponents);
		const first = visible(presented.render(80));
		expect(first).toEqual([
			"list_skills · Ctrl+O to expand",
			"listed 2 skills",
		]);
		const retained = retainPresentation(settled);
		const rebuilt = visible(
			rebuildPresentation(retained, theme, realComponents).render(80),
		);
		expect(rebuilt).toEqual(first);
		expect(rebuilt.join("\n")).not.toEqual("list_skills");
		expect(presented.retained.input.phase).toBe("collapsed");
		expect(presented.retained.input.payload).toBe(listPayload);
	});

	it("does not keep themed children as the source of truth", () => {
		const presented = presentRow(settled, theme, realComponents);
		const retained = presented.retained;
		expect(retained).not.toHaveProperty("call");
		expect(retained).not.toHaveProperty("result");
		expect(Object.keys(retained)).toEqual(["input"]);
	});
});

describe("fallback width safety", () => {
	it("bounds the fallback wording before styling at a narrow width", () => {
		const lines = presentRow(
			{ tool: "list_skills", phase: "collapsed", keyHint },
			theme,
			realComponents,
		).render(20);
		for (const line of lines) {
			expect(visibleLength(line.replace(/\s+$/u, ""))).toBeLessThanOrEqual(20);
		}
	});
});

describe("projectRow missing payload (settled)", () => {
	it("does not return an empty row for a missing settled payload", () => {
		const row = projectRow({
			tool: "list_skills",
			phase: "collapsed",
			keyHint,
		});
		expect(row.call.length).toBeGreaterThan(0);
		const painted = paintProjectedRow(row, theme, realComponents).render(80);
		expect(visible(painted)[0]).toContain("Result details unavailable");
	});
});
