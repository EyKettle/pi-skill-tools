/**
 * The payload family: builders derive the outcome, and the guard accepts the
 * family while rejecting every malformed shape.
 */
import { describe, expect, it } from "vitest";
import {
	buildCancelSkillPayload,
	buildCreateSkillPayload,
	buildFailurePayload,
	buildImportSkillPayload,
	buildListSkillFilesPayload,
	buildListSkillsPayload,
	buildListSkillTagsPayload,
	buildPreviewSkillPayload,
	buildRemoveSkillPayload,
	buildRenameSkillPayload,
	buildSearchSkillPayload,
	isTransportPayload,
} from "../../src/tui-channel/payload";
import { createFailure } from "../../src/failure/create";
import type { TransportPayload } from "../../src/tui-channel/types";

const payloads: TransportPayload[] = [
	buildListSkillsPayload({ count: 2, location: "global" }),
	buildListSkillsPayload({ count: 0 }),
	buildListSkillTagsPayload({ count: 2 }),
	buildListSkillTagsPayload({ count: 0 }),
	buildListSkillFilesPayload({ count: 1 }),
	buildListSkillFilesPayload({ count: 0 }),
	buildPreviewSkillPayload({ totalLines: 5, sectionLines: 2 }),
	buildPreviewSkillPayload({ totalLines: 0 }),
	buildSearchSkillPayload({ count: 1 }),
	buildSearchSkillPayload({ count: 0 }),
	buildImportSkillPayload({ displayIds: ["git"] }),
	buildCancelSkillPayload({ displayIds: ["git"] }),
	buildCreateSkillPayload({
		path: "/skills/git/SKILL.md",
		content: "# Git\n",
		lines: 1,
		bytes: 6,
	}),
	buildCreateSkillPayload({
		path: "/skills/empty/SKILL.md",
		content: "",
		lines: 0,
		bytes: 0,
	}),
	buildRenameSkillPayload({
		from: "alpha",
		to: "beta",
		kind: "skill",
		fileCount: 1,
	}),
	buildRemoveSkillPayload({ displayId: "git", kind: "file", fileCount: 1 }),
	buildFailurePayload(
		"preview_skill",
		createFailure("PATH_NOT_FOUND", { kind: "path", path: "/x" }),
	),
];

describe("the builders", () => {
	it("derive the empty outcome from the count the card prints", () => {
		const outcomes = payloads.map((payload) => payload.outcome);
		expect(outcomes).toEqual([
			"success",
			"empty",
			"success",
			"empty",
			"success",
			"empty",
			"success",
			"empty",
			"success",
			"empty",
			"success",
			"success",
			"success",
			"empty",
			"success",
			"success",
			"failure",
		]);
	});

	it("name the tool they belong to", () => {
		expect(payloads.map((payload) => payload.tool)).toEqual([
			"list_skills",
			"list_skills",
			"list_skill_tags",
			"list_skill_tags",
			"list_skill_files",
			"list_skill_files",
			"preview_skill",
			"preview_skill",
			"search_skill",
			"search_skill",
			"import_skill",
			"cancel_skill",
			"create_skill",
			"create_skill",
			"rename_skill",
			"remove_skill",
			"preview_skill",
		]);
	});
});

describe("isTransportPayload", () => {
	it("carries the single-file fact on a list_skill_files payload", () => {
		const payload = buildListSkillFilesPayload({ count: 0, singleFile: true });
		expect(payload.outcome).toBe("empty");
		expect(payload.data).toEqual({ count: 0, singleFile: true });
		expect(isTransportPayload(payload)).toBe(true);
	});

	it("accepts every built payload", () => {
		for (const payload of payloads) {
			expect(isTransportPayload(payload), JSON.stringify(payload.tool)).toBe(
				true,
			);
		}
	});

	it("accepts a payload that made a JSON round trip", () => {
		const noSection = buildPreviewSkillPayload({ totalLines: 2 });
		const noLocation = buildListSkillsPayload({ count: 0 });
		expect(isTransportPayload(JSON.parse(JSON.stringify(noSection)))).toBe(true);
		expect(isTransportPayload(JSON.parse(JSON.stringify(noLocation)))).toBe(
			true,
		);
	});

	it("rejects an unknown version", () => {
		expect(isTransportPayload({ ...payloads[0], version: 2 })).toBe(false);
	});

	it("rejects an unknown tool", () => {
		expect(
			isTransportPayload({ ...payloads[0], tool: "view_skill" }),
		).toBe(false);
	});

	it("rejects an unknown outcome", () => {
		expect(
			isTransportPayload({ ...payloads[0], outcome: "loading" }),
		).toBe(false);
	});

	it("rejects an empty outcome on a tool that has no empty state", () => {
		expect(isTransportPayload({ ...payloads[10], outcome: "empty" })).toBe(
			false,
		);
	});

	it("rejects an unknown key on the payload and on the data", () => {
		const payload = buildListSkillsPayload({ count: 1 });
		expect(isTransportPayload({ ...payload, extra: 1 })).toBe(false);
		expect(
			isTransportPayload({ ...payload, data: { ...payload.data, extra: 1 } }),
		).toBe(false);
	});

	it("rejects a malformed value", () => {
		const payload = buildListSkillsPayload({ count: 1 });
		expect(
			isTransportPayload({ ...payload, data: { count: -1 } }),
		).toBe(false);
		expect(
			isTransportPayload({ ...payload, data: { count: "1" } }),
		).toBe(false);
		expect(
			isTransportPayload({ ...payload, data: { count: 1, location: 5 } }),
		).toBe(false);
	});

	it("rejects a failure with an unknown code or a malformed recovery", () => {
		const failure = payloads[16];
		if (failure.outcome !== "failure") throw new Error("fixture");
		expect(
			isTransportPayload({
				...failure,
				failure: { ...failure.failure, code: "BOGUS" },
			}),
		).toBe(false);
		expect(
			isTransportPayload({
				...failure,
				failure: { ...failure.failure, recovery: "  " },
			}),
		).toBe(false);
		expect(
			isTransportPayload({
				...failure,
				failure: { ...failure.failure, evidence: { kind: "mystery" } },
			}),
		).toBe(false);
	});

	it("rejects an unknown data key even with the single-file fact", () => {
		const payload = buildListSkillFilesPayload({ count: 0, singleFile: true });
		expect(
			isTransportPayload({
				...payload,
				data: { ...payload.data, extra: true },
			}),
		).toBe(false);
	});

	it("rejects a value that is not an object", () => {
		expect(isTransportPayload(null)).toBe(false);
		expect(isTransportPayload("payload")).toBe(false);
		expect(isTransportPayload([])).toBe(false);
	});
});
