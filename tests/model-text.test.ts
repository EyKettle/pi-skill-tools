/**
 * Model-channel text builders — the `content[0].text` each tool returns.
 * Unit-tested outside the pi runtime; row layout lives in the row tests.
 */
import { describe, expect, it } from "vitest";
import { buildListOutput } from "../tools/list-skills";
import { buildTagsOutput } from "../tools/list-skill-tags";
import { buildSearchOutput } from "../tools/search-skills";
import { matchedValues } from "../frontmatter";
import { buildFilesOutput } from "../tools/list-skill-files";
import { wrapSkillBlock } from "../tools/view-skill";

describe("buildListOutput", () => {
	const entries = [
		{
			name: "alpha",
			id: "global:alpha",
			state: "active" as const,
			filePath: "/skills/alpha/SKILL.md",
			description: "A skill with tags",
		},
		{
			name: "beta",
			id: "project:beta",
			state: "shadowed" as const,
			filePath: "/proj/.pi/skills/beta/SKILL.md",
			description: "Beta",
		},
	];

	it("emits one line per entry: bare name, state marker, absolute path — no count line", () => {
		const out = buildListOutput(entries);
		expect(out).toBe(
			[
				"- alpha [active] /skills/alpha/SKILL.md",
				"- beta [shadowed] /proj/.pi/skills/beta/SKILL.md",
			].join("\n"),
		);
		expect(out).not.toMatch(/skills$/);
		expect(out).not.toContain("conflicts:");
	});

	it("adds the description to the entry line when detail is true", () => {
		expect(buildListOutput(entries, { detail: true })).toBe(
			[
				"- alpha [active] /skills/alpha/SKILL.md — A skill with tags",
				"- beta [shadowed] /proj/.pi/skills/beta/SKILL.md — Beta",
			].join("\n"),
		);
	});

	it("collapses line breaks inside descriptions so one entry stays one line", () => {
		const multiLine = [
			{
				name: "alpha",
				id: "global:alpha",
				state: "active" as const,
				filePath: "/skills/alpha/SKILL.md",
				description: "Line one\nLine two",
			},
		];
		expect(buildListOutput(multiLine, { detail: true })).toBe(
			"- alpha [active] /skills/alpha/SKILL.md — Line one Line two",
		);
	});

	it("emits a single bare-named row without any count line", () => {
		expect(buildListOutput([entries[0]])).toBe(
			"- alpha [active] /skills/alpha/SKILL.md",
		);
	});

	it("prefixes the id only for conflicting names; other names stay bare", () => {
		const conflicts = [
			{ name: "alpha", participants: ["project:alpha", "global:alpha"] },
		];
		const out = buildListOutput(entries, { conflicts });
		expect(out).toBe(
			[
				"- global:alpha [active] /skills/alpha/SKILL.md",
				"- beta [shadowed] /proj/.pi/skills/beta/SKILL.md",
			].join("\n"),
		);
		expect(out).not.toContain("conflicts:");
		expect(out).not.toMatch(/skills$/);
	});

	it("omits the conflicts block when no conflicts exist", () => {
		expect(buildListOutput(entries)).not.toContain("conflicts:");
	});

	it("names the empty list even when conflicts are reported", () => {
		const conflicts = [
			{ name: "alpha", participants: ["project:alpha", "global:alpha"] },
			{ name: "zeta", participants: ["project:zeta", "local:zeta"] },
		];
		expect(buildListOutput([], { conflicts })).toBe("no skills");
	});
});

describe("buildTagsOutput", () => {
	it("joins tag names alphabetically into one comma-separated line", () => {
		const byTag = new Map([
			["markdown", ["global:docs", "global:blog"]],
			["formatting", ["global:docs"]],
		]);
		expect(buildTagsOutput(byTag)).toBe("formatting, markdown");
	});

	it("names the empty tag list", () => {
		expect(buildTagsOutput(new Map())).toBe("no tags");
	});
});

describe("buildSearchOutput", () => {
	const deploy = {
		id: "global:deploy",
		name: "deploy",
		filePath: "/skills/deploy/SKILL.md",
		matchedKeys: [
			{ key: "name", values: [{ value: "deploy", matched: true }] },
		],
	};
	const projectDeploy = {
		id: "project:deploy",
		name: "deploy",
		filePath: "/proj/.pi/skills/deploy/SKILL.md",
		matchedKeys: [
			{ key: "name", values: [{ value: "deploy", matched: true }] },
		],
	};

	it("emits headerless entries: display id plus absolute path, blank-line separated, no bullets", () => {
		const out = buildSearchOutput([deploy, projectDeploy], {
			conflicts: [
				{ name: "deploy", participants: ["global:deploy", "project:deploy"] },
			],
		});
		expect(out).toBe(
			[
				"global:deploy /skills/deploy/SKILL.md",
				"name: deploy",
				"",
				"project:deploy /proj/.pi/skills/deploy/SKILL.md",
				"name: deploy",
			].join("\n"),
		);
		expect(out).not.toContain("- ");
	});

	it("prefixes the id only for conflicted names; non-conflicted names stay bare", () => {
		const out = buildSearchOutput(
			[
				{
					id: "global:alpha",
					name: "alpha",
					filePath: "/skills/alpha/SKILL.md",
					matchedKeys: [
						{ key: "name", values: [{ value: "alpha", matched: true }] },
					],
				},
				projectDeploy,
			],
			{
				conflicts: [
					{ name: "deploy", participants: ["global:deploy", "project:deploy"] },
				],
			},
		);
		expect(out).toBe(
			[
				"alpha /skills/alpha/SKILL.md",
				"name: alpha",
				"",
				"project:deploy /proj/.pi/skills/deploy/SKILL.md",
				"name: deploy",
			].join("\n"),
		);
	});

	it("renders single-valued keys bare and asterisk-wraps matched items of multi-valued keys", () => {
		expect(
			buildSearchOutput([
				{
					id: "global:tagged",
					name: "tagged",
					filePath: "/skills/tagged/SKILL.md",
					matchedKeys: [
						{
							key: "metadata.tags",
							values: [
								{ value: "networking", matched: true },
								{ value: "tui", matched: false },
							],
						},
						{ key: "name", values: [{ value: "tagged", matched: true }] },
					],
				},
			]),
		).toBe(
			[
				"tagged /skills/tagged/SKILL.md",
				"metadata.tags: *networking*, tui",
				"name: tagged",
			].join("\n"),
		);
	});

	it("emits a plain no matches line when empty", () => {
		expect(buildSearchOutput([])).toBe("no matches");
	});
});

describe("matchedValues", () => {
	it("maps an array doc value to per-element entries, flagging only the matches", () => {
		expect(
			matchedValues(
				{ metadata: { tags: ["networking", "tui"] } },
				"metadata.tags",
				["networking"],
			),
		).toEqual([
			{ value: "networking", matched: true },
			{ value: "tui", matched: false },
		]);
	});

	it("yields a single always-matched entry for a scalar doc value", () => {
		expect(matchedValues({ name: "alpha" }, "name", "alpha")).toEqual([
			{ value: "alpha", matched: true },
		]);
	});

	it("yields an empty array when the doc key is missing", () => {
		expect(matchedValues({ name: "alpha" }, "metadata.tags", "docs")).toEqual(
			[],
		);
	});
});

describe("buildFilesOutput", () => {
	it("emits one row per file: the ref-id suffix plus the absolute path", () => {
		expect(
			buildFilesOutput([
				{
					refId: "global:alpha/references/a.md",
					path: "/s/alpha/references/a.md",
					bytes: 84,
				},
				{
					refId: "global:alpha/scripts/run.sh",
					path: "/s/alpha/scripts/run.sh",
					bytes: 21,
				},
			]),
		).toBe(
			[
				"- references/a.md /s/alpha/references/a.md",
				"- scripts/run.sh /s/alpha/scripts/run.sh",
			].join("\n"),
		);
	});

	it("names an empty listing explicitly", () => {
		expect(buildFilesOutput([])).toBe("no files");
	});
});

describe("wrapSkillBlock", () => {
	it("wraps the text in an attributed open/close pair with name and location", () => {
		expect(
			wrapSkillBlock("alpha", "/s/alpha/SKILL.md", "---\nname: alpha\n---"),
		).toBe(
			'<SKILL name="alpha" location="/s/alpha/SKILL.md">\n---\nname: alpha\n---\n</SKILL>',
		);
	});
});
