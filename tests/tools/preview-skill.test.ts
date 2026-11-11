/**
 * `preview_skill`: the section tree, the sections a selection reaches, the
 * selections that reach none, and every failure the read path can raise.
 */
import { realpathSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { definePreviewSkillTool } from "../../src/tools/preview-skill";
import { EMPTY_PREVIEW } from "../../src/model-channel/output";
import { isTransportPayload } from "../../src/tui-channel/payload";
import { presentRow } from "../../src/tui-channel/presentation";
import { recoveryFor } from "../../src/failure/codes";
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

/** The source line a preview opens with: the resolved id and the absolute path. */
function sourceLineOf(dir: string, displayId: string, file = "SKILL.md"): string {
	return `[${displayId}] ${realpathSync(path.join(dir, file))}`;
}

const BODY = "# Skill\n\n## When to Use\nUse it here.\n\n## Other\nOther.\n";

describe("preview_skill", () => {
	it("lists the section tree when no section was asked for", () => {
		const world = makeWorld();
		const dir = writeSkill(world.globalSkills, "git", BODY);

		const outcome = toolFor(world).execute({ id: "git" });

		const lines = outcome.content.split("\n");
		expect(lines[0]).toBe(sourceLineOf(dir, "git"));
		expect(lines.slice(5)).toEqual([
			"======",
			"1:# Skill",
			"3:## When to Use",
			"6:## Other",
			"======",
		]);
	});

	it("asks for the tree when the selection list is empty", () => {
		const world = makeWorld();
		const dir = writeSkill(world.globalSkills, "git", BODY);

		const outcome = toolFor(world).execute({ id: "git", section: [] });

		const lines = outcome.content.split("\n");
		expect(lines[0]).toBe(sourceLineOf(dir, "git"));
		expect(lines.slice(5)).toEqual([
			"======",
			"1:# Skill",
			"3:## When to Use",
			"6:## Other",
			"======",
		]);
	});

	it("frames the section when one was asked for", () => {
		const world = makeWorld();
		const dir = writeSkill(world.globalSkills, "git", BODY);

		const outcome = toolFor(world).execute({
			id: "git",
			section: "When to Use",
		});

		expect(outcome.content.split("\n")[0]).toBe(sourceLineOf(dir, "git"));
		expect(outcome.content.split("\n").slice(5)).toEqual([
			"======",
			"## When to Use",
			"",
			"Use it here.",
			"======",
		]);
	});

	it("reads the section a line address names", () => {
		const world = makeWorld();
		writeSkill(world.globalSkills, "git", BODY);

		const outcome = toolFor(world).execute({ id: "git", section: 6 });

		expect(outcome.content.split("\n").slice(5)).toEqual([
			"======",
			"## Other",
			"",
			"Other.",
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

		expect(outcome.content).toContain(`Total Bytes: ${"# Guide\n".length}`);
		expect(outcome.content.split("\n")[0]).toBe(
			`[git/references/GUIDE.md] ${realpathSync(file)}`,
		);
		expect(outcome.content.split("\n")[1]).toBe("Total Lines: 1");
		expect(file).toContain("references");
	});

	it("reads a section of a related file", () => {
		const world = makeWorld();
		const dir = writeSkill(world.globalSkills, "git");
		writeRef(dir, "references/GUIDE.md", "# Guide\n\n## When to Use\nUse the guide.\n");

		const outcome = toolFor(world).execute({
			id: "git/references/GUIDE.md",
			section: "When to Use",
		});

		expect(outcome.content.split("\n").slice(5)).toEqual([
			"======",
			"## When to Use",
			"",
			"Use the guide.",
			"======",
		]);
	});

	it("folds the location prefix away in the source line", () => {
		const world = makeWorld();
		const dir = writeSkill(world.globalSkills, "git", BODY);

		const qualified = toolFor(world).execute({ id: "global:git" });
		const trailingSlash = toolFor(world).execute({ id: "git/" });

		expect(qualified.content.split("\n")[0]).toBe(sourceLineOf(dir, "git"));
		expect(trailingSlash.content.split("\n")[0]).toBe(sourceLineOf(dir, "git"));
	});

	it("keeps the location prefix for a name two locations share", () => {
		const world = makeWorld();
		const globalDir = writeSkill(world.globalSkills, "shared", BODY);
		const projectDir = writeSkill(world.projectSkills, "shared", BODY);

		const globalView = toolFor(world).execute({ id: "global:shared" });
		const projectView = toolFor(world).execute({ id: "project:shared" });

		expect(globalView.content.split("\n")[0]).toBe(
			sourceLineOf(globalDir, "global:shared"),
		);
		expect(projectView.content.split("\n")[0]).toBe(
			sourceLineOf(projectDir, "project:shared"),
		);
	});

	it("answers the empty state after the source line for an empty file", () => {
		const world = makeWorld();
		const dir = writeSkill(world.globalSkills, "empty", "");

		const outcome = toolFor(world).execute({ id: "empty" });

		expect(outcome.isError).toBe(false);
		expect(outcome.content).toBe(`${sourceLineOf(dir, "empty")}\n${EMPTY_PREVIEW}`);
		expect(outcome.details).toEqual({
			version: 1,
			tool: "preview_skill",
			outcome: "empty",
			data: { totalLines: 0, viewedLines: 0, issues: [] },
		});
	});

	it("names the volume the card prints", () => {
		const world = makeWorld();
		const dir = writeSkill(world.globalSkills, "git", BODY);

		const outcome = toolFor(world).execute({
			id: "git",
			section: "When to Use",
		});

		expect(outcome.details).toEqual({
			version: 1,
			tool: "preview_skill",
			outcome: "success",
			data: { totalLines: 7, viewedLines: 2, issues: [] },
		});
		// The source line is not a read line: the volume counts the section only.
		expect(outcome.content.split("\n")[0]).toBe(sourceLineOf(dir, "git"));
		if (outcome.details.outcome !== "success") throw new Error("fixture");
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

	it("shows the selectors a list carries", () => {
		const world = makeWorld();
		writeSkill(world.globalSkills, "git", BODY);

		const outcome = toolFor(world).execute({
			id: "git",
			section: ["When to Use", 6],
		});
		if (outcome.details.outcome !== "success") throw new Error("fixture");

		const card = presentRow(outcome.details, {
			tool: "preview_skill",
			args: { id: "git", section: ["When to Use", 6] },
			expanded: false,
			content: outcome.content,
		});

		expect(card.call.map((span) => span.text).join("")).toBe(
			'Preview git "When to Use", 6',
		);
	});

	it("keeps the sections that resolved beside the ones that did not", () => {
		const world = makeWorld();
		writeSkill(world.globalSkills, "git", BODY);

		const outcome = toolFor(world).execute({
			id: "git",
			section: ["When to Use", "Nope"],
		});

		expect(outcome.isError).toBe(false);
		expect(outcome.content.split("\n").slice(5)).toEqual([
			"======",
			"## When to Use",
			"",
			"Use it here.",
			"======",
			"[WARN] Some section selections failed:",
			`"Nope": SECTION_NOT_FOUND; ${recoveryFor("SECTION_NOT_FOUND")}`,
		]);
	});

	it("reports a selection that reached no heading without failing the call", () => {
		const world = makeWorld();
		const dir = writeSkill(world.globalSkills, "git", BODY);

		const outcome = toolFor(world).execute({ id: "git", section: "Nope" });

		expect(outcome.isError).toBe(false);
		expect(outcome.content.split("\n").slice(5)).toEqual([
			"======",
			"======",
			"[WARN] Some section selections failed:",
			`"Nope": SECTION_NOT_FOUND; ${recoveryFor("SECTION_NOT_FOUND")}`,
		]);
		if (outcome.details.outcome !== "success") throw new Error("fixture");
		expect(outcome.details.data).toEqual({
			totalLines: 7,
			viewedLines: 0,
			issues: [
				{
					selector: { kind: "name", name: "Nope" },
					failure: {
						code: "SECTION_NOT_FOUND",
						recovery: recoveryFor("SECTION_NOT_FOUND"),
						evidence: {
							kind: "section",
							path: `${dir}/SKILL.md`,
							selector: { kind: "name", name: "Nope" },
						},
					},
				},
			],
		});
	});

	it("lists the candidates a name reached", () => {
		const world = makeWorld();
		writeSkill(world.globalSkills, "git", "# Skill\n\n## Same\nOne.\n\n## Same\nTwo.\n");

		const outcome = toolFor(world).execute({ id: "git", section: "Same" });

		expect(outcome.isError).toBe(false);
		expect(outcome.content).toContain(
			`"Same": SECTION_AMBIGUOUS; matches "## Same" (3), "## Same" (6). ${recoveryFor("SECTION_AMBIGUOUS")}`,
		);
	});

	it("keeps a parent's body apart from its descendant's body", () => {
		const world = makeWorld();
		writeSkill(
			world.globalSkills,
			"git",
			"## Parent\nParent body.\n\n### Child\nChild body.\n",
		);

		const outcome = toolFor(world).execute({ id: "git", section: [1, 4] });

		expect(outcome.content.split("\n").slice(5)).toEqual([
			"======",
			"## Parent",
			"",
			"Parent body.",
			"",
			"4:### Child",
			"",
			"### Child",
			"",
			"Child body.",
			"======",
		]);
	});

	it("refuses a section argument it cannot read", () => {
		const world = makeWorld();
		writeSkill(world.globalSkills, "git", BODY);

		expect(() => toolFor(world).execute({ id: "git", section: { nope: true } })).toThrow();
	});

	it("leaves the loaded set alone", () => {
		const world = makeWorld();
		writeSkill(world.globalSkills, "git", BODY);
		const { tree, calls } = stubTree(changeOk([]));

		definePreviewSkillTool(depsOf(world, tree)).execute({ id: "git" });

		expect(calls.imported).toEqual([]);
		expect(calls.cancelled).toEqual([]);
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

	it("declares result content and an unchanged loaded set", () => {
		const tool = toolFor(makeWorld());

		expect(tool.description).toContain("returned in the tool result");
		expect(tool.description).toContain("neither loads nor mounts");
		expect(tool.description).not.toContain("nothing enters the context");
	});

	it("keeps every payload acceptable to the guard", () => {
		const world = makeWorld();
		writeSkill(world.globalSkills, "git", BODY);
		const outcome = toolFor(world).execute({ id: "git" });
		expect(isTransportPayload(outcome.details)).toBe(true);
	});

	it.each([
		{ section: "", viewedLines: 0, visibleText: "[WARN] Some section selections failed:" },
		{ section: ["When to Use", ""], viewedLines: 2, visibleText: "Use it here." },
		{ section: 1.5, viewedLines: 0, visibleText: "[WARN] Some section selections failed:" },
		{ section: ["When to Use", 1.5], viewedLines: 2, visibleText: "Use it here." },
	])("keeps completed results visible for section $section", ({ section, viewedLines, visibleText }) => {
		const world = makeWorld();
		writeSkill(world.globalSkills, "git", BODY);
		const args = { id: "git", section };

		const outcome = toolFor(world).execute(args);
		const payload = isTransportPayload(outcome.details) ? outcome.details : undefined;

		expect(outcome.isError).toBe(false);
		expect(outcome.content).toContain("SECTION_NOT_FOUND");
		expect(isTransportPayload(outcome.details)).toBe(true);
		const collapsed = presentRow(payload, {
			tool: "preview_skill",
			args,
			expanded: false,
			content: outcome.content,
		});
		const expanded = presentRow(payload, {
			tool: "preview_skill",
			args,
			expanded: true,
			content: outcome.content,
		});
		expect(collapsed.result.flat().map((span) => span.text).join("")).toBe(
			`Viewed ${viewedLines}/7 lines`,
		);
		const rendered = expanded.result.flat().map((span) => span.text).join("\n");
		expect(rendered).toContain(visibleText);
		expect(rendered).toContain("SECTION_NOT_FOUND");
	});

	it.each(["", " "])("keeps empty-title ambiguity visible for name %j", (name) => {
		const world = makeWorld();
		writeSkill(world.globalSkills, "git", "# \nfirst\n## \nsecond\n## Kept\nKept body.\n");

		const outcome = toolFor(world).execute({ id: "git", section: ["Kept", name] });

		expect(outcome.isError).toBe(false);
		expect(outcome.content).toContain("Kept body.");
		expect(outcome.content).toContain("SECTION_AMBIGUOUS");
		expect(isTransportPayload(outcome.details)).toBe(true);
		expect(outcome.details).toMatchObject({
			outcome: "success",
			data: {
				viewedLines: 2,
				totalLines: 6,
				issues: [{
					selector: { kind: "name", name },
					failure: {
						code: "SECTION_AMBIGUOUS",
						evidence: {
							name,
							candidates: [{ heading: "# ", line: 1 }, { heading: "## ", line: 3 }],
						},
					},
				}],
			},
		});
	});
});
