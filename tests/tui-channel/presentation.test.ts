/**
 * The card projection: the collapsed, expanded, empty, pending, and error
 * shapes, and the per-tool text the document states.
 *
 * `{output}` is the tool result's `content`; `{answer}` and `{info}` come from
 * `details`.
 */
import { describe, expect, it } from "vitest";
import { presentRow } from "../../src/tui-channel/presentation";
import type { PresentOptions } from "../../src/tui-channel/presentation";
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
} from "../../src/tui-channel/payload";
import { createFailure } from "../../src/failure/create";
import type { TransportPayload } from "../../src/tui-channel/types";

function options(overrides: Partial<PresentOptions> = {}): PresentOptions {
	return {
		tool: "list_skills",
		args: {},
		expanded: false,
		...overrides,
	};
}

function joined(projection: {
	call: readonly { text: string }[];
	result: readonly (readonly { text: string }[])[];
}): { call: string; result: string[] } {
	return {
		call: projection.call.map((span) => span.text).join(""),
		result: projection.result.map((line) =>
			line.map((span) => span.text).join(""),
		),
	};
}

describe("the call slot", () => {
	it("shows the title and the arguments while pending", () => {
		const projection = presentRow(
			undefined,
			options({
				tool: "preview_skill",
				args: { id: "git", section: "When to Use" },
			}),
		);
		expect(joined(projection).call).toBe('Preview git "When to Use" …');
		expect(projection.result).toEqual([]);
	});

	it("renders each list's object and the location", () => {
		expect(
			joined(
				presentRow(
					undefined,
					options({ tool: "list_skills", args: { location: "global" } }),
				),
			).call,
		).toBe("List skills global …");
		expect(
			joined(
				presentRow(
					undefined,
					options({ tool: "list_skill_files", args: { id: "git" } }),
				),
			).call,
		).toBe("List skill refs git …");
		expect(
			joined(
				presentRow(undefined, options({ tool: "list_skill_tags" })),
			).call,
		).toBe("List skill tags …");
	});

	it("renders a search's filter as key/value pairs", () => {
		const projection = presentRow(
			undefined,
			options({
				tool: "search_skill",
				args: { filter: { "metadata.tags": ["state", "recovery"] } },
			}),
		);
		expect(joined(projection).call).toBe(
			"Search metadata.tags: state, recovery …",
		);
	});

	it("states a create's amount on the pending line only", () => {
		const measure = { lines: 3, bytes: 23 };
		const pending = presentRow(
			undefined,
			options({
				tool: "create_skill",
				args: { id: "alpha", content: "line one\nline two\nthree" },
				measure,
			}),
		);
		expect(joined(pending).call).toBe("Create alpha (3 lines · 23 B)");

		const settled = presentRow(
			buildCreateSkillPayload({
				path: "/skills/alpha/SKILL.md",
				content: "line one\nline two\nthree\n",
				lines: 3,
				bytes: 23,
			}),
			options({
				tool: "create_skill",
				args: { id: "alpha", content: "line one\nline two\nthree" },
				measure,
			}),
		);
		// A settled line states the identity alone, even when the caller keeps
		// passing the amount.
		expect(joined(settled).call).toBe("Create alpha");
	});

	it("hides the id and the name from a rename's arguments", () => {
		const projection = presentRow(
			undefined,
			options({ tool: "rename_skill", args: { id: "alpha", name: "beta" } }),
		);
		// A label that is empty leaves no separator behind it.
		expect(joined(projection).call).toBe("Rename …");
	});
});

describe("the collapsed card", () => {
	it("shows the answer and the expand hint when there is output", () => {
		const projection = presentRow(
			buildListSkillsPayload({ count: 2 }),
			options({
				tool: "list_skills",
				keyHint: "ctrl+o",
				content: "[git] /skills/git/SKILL.md\n[pi] /skills/pi/SKILL.md\n",
			}),
		);
		expect(joined(projection)).toEqual({
			call: "List skills",
			result: ["Listed 2 skills  • ctrl+o to expand"],
		});
	});

	it("draws no hint when there is nothing to expand", () => {
		const projection = presentRow(
			buildListSkillsPayload({ count: 0 }),
			options({ tool: "list_skills", keyHint: "ctrl+o" }),
		);
		expect(joined(projection)).toEqual({
			call: "List skills",
			result: ["No skill found"],
		});
	});

	it("keeps the singular form", () => {
		expect(
			joined(
				presentRow(
					buildSearchSkillPayload({ count: 1 }),
					options({ tool: "search_skill" }),
				),
			).result,
		).toEqual(["Found 1 skill"]);
		expect(
			joined(
				presentRow(
					buildListSkillTagsPayload({ count: 1 }),
					options({ tool: "list_skill_tags" }),
				),
			).result,
		).toEqual(["Listed 1 tag"]);
	});
});

describe("the expanded card", () => {
	it("shows the info, the full arguments, and the content verbatim", () => {
		const content = "[git] /skills/git/SKILL.md\n[pi] /skills/pi/SKILL.md\n";
		const projection = presentRow(
			buildListSkillsPayload({ count: 2, location: "global" }),
			options({
				tool: "list_skills",
				args: { location: "global", detail: true },
				expanded: true,
				content,
			}),
		);
		expect(joined(projection).call).toBe("List (2)");
		expect(projection.fullArgs).toEqual([
			"location: global",
			"detail: true",
		]);
		expect(joined(projection).result).toEqual([
			"[git] /skills/git/SKILL.md",
			"[pi] /skills/pi/SKILL.md",
		]);
	});

	it("keeps a blank line the content carries", () => {
		const projection = presentRow(
			buildPreviewSkillPayload({ totalLines: 3, sectionLines: 2 }),
			options({
				tool: "preview_skill",
				expanded: true,
				content: "Total Lines: 3\n======\n## When to Use\n\nUse it.\n======\n",
			}),
		);
		expect(joined(projection).result).toEqual([
			"Total Lines: 3",
			"======",
			"## When to Use",
			"",
			"Use it.",
			"======",
		]);
	});

	it("falls back to the answer when the content is empty", () => {
		const projection = presentRow(
			buildListSkillsPayload({ count: 0 }),
			options({ tool: "list_skills", expanded: true }),
		);
		expect(joined(projection).result).toEqual(["No skill found"]);
	});
});

describe("the empty states", () => {
	it("uses the documented sentence per tool", () => {
		expect(
			joined(
				presentRow(
					buildListSkillTagsPayload({ count: 0 }),
					options({ tool: "list_skill_tags" }),
				),
			).result,
		).toEqual(["No tag found"]);
		expect(
			joined(
				presentRow(
					buildListSkillFilesPayload({ count: 0 }),
					options({ tool: "list_skill_files" }),
				),
			).result,
		).toEqual(["No file found"]);
		expect(
			joined(
				presentRow(
					buildListSkillFilesPayload({ count: 0, singleFile: true }),
					options({ tool: "list_skill_files" }),
				),
			).result,
		).toEqual(["Single file skill has no related files"]);
		expect(
			joined(
				presentRow(
					buildPreviewSkillPayload({ totalLines: 0 }),
					options({ tool: "preview_skill" }),
				),
			).result,
		).toEqual(["Nothing to view"]);
		expect(
			joined(
				presentRow(
					buildSearchSkillPayload({ count: 0 }),
					options({ tool: "search_skill" }),
				),
			).result,
		).toEqual(["No matches"]);
		expect(
			joined(
				presentRow(
					buildCreateSkillPayload({
						path: "/skills/empty/SKILL.md",
						content: "",
						lines: 0,
						bytes: 0,
					}),
					options({ tool: "create_skill" }),
				),
			).result,
		).toEqual(["Nothing to write"]);
	});
});

describe("rename and remove", () => {
	it("answers a rename with the arrow and the moved file count", () => {
		const projection = presentRow(
			buildRenameSkillPayload({
				from: "alpha",
				to: "beta",
				kind: "skill",
				fileCount: 2,
			}),
			options({
				tool: "rename_skill",
				expanded: true,
				content: "Moved path: /skills/beta\n",
			}),
		);
		expect(joined(projection).call).toBe("Rename (2 files)");
		expect(joined(projection).result).toEqual(["Moved path: /skills/beta"]);
	});

	it("shows the file count for a related file too", () => {
		const rename = presentRow(
			buildRenameSkillPayload({
				from: "alpha/references/a.md",
				to: "alpha/references/b.md",
				kind: "file",
				fileCount: 1,
			}),
			options({ tool: "rename_skill", expanded: true }),
		);
		const remove = presentRow(
			buildRemoveSkillPayload({
				displayId: "alpha/references/a.md",
				kind: "file",
				fileCount: 1,
			}),
			options({ tool: "remove_skill", expanded: true }),
		);
		expect(joined(rename).call).toBe("Rename (1 files)");
		expect(joined(remove).call).toBe("Remove (1 files)");
	});

	it("answers a removal with the id and the file count", () => {
		const projection = presentRow(
			buildRemoveSkillPayload({
				displayId: "git",
				kind: "skill",
				fileCount: 1,
			}),
			options({
				tool: "remove_skill",
				args: { id: "git" },
				expanded: true,
				content: "Removed folder: /skills/git\n",
			}),
		);
		expect(joined(projection)).toEqual({
			call: "Remove (1 files)",
			result: ["Removed folder: /skills/git"],
		});
	});
});

describe("the create override", () => {
	it("shows the path and the written body, not the model text", () => {
		const projection = presentRow(
			buildCreateSkillPayload({
				path: "/skills/git/SKILL.md",
				content: "# Git\n",
				lines: 1,
				bytes: 6,
			}),
			options({
				tool: "create_skill",
				args: { id: "git" },
				expanded: true,
				content: "Actual Wrote Path: /skills/git/SKILL.md\n",
			}),
		);
		expect(joined(projection).result).toEqual([
			"Path: /skills/git/SKILL.md",
			"======",
			"# Git",
			"======",
		]);
	});

	it("falls back to the answer for an empty write", () => {
		const projection = presentRow(
			buildCreateSkillPayload({
				path: "/skills/empty/SKILL.md",
				content: "",
				lines: 0,
				bytes: 0,
			}),
			options({ tool: "create_skill", expanded: true }),
		);
		expect(joined(projection).result).toEqual(["Nothing to write"]);
	});
});

describe("the load and unload labels", () => {
	it("renders one label per result with the action's role, and no shell", () => {
		const imported = presentRow(
			buildImportSkillPayload({ displayIds: ["git", "pi"] }),
			options({ tool: "import_skill" }),
		);
		expect(imported.call).toEqual([]);
		expect(imported.result).toEqual([]);
		expect(imported.labels).toEqual([
			{ text: "Skill::git", role: "success" },
			{ text: "Skill::pi", role: "success" },
		]);

		const cancelled = presentRow(
			buildCancelSkillPayload({ displayIds: ["git"] }),
			options({ tool: "cancel_skill" }),
		);
		expect(cancelled.labels).toEqual([
			{ text: "Skill::git", role: "error" },
		]);
	});
});

describe("the failure card", () => {
	const payload: TransportPayload = buildFailurePayload(
		"preview_skill",
		createFailure("PATH_NOT_FOUND", { kind: "path", path: "/x" }),
	);

	it("answers with the recovery and hides the info", () => {
		const projection = presentRow(
			payload,
			options({
				tool: "preview_skill",
				args: { id: "git" },
				expanded: true,
				content: "ignored",
			}),
		);
		expect(joined(projection).call).toBe("Preview ");
		expect(joined(projection).result).toEqual([
			createFailure("PATH_NOT_FOUND", { kind: "path", path: "/x" }).recovery,
		]);
		expect(projection.fullArgs).toEqual(["id: git"]);
	});
});
