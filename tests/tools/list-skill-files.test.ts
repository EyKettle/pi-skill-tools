/**
 * `list_skill_files`: a skill's related files, each addressed the way an
 * argument would spell it, and every failure the read path can raise.
 */
import { describe, expect, it } from "vitest";
import { defineListSkillFilesTool } from "../../src/tools/list-skill-files";
import { EMPTY_LIST_FILES } from "../../src/model-channel/output";
import { isTransportPayload } from "../../src/tui-channel/payload";
import {
	changeOk,
	depsOf,
	makeWorld,
	stubTree,
	writeRef,
	writeSkill,
} from "./support/world";

function toolFor(world: ReturnType<typeof makeWorld>) {
	const { tree } = stubTree(changeOk([]));
	return defineListSkillFilesTool(depsOf(world, tree));
}

describe("list_skill_files", () => {
	it("names every related file by skill id and reference path", () => {
		const world = makeWorld();
		const dir = writeSkill(world.globalSkills, "git");
		writeRef(dir, "references/GUIDE.md", "# Guide\n");
		writeRef(dir, "scripts/run.sh", "#!/bin/sh\n");

		const outcome = toolFor(world).execute({ id: "git" });

		expect(outcome.isError).toBe(false);
		expect(outcome.content).toBe(
			`[git/references/GUIDE.md] ${dir}/references/GUIDE.md\n` +
				`[git/scripts/run.sh] ${dir}/scripts/run.sh`,
		);
		expect(outcome.details).toEqual({
			version: 1,
			tool: "list_skill_files",
			outcome: "success",
			data: { count: 2 },
		});
	});

	it("ignores a related-file suffix on the id", () => {
		const world = makeWorld();
		const dir = writeSkill(world.globalSkills, "git");
		writeRef(dir, "references/GUIDE.md", "# Guide\n");

		const outcome = toolFor(world).execute({
			id: "git/references/GUIDE.md",
		});

		expect(outcome.content).toBe(
			`[git/references/GUIDE.md] ${dir}/references/GUIDE.md`,
		);
	});

	it("answers the empty state for a skill without related files", () => {
		const world = makeWorld();
		writeSkill(world.globalSkills, "git");

		const outcome = toolFor(world).execute({ id: "git" });

		expect(outcome.content).toBe(EMPTY_LIST_FILES);
		expect(outcome.details.outcome).toBe("empty");
		expect(isTransportPayload(outcome.details)).toBe(true);
	});

	it("reports an unknown skill with ID_NOT_FOUND", () => {
		const world = makeWorld();
		const outcome = toolFor(world).execute({ id: "absent" });
		expect(outcome.isError).toBe(true);
		expect(outcome.details.outcome).toBe("failure");
		if (outcome.details.outcome !== "failure") return;
		expect(outcome.details.failure.code).toBe("ID_NOT_FOUND");
	});

	it("reports an ambiguous bare name with every candidate", () => {
		const world = makeWorld();
		writeSkill(world.globalSkills, "git");
		writeSkill(world.projectSkills, "git");

		const outcome = toolFor(world).execute({ id: "git" });

		expect(outcome.isError).toBe(true);
		if (outcome.details.outcome !== "failure") throw new Error("fixture");
		expect(outcome.details.failure.code).toBe("ID_AMBIGUOUS");
		expect(outcome.details.failure.evidence).toEqual({
			kind: "candidates",
			ids: ["global:git", "project:git"],
		});
	});

	it("reports an unregistered location prefix", () => {
		const world = makeWorld();
		const outcome = toolFor(world).execute({ id: "extra:git" });
		if (outcome.details.outcome !== "failure") throw new Error("fixture");
		expect(outcome.details.failure.code).toBe("ID_LOCATION_UNKNOWN");
	});

	it("writes the failure frame the model reads", () => {
		const world = makeWorld();
		const outcome = toolFor(world).execute({ id: "absent" });
		expect(outcome.content.split("\n")).toHaveLength(3);
		expect(outcome.content.startsWith("ErrorCode: ID_NOT_FOUND")).toBe(true);
	});

	it("declares the id parameter as required", () => {
		const world = makeWorld();
		const tool = toolFor(world);
		expect(Object.keys(tool.parameters.properties)).toEqual(["id"]);
		expect(tool.parameters.required).toEqual(["id"]);
	});
});
