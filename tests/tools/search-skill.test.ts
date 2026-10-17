/**
 * `search_skill`: the filter grammar, the frontmatter shown verbatim, and the
 * failures a filter can raise.
 */
import { describe, expect, it } from "vitest";
import { defineSearchSkillTool } from "../../src/tools/search-skill";
import { EMPTY_SEARCH } from "../../src/model-channel/output";
import { isTransportPayload } from "../../src/tui-channel/payload";
import {
	changeOk,
	depsOf,
	makeWorld,
	stubTree,
	writeSkill,
} from "./support/world";

function toolFor(world: ReturnType<typeof makeWorld>) {
	const { tree } = stubTree(changeOk([]));
	return defineSearchSkillTool(depsOf(world, tree));
}

const GIT = "---\nname: git\nlicense: MIT\nmetadata:\n  tags: [state]\n---\n";
const PI = "---\nname: pi\nlicense: MIT\n---\n";

describe("search_skill", () => {
	it("writes the id, then the frontmatter verbatim", () => {
		const world = makeWorld();
		writeSkill(world.globalSkills, "git", GIT);

		const outcome = toolFor(world).execute({ filter: { license: "MIT" } });

		expect(outcome.content).toBe(
			`[git]\n${GIT.split("\n").slice(0, 6).join("\n")}`,
		);
	});

	it("blank-line separates several hits", () => {
		const world = makeWorld();
		writeSkill(world.globalSkills, "git", GIT);
		writeSkill(world.globalSkills, "pi", PI);

		const outcome = toolFor(world).execute({ filter: { license: "MIT" } });

		expect(outcome.content).toContain("---\n\n[pi]");
		expect(outcome.details).toEqual({
			version: 1,
			tool: "search_skill",
			outcome: "success",
			data: { location: undefined, count: 2 },
		});
	});

	it("ANDs the keys", () => {
		const world = makeWorld();
		writeSkill(world.globalSkills, "git", GIT);
		writeSkill(world.globalSkills, "pi", PI);

		const outcome = toolFor(world).execute({
			filter: { license: "MIT", "metadata.tags": "state" },
		});

		expect(outcome.content.startsWith("[git]")).toBe(true);
		expect(outcome.content).not.toContain("[pi]");
	});

	it("matches a /pattern/ value", () => {
		const world = makeWorld();
		writeSkill(world.globalSkills, "git", GIT);
		writeSkill(world.globalSkills, "pi", PI);

		const outcome = toolFor(world).execute({ filter: { name: "/^gi/" } });

		expect(outcome.content.startsWith("[git]")).toBe(true);
		expect(outcome.content).not.toContain("[pi]");
	});

	it("answers the empty state when nothing matches", () => {
		const world = makeWorld();
		writeSkill(world.globalSkills, "git", GIT);

		const outcome = toolFor(world).execute({ filter: { license: "Apache" } });

		expect(outcome.isError).toBe(false);
		expect(outcome.content).toBe(EMPTY_SEARCH);
		expect(outcome.details.outcome).toBe("empty");
	});

	it("narrows to one location", () => {
		const world = makeWorld();
		writeSkill(world.globalSkills, "git", GIT);
		writeSkill(world.projectSkills, "pi", PI);

		const outcome = toolFor(world).execute({
			filter: { license: "MIT" },
			location: "project",
		});

		expect(outcome.content.startsWith("[pi]")).toBe(true);
		expect(outcome.details).toEqual({
			version: 1,
			tool: "search_skill",
			outcome: "success",
			data: { location: "project", count: 1 },
		});
	});

	it("reports an invalid pattern once, with the key and the source", () => {
		const world = makeWorld();
		writeSkill(world.globalSkills, "git", GIT);
		writeSkill(world.globalSkills, "pi", PI);

		const outcome = toolFor(world).execute({ filter: { name: "/([a-z/" } });

		expect(outcome.isError).toBe(true);
		if (outcome.details.outcome !== "failure") throw new Error("fixture");
		expect(outcome.details.failure.code).toBe("FILTER_INVALID");
		expect(outcome.details.failure.evidence).toEqual({
			kind: "filter",
			key: "name",
			pattern: "([a-z",
		});
	});

	it("never matches a key the frontmatter lacks", () => {
		const world = makeWorld();
		writeSkill(world.globalSkills, "git", GIT);

		const outcome = toolFor(world).execute({ filter: { missing: "x" } });

		expect(outcome.content).toBe(EMPTY_SEARCH);
	});

	it("declares filter as required and location as optional", () => {
		const world = makeWorld();
		const tool = toolFor(world);
		expect(Object.keys(tool.parameters.properties).sort()).toEqual([
			"filter",
			"location",
		]);
		expect(tool.parameters.required).toEqual(["filter"]);
	});

	it("keeps every payload acceptable to the guard", () => {
		const world = makeWorld();
		writeSkill(world.globalSkills, "git", GIT);
		const outcome = toolFor(world).execute({ filter: { license: "MIT" } });
		expect(isTransportPayload(outcome.details)).toBe(true);
	});
});
