/** The dependency boundary between ordinary tools and loaded-set tools. */
import { describe, expect, expectTypeOf, it } from "vitest";
import type { SkillTree } from "../../src/skill-tree/types";
import { defineCancelSkillTool } from "../../src/tools/cancel-skill";
import { defineImportSkillTool } from "../../src/tools/import-skill";
import { defineListSkillsTool } from "../../src/tools/list-skills";
import type { ToolDeps } from "../../src/tools/types";
import { indexOf, makeWorld, managementOf, writeSkill } from "./support/world";

describe("tool dependencies", () => {
	it("separates ordinary ports from the required loaded-set dependency", () => {
		const world = makeWorld();
		writeSkill(world.globalSkills, "git");
		const deps: ToolDeps = {
			index: () => indexOf(world),
			management: () => managementOf(world),
		};

		expectTypeOf<keyof ToolDeps>().toEqualTypeOf<"index" | "management">();
		expectTypeOf<ToolDeps>().not.toExtend<Parameters<typeof defineImportSkillTool>[0]>();
		expectTypeOf<ToolDeps>().not.toExtend<Parameters<typeof defineCancelSkillTool>[0]>();
		expectTypeOf<Parameters<typeof defineImportSkillTool>[0]["tree"]>().toEqualTypeOf<SkillTree>();
		expectTypeOf<Parameters<typeof defineCancelSkillTool>[0]["tree"]>().toEqualTypeOf<SkillTree>();

		const outcome = defineListSkillsTool(deps).execute({});

		expect(outcome.isError).toBe(false);
		expect(outcome.content).toBe(`[git] ${world.globalSkills}/git/SKILL.md`);
	});
});
