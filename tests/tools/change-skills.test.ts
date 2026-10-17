/**
 * `import_skill` and `cancel_skill`: the batch shape, the rows they render,
 * and the failures the loaded set raises.
 */
import { describe, expect, it } from "vitest";
import { defineImportSkillTool } from "../../src/tools/import-skill";
import { defineCancelSkillTool } from "../../src/tools/cancel-skill";
import { createFailure } from "../../src/failure/create";
import { isTransportPayload } from "../../src/tui-channel/payload";
import {
	changeOk,
	depsOf,
	makeWorld,
	stubTree,
	writeSkill,
} from "./support/world";

describe("import_skill", () => {
	it("hands the ids to the tree and renders the rows it returns", () => {
		const world = makeWorld();
		const { tree, calls } = stubTree(
			changeOk([
				{ displayId: "git", action: "Loaded" },
				{ displayId: "pi", action: "Loaded" },
			]),
		);

		const outcome = defineImportSkillTool(depsOf(world, tree)).execute({
			id: ["git", "pi"],
		});

		expect(calls.imported).toEqual([["git", "pi"]]);
		expect(outcome.isError).toBe(false);
		expect(outcome.content).toBe("Loaded [git][pi]");
		expect(outcome.details).toEqual({
			version: 1,
			tool: "import_skill",
			outcome: "success",
			data: { displayIds: ["git", "pi"] },
		});
	});

	it("accepts one id as a batch of one", () => {
		const world = makeWorld();
		const { tree, calls } = stubTree(
			changeOk([{ displayId: "git", action: "Refreshed" }]),
		);

		const outcome = defineImportSkillTool(depsOf(world, tree)).execute({
			id: "git",
		});

		expect(calls.imported).toEqual([["git"]]);
		expect(outcome.content).toBe("Refreshed [git]");
	});

	it("refuses an empty batch before touching the tree", () => {
		const world = makeWorld();
		const { tree, calls } = stubTree(changeOk([]));

		const outcome = defineImportSkillTool(depsOf(world, tree)).execute({
			id: [],
		});

		expect(calls.imported).toEqual([]);
		expect(outcome.isError).toBe(true);
		if (outcome.details.outcome !== "failure") throw new Error("fixture");
		expect(outcome.details.failure.code).toBe("BATCH_EMPTY");
	});

	it("passes the tree's failure onto both channels", () => {
		const world = makeWorld();
		const failure = createFailure("ID_NOT_FOUND", {
			kind: "suggestions",
			names: ["git"],
		});
		const { tree } = stubTree({ ok: false, failure });

		const outcome = defineImportSkillTool(depsOf(world, tree)).execute({
			id: "absent",
		});

		expect(outcome.isError).toBe(true);
		if (outcome.details.outcome !== "failure") throw new Error("fixture");
		expect(outcome.details.failure).toBe(failure);
		expect(outcome.content).toContain("ErrorCode: ID_NOT_FOUND");
		expect(outcome.content).toContain(failure.recovery);
	});

	it("declares id as one string or a list", () => {
		const world = makeWorld();
		const { tree } = stubTree(changeOk([]));
		const tool = defineImportSkillTool(depsOf(world, tree));
		expect(Object.keys(tool.parameters.properties)).toEqual(["id"]);
		expect(tool.parameters.required).toEqual(["id"]);
		expect(JSON.stringify(tool.parameters.properties.id)).toContain("anyOf");
	});

	it("keeps every payload acceptable to the guard", () => {
		const world = makeWorld();
		const { tree } = stubTree(
			changeOk([{ displayId: "git", action: "Loaded" }]),
		);
		const outcome = defineImportSkillTool(depsOf(world, tree)).execute({
			id: "git",
		});
		expect(isTransportPayload(outcome.details)).toBe(true);
	});
});

describe("cancel_skill", () => {
	it("hands the ids to the tree and renders Unloaded rows", () => {
		const world = makeWorld();
		const { tree, calls } = stubTree(
			changeOk([{ displayId: "git", action: "Unloaded" }]),
		);

		const outcome = defineCancelSkillTool(depsOf(world, tree)).execute({
			id: "git",
		});

		expect(calls.cancelled).toEqual([["git"]]);
		expect(outcome.content).toBe("Unloaded [git]");
		expect(outcome.details).toEqual({
			version: 1,
			tool: "cancel_skill",
			outcome: "success",
			data: { displayIds: ["git"] },
		});
	});

	it("passes a not-loaded failure onto both channels", () => {
		const world = makeWorld();
		writeSkill(world.globalSkills, "git");
		const failure = createFailure("NOT_LOADED", {
			kind: "loaded",
			id: "git",
			loaded: [],
		});
		const { tree } = stubTree({ ok: false, failure });

		const outcome = defineCancelSkillTool(depsOf(world, tree)).execute({
			id: "git",
		});

		expect(outcome.isError).toBe(true);
		if (outcome.details.outcome !== "failure") throw new Error("fixture");
		expect(outcome.details.failure.code).toBe("NOT_LOADED");
		expect(outcome.content).toContain('"git" is not loaded, and nothing is loaded.');
	});

	it("refuses a list with a non-string member", () => {
		const world = makeWorld();
		const { tree, calls } = stubTree(changeOk([]));

		const outcome = defineCancelSkillTool(depsOf(world, tree)).execute({
			id: ["git", 7],
		});

		expect(calls.cancelled).toEqual([]);
		if (outcome.details.outcome !== "failure") throw new Error("fixture");
		expect(outcome.details.failure.code).toBe("ID_NAME_INVALID");
	});
});
