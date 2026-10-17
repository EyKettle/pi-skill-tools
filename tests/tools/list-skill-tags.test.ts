/**
 * `list_skill_tags`: the tags the index declares, joined on one line, and the
 * empty state.
 */
import { describe, expect, it } from "vitest";
import { defineListSkillTagsTool } from "../../src/tools/list-skill-tags";
import { EMPTY_LIST_TAGS } from "../../src/model-channel/output";
import { isTransportPayload } from "../../src/tui-channel/payload";
import { depsOf, makeWorld, stubTree, writeSkill } from "./support/world";
import { changeOk } from "./support/world";

function toolFor(world: ReturnType<typeof makeWorld>) {
	const { tree } = stubTree(changeOk([]));
	return defineListSkillTagsTool(depsOf(world, tree));
}

const TAGGED = "---\nname: git\nmetadata:\n  tags: [networking, pi]\n---\n";
const ALSO = "---\nname: pi\nmetadata:\n  tags: [networking]\n---\n";

describe("list_skill_tags", () => {
	it("joins every tag on one line, comma separated, sorted", () => {
		const world = makeWorld();
		writeSkill(world.globalSkills, "git", TAGGED);
		writeSkill(world.projectSkills, "pi", ALSO);

		const outcome = toolFor(world).execute({});

		expect(outcome.content).toBe("networking, pi");
	});

	it("narrows to one location", () => {
		const world = makeWorld();
		writeSkill(world.globalSkills, "git", TAGGED);
		writeSkill(world.projectSkills, "pi", ALSO);

		const outcome = toolFor(world).execute({ location: "project" });

		expect(outcome.content).toBe("networking");
		expect(outcome.details).toEqual({
			version: 1,
			tool: "list_skill_tags",
			outcome: "success",
			data: { location: "project", count: 1 },
		});
	});

	it("ignores a skill without tags", () => {
		const world = makeWorld();
		writeSkill(world.globalSkills, "bare", "---\nname: bare\n---\n");

		const outcome = toolFor(world).execute({});

		expect(outcome.content).toBe(EMPTY_LIST_TAGS);
		expect(outcome.details.outcome).toBe("empty");
	});

	it("reports an unparseable frontmatter as no tag, not a failure", () => {
		const world = makeWorld();
		writeSkill(world.globalSkills, "broken", "---\nname: [unclosed\n---\n");

		const outcome = toolFor(world).execute({});

		expect(outcome.isError).toBe(false);
		expect(outcome.content).toBe(EMPTY_LIST_TAGS);
	});

	it("declares only the location parameter", () => {
		const world = makeWorld();
		const tool = toolFor(world);
		expect(Object.keys(tool.parameters.properties)).toEqual(["location"]);
		expect(tool.parameters.required ?? []).toEqual([]);
	});

	it("feeds a payload the guard accepts", () => {
		const world = makeWorld();
		writeSkill(world.globalSkills, "git", TAGGED);
		const outcome = toolFor(world).execute({});
		expect(isTransportPayload(outcome.details)).toBe(true);
	});
});
