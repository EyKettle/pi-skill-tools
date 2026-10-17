/**
 * `list_skills`: the listing, the location filter, the detail addition, and
 * the empty state.
 */
import { describe, expect, it } from "vitest";
import { defineListSkillsTool } from "../../src/tools/list-skills";
import { EMPTY_LIST_SKILLS } from "../../src/model-channel/output";
import { isTransportPayload } from "../../src/tui-channel/payload";
import { presentRow } from "../../src/tui-channel/presentation";
import { depsOf, indexOf, makeWorld, stubTree, writeSkill } from "./support/world";
import { changeOk } from "./support/world";

function toolFor(world: ReturnType<typeof makeWorld>) {
	const { tree } = stubTree(changeOk([]));
	return defineListSkillsTool(depsOf(world, tree));
}

describe("list_skills", () => {
	it("writes one bracketed id and path per skill, in index order", () => {
		const world = makeWorld();
		writeSkill(world.globalSkills, "git", "---\nname: git\n---\n");
		writeSkill(world.projectSkills, "pi", "---\nname: pi\n---\n");

		const outcome = toolFor(world).execute({});

		expect(outcome.isError).toBe(false);
		expect(outcome.content).toBe(
			`[git] ${world.globalSkills}/git/SKILL.md\n` +
				`[pi] ${world.projectSkills}/pi/SKILL.md`,
		);
	});

	it("keeps the location prefix a shared name needs", () => {
		const world = makeWorld();
		writeSkill(world.globalSkills, "git");
		writeSkill(world.projectSkills, "git");

		const outcome = toolFor(world).execute({});

		expect(outcome.content).toBe(
			`[global:git] ${world.globalSkills}/git/SKILL.md\n` +
				`[project:git] ${world.projectSkills}/git/SKILL.md`,
		);
	});

	it("narrows to one location", () => {
		const world = makeWorld();
		writeSkill(world.globalSkills, "git");
		writeSkill(world.projectSkills, "pi");

		const outcome = toolFor(world).execute({ location: "project" });

		expect(outcome.content).toBe(
			`[pi] ${world.projectSkills}/pi/SKILL.md`,
		);
	});

	it("appends the description on detail", () => {
		const world = makeWorld();
		writeSkill(
			world.globalSkills,
			"git",
			"---\nname: git\ndescription: version control\n---\n",
		);
		writeSkill(world.globalSkills, "bare", "---\nname: bare\n---\n");

		const outcome = toolFor(world).execute({ detail: true });

		expect(outcome.content).toBe(
			`[bare] ${world.globalSkills}/bare/SKILL.md\n` +
				`[git] ${world.globalSkills}/git/SKILL.md — version control`,
		);
	});

	it("answers the empty state and the empty payload for no skills", () => {
		const world = makeWorld();

		const outcome = toolFor(world).execute({});

		expect(outcome.isError).toBe(false);
		expect(outcome.content).toBe(EMPTY_LIST_SKILLS);
		expect(outcome.details).toEqual({
			version: 1,
			tool: "list_skills",
			outcome: "empty",
			data: { location: undefined, count: 0 },
		});
	});

	it("names the count the card prints, not a list", () => {
		const world = makeWorld();
		writeSkill(world.globalSkills, "git");

		const outcome = toolFor(world).execute({ location: "global" });

		expect(outcome.details).toEqual({
			version: 1,
			tool: "list_skills",
			outcome: "success",
			data: { location: "global", count: 1 },
		});
	});

	it("declares the documented parameters", () => {
		const world = makeWorld();
		const tool = toolFor(world);
		expect(Object.keys(tool.parameters.properties).sort()).toEqual([
			"detail",
			"location",
		]);
		expect(tool.parameters.required ?? []).toEqual([]);
	});

	it("feeds a card that renders the answer and the model text", () => {
		const world = makeWorld();
		writeSkill(world.globalSkills, "git");

		const outcome = toolFor(world).execute({});
		expect(isTransportPayload(outcome.details)).toBe(true);
		if (outcome.details.outcome === "failure") throw new Error("fixture");
		const card = presentRow(outcome.details, {
			tool: "list_skills",
			args: {},
			expanded: true,
			content: outcome.content,
		});
		expect(card.call.map((span) => span.text).join("")).toBe("List (1)");
		expect(card.result.flat().map((span) => span.text)).toEqual(
			outcome.content.split("\n"),
		);
	});
});
