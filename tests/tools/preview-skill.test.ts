/**
 * `preview_skill`: the statistics, the section, the empty state, and every
 * failure the read path can raise.
 */
import { describe, expect, it } from "vitest";
import { definePreviewSkillTool } from "../../src/tools/preview-skill";
import { EMPTY_PREVIEW } from "../../src/model-channel/output";
import { isTransportPayload } from "../../src/tui-channel/payload";
import { presentRow } from "../../src/tui-channel/presentation";
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
	return definePreviewSkillTool(depsOf(world, tree));
}

const BODY = "# Skill\n\n## When to Use\nUse it here.\n\n## Other\nOther.\n";

describe("preview_skill", () => {
	it("writes the four statistics and no section when none was asked for", () => {
		const world = makeWorld();
		writeSkill(world.globalSkills, "git", BODY);

		const outcome = toolFor(world).execute({ id: "git" });

		const lines = outcome.content.split("\n");
		expect(lines).toHaveLength(4);
		expect(lines[0]).toBe("Total Lines: 7");
		expect(lines[1]).toBe(`Total Bytes: ${BODY.length}`);
		expect(lines[2]).toMatch(/^Created At: \d{4}-\d{2}-\d{2}T/);
		expect(lines[3]).toMatch(/^Updated At: \d{4}-\d{2}-\d{2}T/);
		expect(outcome.content).not.toContain("======");
	});

	it("frames the section when one was asked for", () => {
		const world = makeWorld();
		writeSkill(world.globalSkills, "git", BODY);

		const outcome = toolFor(world).execute({
			id: "git",
			section: "When to Use",
		});

		const lines = outcome.content.split("\n");
		expect(lines.slice(4)).toEqual([
			"======",
			"## When to Use",
			"Use it here.",
			"======",
		]);
	});

	it("previews a related file when the id carries a ref path", () => {
		const world = makeWorld();
		const dir = writeSkill(world.globalSkills, "git");
		const file = writeRef(dir, "references/GUIDE.md", "# Guide\n");

		const outcome = toolFor(world).execute({
			id: "git/references/GUIDE.md",
		});

		expect(outcome.content.startsWith("Total Lines: 1")).toBe(true);
		expect(outcome.content).toContain(`Total Bytes: ${"# Guide\n".length}`);
		expect(file).toContain("references");
	});

	it("answers the empty state for an empty file", () => {
		const world = makeWorld();
		writeSkill(world.globalSkills, "empty", "");

		const outcome = toolFor(world).execute({ id: "empty" });

		expect(outcome.isError).toBe(false);
		expect(outcome.content).toBe(EMPTY_PREVIEW);
		expect(outcome.details).toEqual({
			version: 1,
			tool: "preview_skill",
			outcome: "empty",
			data: { totalLines: 0, sectionLines: undefined },
		});
	});

	it("names the section's line count in the payload the card prints", () => {
		const world = makeWorld();
		writeSkill(world.globalSkills, "git", BODY);

		const outcome = toolFor(world).execute({
			id: "git",
			section: "When to Use",
		});

		expect(outcome.details).toEqual({
			version: 1,
			tool: "preview_skill",
			outcome: "success",
			data: { totalLines: 7, sectionLines: 2 },
		});
		if (outcome.details.outcome === "failure") return;
		const card = presentRow(outcome.details, {
			tool: "preview_skill",
			args: { id: "git", section: "When to Use" },
			expanded: false,
			content: outcome.content,
		});
		expect(card.result.flat().map((span) => span.text).join("")).toContain(
			"Viewed 2/7 lines",
		);
	});

	it("reports a missing section with its name and path", () => {
		const world = makeWorld();
		const dir = writeSkill(world.globalSkills, "git", BODY);

		const outcome = toolFor(world).execute({ id: "git", section: "Nope" });

		expect(outcome.isError).toBe(true);
		if (outcome.details.outcome !== "failure") throw new Error("fixture");
		expect(outcome.details.failure.code).toBe("SECTION_NOT_FOUND");
		expect(outcome.details.failure.evidence).toEqual({
			kind: "section",
			section: "Nope",
			path: `${dir}/SKILL.md`,
		});
	});

	it("reports a binary file as not text", () => {
		const world = makeWorld();
		const dir = writeSkill(world.globalSkills, "git");
		writeRef(dir, "assets/logo.bin", "a\u0000b");

		const outcome = toolFor(world).execute({ id: "git/assets/logo.bin" });

		expect(outcome.isError).toBe(true);
		if (outcome.details.outcome !== "failure") throw new Error("fixture");
		expect(outcome.details.failure.code).toBe("FILE_NOT_TEXT");
	});

	it("reports a missing related file", () => {
		const world = makeWorld();
		writeSkill(world.globalSkills, "git");

		const outcome = toolFor(world).execute({ id: "git/references/absent.md" });

		expect(outcome.isError).toBe(true);
		if (outcome.details.outcome !== "failure") throw new Error("fixture");
		expect(outcome.details.failure.code).toBe("PATH_NOT_FOUND");
	});

	it("refuses a reference that leaves the skill directory", () => {
		const world = makeWorld();
		writeSkill(world.globalSkills, "git");

		const outcome = toolFor(world).execute({ id: "git/../../elsewhere.md" });

		expect(outcome.isError).toBe(true);
		if (outcome.details.outcome !== "failure") throw new Error("fixture");
		expect(outcome.details.failure.code).toBe("REF_PATH_INVALID");
	});

	it("declares id as required and section as optional", () => {
		const world = makeWorld();
		const tool = toolFor(world);
		expect(Object.keys(tool.parameters.properties).sort()).toEqual([
			"id",
			"section",
		]);
		expect(tool.parameters.required).toEqual(["id"]);
	});

	it("keeps every payload acceptable to the guard", () => {
		const world = makeWorld();
		writeSkill(world.globalSkills, "git", BODY);
		const outcome = toolFor(world).execute({ id: "git" });
		expect(isTransportPayload(outcome.details)).toBe(true);
	});
});
