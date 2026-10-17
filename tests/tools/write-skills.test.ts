/**
 * `create_skill`, `rename_skill`, and `remove_skill`: the three writes, their
 * conflict and read-only refusals, and the text each states.
 */
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { defineCreateSkillTool } from "../../src/tools/create-skill";
import { defineRenameSkillTool } from "../../src/tools/rename-skill";
import { defineRemoveSkillTool } from "../../src/tools/remove-skill";
import { EMPTY_CREATE } from "../../src/model-channel/output";
import { presentRow } from "../../src/tui-channel/presentation";
import { isTransportPayload } from "../../src/tui-channel/payload";
import {
	changeOk,
	depsOf,
	makeWorld,
	stubTree,
	writeRef,
	writeSkill,
} from "./support/world";

function toolsFor(world: ReturnType<typeof makeWorld>) {
	const { tree } = stubTree(changeOk([]));
	const deps = depsOf(world, tree);
	return {
		create: defineCreateSkillTool(deps),
		rename: defineRenameSkillTool(deps),
		remove: defineRemoveSkillTool(deps),
	};
}

const CONTENT = "---\nname: alpha\n---\n# Alpha\n";

describe("create_skill", () => {
	it("writes the content and names the path", () => {
		const world = makeWorld();
		const { create } = toolsFor(world);

		const outcome = create.execute({ id: "alpha", content: CONTENT });

		expect(outcome.isError).toBe(false);
		expect(outcome.content).toBe(
			`Actual Wrote Path: ${world.globalSkills}/alpha/SKILL.md`,
		);
		expect(outcome.details).toEqual({
			version: 1,
			tool: "create_skill",
			outcome: "success",
			data: {
				path: `${world.globalSkills}/alpha/SKILL.md`,
				content: CONTENT,
				lines: 4,
				bytes: CONTENT.length,
			},
		});
	});

	it("answers the empty state for empty content, with the card's block empty", () => {
		const world = makeWorld();
		const { create } = toolsFor(world);

		const outcome = create.execute({ id: "alpha", content: "" });

		expect(outcome.isError).toBe(false);
		expect(outcome.content).toBe(EMPTY_CREATE);
		expect(outcome.details).toEqual({
			version: 1,
			tool: "create_skill",
			outcome: "empty",
			data: {
				path: `${world.globalSkills}/alpha/SKILL.md`,
				content: "",
				lines: 0,
				bytes: 0,
			},
		});
	});

	it("refuses a name the index already holds", () => {
		const world = makeWorld();
		writeSkill(world.globalSkills, "alpha");
		const { create } = toolsFor(world);

		const outcome = create.execute({ id: "alpha", content: CONTENT });

		expect(outcome.isError).toBe(true);
		if (outcome.details.outcome !== "failure") throw new Error("fixture");
		expect(outcome.details.failure.code).toBe("TARGET_EXISTS");
		expect(outcome.details.failure.evidence).toEqual({
			kind: "conflict",
			target: { kind: "id", id: "global:alpha" },
		});
	});

	it("refuses a read-only location", () => {
		const world = makeWorld();
		const { create } = toolsFor(world);

		const outcome = create.execute({ id: "package:alpha", content: CONTENT });

		expect(outcome.isError).toBe(true);
		if (outcome.details.outcome !== "failure") throw new Error("fixture");
		expect(outcome.details.failure.code).toBe("LOCATION_READ_ONLY");
		expect(existsSync(path.join(world.globalSkills, "alpha"))).toBe(false);
	});

	it("creates a related file under an existing skill", () => {
		const world = makeWorld();
		const dir = writeSkill(world.globalSkills, "alpha");
		const { create } = toolsFor(world);

		const outcome = create.execute({
			id: "alpha/references/notes.md",
			content: "# Notes\n",
		});

		expect(outcome.isError).toBe(false);
		expect(outcome.content).toBe(
			`Actual Wrote Path: ${dir}/references/notes.md`,
		);
	});

	it("declares id and content as required", () => {
		const world = makeWorld();
		const { create } = toolsFor(world);
		expect(Object.keys(create.parameters.properties).sort()).toEqual([
			"content",
			"id",
		]);
		expect([...(create.parameters.required ?? [])].sort()).toEqual([
			"content",
			"id",
		]);
	});
});

describe("rename_skill", () => {
	it("moves the directory and names it with the moved files", () => {
		const world = makeWorld();
		const dir = writeSkill(world.globalSkills, "alpha");
		writeRef(dir, "references/a.md", "# A\n");
		const { rename } = toolsFor(world);

		const outcome = rename.execute({ id: "alpha", name: "beta" });

		const to = path.join(world.globalSkills, "beta");
		expect(outcome.isError).toBe(false);
		expect(outcome.content).toBe(
			[
				`Moved path: ${to}`,
				"Moved files:",
				`- ${to}/SKILL.md`,
				`- ${to}/references/a.md`,
			].join("\n"),
		);
		expect(outcome.details).toEqual({
			version: 1,
			tool: "rename_skill",
			outcome: "success",
			data: { from: "alpha", to: "beta", kind: "skill", fileCount: 2 },
		});
	});

	it("writes one line for a related file", () => {
		const world = makeWorld();
		const dir = writeSkill(world.globalSkills, "alpha");
		writeRef(dir, "references/a.md", "# A\n");
		const { rename } = toolsFor(world);

		const outcome = rename.execute({
			id: "alpha/references/a.md",
			name: "b.md",
		});

		expect(outcome.content).toBe(
			`Moved: ${dir}/references/b.md`,
		);
		if (outcome.details.outcome !== "success") throw new Error("fixture");
		expect(outcome.details.data).toEqual({
			from: "alpha/references/a.md",
			to: "alpha/references/b.md",
			kind: "file",
			fileCount: 1,
		});
	});

	it("answers with ids the reader can type back, not absolute paths", () => {
		const world = makeWorld();
		writeSkill(world.globalSkills, "alpha");
		const { rename } = toolsFor(world);

		const outcome = rename.execute({ id: "alpha", name: "beta" });

		if (outcome.details.outcome === "failure") throw new Error("fixture");
		const card = presentRow(outcome.details, {
			tool: "rename_skill",
			args: { id: "alpha", name: "beta" },
			expanded: false,
			content: outcome.content,
		});
		expect(card.result.flat().map((span) => span.text).join("")).toBe(
			"alpha → beta",
		);
	});

	it("keeps the location prefix when the new name is shared across locations", () => {
		const world = makeWorld();
		writeSkill(world.globalSkills, "alpha");
		writeSkill(world.projectSkills, "beta");
		// The target name is taken, so the move is refused before it starts.
		const { rename } = toolsFor(world);
		const refused = rename.execute({ id: "alpha", name: "beta" });
		expect(refused.isError).toBe(true);
	});

	it("refuses a name already taken", () => {
		const world = makeWorld();
		writeSkill(world.globalSkills, "alpha");
		writeSkill(world.globalSkills, "beta");
		const { rename } = toolsFor(world);

		const outcome = rename.execute({ id: "alpha", name: "beta" });

		expect(outcome.isError).toBe(true);
		if (outcome.details.outcome !== "failure") throw new Error("fixture");
		expect(outcome.details.failure.code).toBe("TARGET_EXISTS");
	});

	it("refuses a read-only location", () => {
		const world = makeWorld();
		writeSkill(world.globalSkills, "alpha");
		const { rename } = toolsFor(world);

		const outcome = rename.execute({ id: "alpha", name: "Bad_Name" });

		expect(outcome.isError).toBe(true);
		if (outcome.details.outcome !== "failure") throw new Error("fixture");
		expect(outcome.details.failure.code).toBe("ID_NAME_INVALID");
	});
});

describe("remove_skill", () => {
	it("removes the directory and names it with the files that left", () => {
		const world = makeWorld();
		const dir = writeSkill(world.globalSkills, "alpha");
		writeRef(dir, "references/a.md", "# A\n");
		const { remove } = toolsFor(world);

		const outcome = remove.execute({ id: "alpha" });

		expect(outcome.isError).toBe(false);
		expect(outcome.content).toBe(
			[
				`Removed folder: ${dir}`,
				"Removed files:",
				`- ${dir}/SKILL.md`,
				`- ${dir}/references/a.md`,
			].join("\n"),
		);
		expect(outcome.details).toEqual({
			version: 1,
			tool: "remove_skill",
			outcome: "success",
			data: { displayId: "alpha", kind: "skill", fileCount: 2 },
		});
		expect(existsSync(dir)).toBe(false);
	});

	it("removes one related file and keeps the skill", () => {
		const world = makeWorld();
		const dir = writeSkill(world.globalSkills, "alpha");
		writeRef(dir, "references/a.md", "# A\n");
		const { remove } = toolsFor(world);

		const outcome = remove.execute({ id: "alpha/references/a.md" });

		expect(outcome.content).toBe(
			`Removed: ${dir}/references/a.md`,
		);
		expect(existsSync(path.join(dir, "SKILL.md"))).toBe(true);
	});

	it("reports an unknown skill", () => {
		const world = makeWorld();
		const { remove } = toolsFor(world);

		const outcome = remove.execute({ id: "absent" });

		expect(outcome.isError).toBe(true);
		if (outcome.details.outcome !== "failure") throw new Error("fixture");
		expect(outcome.details.failure.code).toBe("ID_NOT_FOUND");
	});

	it("keeps every payload acceptable to the guard", () => {
		const world = makeWorld();
		writeSkill(world.globalSkills, "alpha");
		const { remove } = toolsFor(world);
		const outcome = remove.execute({ id: "alpha" });
		expect(isTransportPayload(outcome.details)).toBe(true);
	});
});
