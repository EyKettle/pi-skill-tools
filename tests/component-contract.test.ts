/**
 * Component-contract regression for crash 01a0aa6d.
 *
 * pi hands a tool renderer's product to `MouseRegion`, whose `invalidate()`
 * calls `this.child.invalidate()` with no guard (pi-tui 0.85.1
 * components/mouse-region.ts:31). A product that implements only `render`
 * therefore turns any whole-tree invalidation — exit, `/reload`, fullscreen
 * mode switch — into `TypeError: this.child.invalidate is not a function`
 * and leaves the persisted session unresumable.
 *
 * Every product this extension returns to pi must satisfy that contract.
 */
import { describe, expect, it } from "vitest";
import { Box, Container, Text } from "../deps/pi-tui";
import { testTheme } from "../deps/pi-theme";
import { presentRow, rebuildPresentation, retainPresentation } from "../presentation";
import type { ProjectInput } from "../presentation";
import { defineCreateSkill } from "../tools/create-skill";
import { defineListSkillFiles } from "../tools/list-skill-files";
import { defineListSkills } from "../tools/list-skills";
import { defineListSkillTags } from "../tools/list-skill-tags";
import { defineSearchSkills } from "../tools/search-skills";
import type { ToolDeps } from "../tools/shared";
import { defineViewSkill } from "../tools/view-skill";

const theme = testTheme("dark");
const config = { agentDir: "/tmp/skill-tools-agent", configDirName: ".pi" };

interface ContractCandidate {
	render?: unknown;
	invalidate?: unknown;
}

interface Renderer {
	renderCall(...args: unknown[]): unknown;
	renderResult(...args: unknown[]): unknown;
}

function expectComponentContract(label: string, product: unknown): void {
	const candidate = product as ContractCandidate;
	expect(candidate, `${label} must be an object`).toBeTypeOf("object");
	expect(typeof candidate.render, `${label}.render`).toBe("function");
	expect(typeof candidate.invalidate, `${label}.invalidate`).toBe("function");
}

function deps(): ToolDeps {
	return {
		registryDeps: () => {
			throw new Error("execute is not under test");
		},
		Type: {
			Union: () => ({}),
			Literal: () => ({}),
			Object: () => ({}),
			Optional: () => ({}),
			Boolean: () => ({}),
			String: () => ({}),
			Record: () => ({}),
			Unknown: () => ({}),
		},
		Text: Text as ToolDeps["Text"],
		Box: Box as ToolDeps["Box"],
		Container: Container as ToolDeps["Container"],
		expandKeyHint: (_binding, fallback) => fallback,
	};
}

function renderers(): Array<[string, Renderer]> {
	const d = deps();
	return [
		["list_skills", defineListSkills(d) as unknown as Renderer],
		["list_skill_tags", defineListSkillTags(d) as unknown as Renderer],
		["search_skills", defineSearchSkills(d) as unknown as Renderer],
		["view_skill", defineViewSkill(d, config) as unknown as Renderer],
		["list_skill_files", defineListSkillFiles(d) as unknown as Renderer],
		["create_skill", defineCreateSkill(d, config) as unknown as Renderer],
	];
}

function context(isPartial: boolean): Record<string, unknown> {
	return {
		args: {},
		toolCallId: "contract-1",
		invalidate: () => {},
		lastComponent: undefined,
		state: {},
		cwd: "/tmp",
		executionStarted: !isPartial,
		argsComplete: !isPartial,
		isPartial,
		expanded: false,
		showImages: false,
		isError: false,
	};
}

const result = { content: [{ type: "text", text: "model unused" }], details: {} };

describe("every renderer product satisfies pi's Component contract", () => {
	for (const [name, tool] of renderers()) {
		describe(name, () => {
			it("renderCall while pending implements invalidate", () => {
				expectComponentContract(
					`${name}.renderCall(pending)`,
					tool.renderCall({}, theme, context(true)),
				);
			});

			it("renderCall once settled implements invalidate", () => {
				expectComponentContract(
					`${name}.renderCall(settled)`,
					tool.renderCall({}, theme, context(false)),
				);
			});

			it("renderResult collapsed implements invalidate", () => {
				expectComponentContract(
					`${name}.renderResult(collapsed)`,
					tool.renderResult(result, { expanded: false }, theme, context(false)),
				);
			});

			it("renderResult expanded implements invalidate", () => {
				expectComponentContract(
					`${name}.renderResult(expanded)`,
					tool.renderResult(result, { expanded: true }, theme, context(false)),
				);
			});
		});
	}
});

describe("presentation products satisfy pi's Component contract", () => {
	const input: ProjectInput = {
		tool: "list_skills",
		phase: "collapsed",
		payload: undefined,
		args: {},
		keyHint: (_binding, fallback) => fallback,
	};
	const slots = { Text, Container };

	it("presentRow implements invalidate", () => {
		expectComponentContract("presentRow", presentRow(input, theme, slots));
	});

	it("rebuildPresentation implements invalidate", () => {
		expectComponentContract(
			"rebuildPresentation",
			rebuildPresentation(retainPresentation(input), theme, slots),
		);
	});
});
