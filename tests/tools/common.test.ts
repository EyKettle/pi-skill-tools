/**
 * The layer's two shared shapes: one failure rendered onto both channels, and
 * a batch argument normalized without dropping a member.
 */
import { describe, expect, it } from "vitest";
import { batchIds, resolveTarget } from "../../src/tools/common";
import { failureOutcome, successOutcome } from "../../src/tools/types";
import { createFailure } from "../../src/failure/create";
import { recoveryFor } from "../../src/failure/codes";
import { isTransportPayload } from "../../src/tui-channel/payload";
import { indexOf, makeWorld, writeSkill } from "./support/world";

describe("failureOutcome", () => {
	const failure = createFailure("PATH_NOT_FOUND", {
		kind: "path",
		path: "/skills/x/SKILL.md",
	});

	it("writes the model frame and the same failure into details", () => {
		const outcome = failureOutcome("preview_skill", failure);

		expect(outcome.isError).toBe(true);
		expect(outcome.content.split("\n")).toEqual([
			"ErrorCode: PATH_NOT_FOUND",
			'Reason: The path "/skills/x/SKILL.md" cannot be read as requested.',
			`Suggestion: ${recoveryFor("PATH_NOT_FOUND")}`,
		]);
		expect(outcome.details).toEqual({
			version: 1,
			tool: "preview_skill",
			outcome: "failure",
			failure,
		});
	});

	it("carries one Failure object into both channels, not two renderings", () => {
		const outcome = failureOutcome("list_skills", failure);
		if (outcome.details.outcome !== "failure") throw new Error("fixture");
		expect(outcome.details.failure).toBe(failure);
		expect(outcome.content).toContain(outcome.details.failure.recovery);
	});
});

describe("successOutcome", () => {
	it("marks the result as not an error", () => {
		const details = {
			version: 1 as const,
			tool: "list_skills" as const,
			outcome: "empty" as const,
			data: { count: 0 },
		};
		const outcome = successOutcome("No skill found", details);
		expect(outcome).toEqual({
			content: "No skill found",
			details,
			isError: false,
		});
		expect(isTransportPayload(outcome.details)).toBe(true);
	});
});

describe("batchIds", () => {
	it("turns one string into a batch of one", () => {
		expect(batchIds("git")).toEqual({ ok: true, ids: ["git"] });
	});

	it("keeps a list as it is, in order", () => {
		expect(batchIds(["git", "pi"])).toEqual({ ok: true, ids: ["git", "pi"] });
	});

	it("reports an empty batch", () => {
		for (const value of [[], "", undefined, null, 42]) {
			const batch = batchIds(value);
			expect(batch.ok, String(value)).toBe(false);
			if (batch.ok) continue;
			expect(batch.failure.code).toBe("BATCH_EMPTY");
		}
	});

	it("refuses a list with a non-string member instead of dropping it", () => {
		const batch = batchIds(["git", 42]);
		expect(batch.ok).toBe(false);
		if (batch.ok) return;
		expect(batch.failure.code).toBe("ID_NAME_INVALID");
		expect(batch.failure.evidence).toEqual({
			kind: "input",
			input: "git, 42",
		});
	});

	it("refuses a list with an empty member", () => {
		const batch = batchIds(["git", ""]);
		expect(batch.ok).toBe(false);
		if (batch.ok) return;
		expect(batch.failure.code).toBe("ID_NAME_INVALID");
	});
});

describe("resolveTarget", () => {
	it("names the entry and folds the prefix when the name is unique", () => {
		const world = makeWorld();
		writeSkill(world.globalSkills, "git");

		const target = resolveTarget(indexOf(world), "git");

		expect(target.ok).toBe(true);
		if (!target.ok) return;
		expect(target.entry.id).toBe("global:git");
		expect(target.displayId).toBe("git");
		expect(target.refPath).toBeUndefined();
	});

	it("keeps the prefix when two locations hold the name", () => {
		const world = makeWorld();
		writeSkill(world.globalSkills, "git");
		writeSkill(world.projectSkills, "git");

		const target = resolveTarget(indexOf(world), "global:git");

		expect(target.ok).toBe(true);
		if (!target.ok) return;
		expect(target.displayId).toBe("global:git");
	});

	it("carries the ref path through", () => {
		const world = makeWorld();
		const dir = writeSkill(world.globalSkills, "git");

		const target = resolveTarget(
			indexOf(world),
			"git/references/GUIDE.md",
		);

		expect(target.ok).toBe(true);
		if (!target.ok) return;
		expect(target.refPath).toBe("references/GUIDE.md");
		expect(target.displayId).toBe("git/references/GUIDE.md");
		expect(target.entry.baseDir).toBe(dir);
	});

	it("forwards the resolution failure unchanged", () => {
		const world = makeWorld();
		const target = resolveTarget(indexOf(world), "absent");
		expect(target.ok).toBe(false);
		if (target.ok) return;
		expect(target.failure.code).toBe("ID_NOT_FOUND");
	});
});
