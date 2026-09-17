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
 * Every product this extension returns to pi must satisfy that contract, so
 * each renderer is called through its own signature and its product is
 * checked for the contract at run time. No cast stands in for the check.
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
const result = { content: [{ type: "text", text: "model unused" }], details: {} };

function expectComponentContract(label: string, product: unknown): void {
	expect(product, `${label} must be an object`).toBeTypeOf("object");
	const candidate = product as Record<string, unknown>;
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

function viewContext(overrides: { isPartial?: boolean }) {
	return {
		args: {},
		toolCallId: "contract",
		state: {},
		isPartial: overrides.isPartial ?? false,
		isError: false,
	};
}

describe("every renderer product satisfies pi's Component contract", () => {
	const d = deps();

	it("list_skills", () => {
		const tool = defineListSkills(d);
		expectComponentContract(
			"list_skills.renderCall(pending)",
			tool.renderCall({}, theme, { isPartial: true }),
		);
		expectComponentContract(
			"list_skills.renderCall(settled)",
			tool.renderCall({}, theme, { isPartial: false }),
		);
		expectComponentContract(
			"list_skills.renderResult(collapsed)",
			tool.renderResult(result, { expanded: false }, theme, {
				args: {},
				isError: false,
				state: {},
				toolCallId: "contract",
			}),
		);
		expectComponentContract(
			"list_skills.renderResult(expanded)",
			tool.renderResult(result, { expanded: true }, theme, {
				args: {},
				isError: false,
				state: {},
				toolCallId: "contract",
			}),
		);
	});

	it("list_skill_tags", () => {
		const tool = defineListSkillTags(d);
		expectComponentContract(
			"list_skill_tags.renderCall(pending)",
			tool.renderCall({}, theme, { state: {} }),
		);
		expectComponentContract(
			"list_skill_tags.renderCall(settled)",
			tool.renderCall({}, theme, { state: { settled: true } }),
		);
		expectComponentContract(
			"list_skill_tags.renderResult(collapsed)",
			tool.renderResult(result, { expanded: false }, theme, { state: {} }),
		);
		expectComponentContract(
			"list_skill_tags.renderResult(expanded)",
			tool.renderResult(result, { expanded: true }, theme, { state: {} }),
		);
	});

	it("search_skills", () => {
		const tool = defineSearchSkills(d);
		expectComponentContract(
			"search_skills.renderCall(pending)",
			tool.renderCall({}, theme, {}),
		);
		expectComponentContract(
			"search_skills.renderCall(settled)",
			tool.renderCall({}, theme, { isPartial: false }),
		);
		expectComponentContract(
			"search_skills.renderResult(collapsed)",
			tool.renderResult(result, { expanded: false }, theme, {}),
		);
		expectComponentContract(
			"search_skills.renderResult(expanded)",
			tool.renderResult(result, { expanded: true }, theme, {}),
		);
	});

	it("view_skill", () => {
		const tool = defineViewSkill(d, config);
		expectComponentContract(
			"view_skill.renderCall(pending)",
			tool.renderCall({}, theme, viewContext({ isPartial: true })),
		);
		expectComponentContract(
			"view_skill.renderCall(settled)",
			tool.renderCall({}, theme, viewContext({ isPartial: false })),
		);
		expectComponentContract(
			"view_skill.renderResult(collapsed)",
			tool.renderResult(result, { expanded: false, isPartial: false }, theme, viewContext({})),
		);
		expectComponentContract(
			"view_skill.renderResult(expanded)",
			tool.renderResult(result, { expanded: true, isPartial: false }, theme, viewContext({})),
		);
	});

	it("list_skill_files", () => {
		const tool = defineListSkillFiles(d);
		expectComponentContract(
			"list_skill_files.renderCall(pending)",
			tool.renderCall({}, theme, { state: {} }),
		);
		expectComponentContract(
			"list_skill_files.renderCall(settled)",
			tool.renderCall({}, theme, { state: { input: { phase: "collapsed" } } }),
		);
		expectComponentContract(
			"list_skill_files.renderResult(collapsed)",
			tool.renderResult(result, { expanded: false }, theme, { state: {} }),
		);
		expectComponentContract(
			"list_skill_files.renderResult(expanded)",
			tool.renderResult(result, { expanded: true }, theme, { state: {} }),
		);
	});

	it("create_skill", () => {
		const tool = defineCreateSkill(d, config);
		expectComponentContract(
			"create_skill.renderCall(pending)",
			tool.renderCall({}, theme, { state: {}, isPartial: true }),
		);
		expectComponentContract(
			"create_skill.renderCall(settled)",
			tool.renderCall({}, theme, { state: {}, isPartial: false }),
		);
		expectComponentContract(
			"create_skill.renderResult(collapsed)",
			tool.renderResult(result, { expanded: false, isPartial: false }, theme, { state: {} }),
		);
		expectComponentContract(
			"create_skill.renderResult(expanded)",
			tool.renderResult(result, { expanded: true, isPartial: false }, theme, { state: {} }),
		);
	});
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
