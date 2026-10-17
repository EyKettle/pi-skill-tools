/**
 * The index: the built-in discovery paths, configured extra paths, the skills
 * Pi discovered for the inherited locations, and the frontmatter attached to
 * each entry.
 */
import { afterAll, describe, expect, it } from "vitest";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildIndex,
	collectTags,
	resolveLocations,
} from "../../src/discovery/registry";
import type { IndexInput } from "../../src/discovery/types";

const tmpDirs: string[] = [];

function tempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tmpDirs.push(dir);
	return dir;
}

afterAll(() => {
	for (const dir of tmpDirs) {
		rmSync(dir, { recursive: true, force: true });
	}
});

/** Write `<root>/<name>/SKILL.md`; the block defaults to a minimal one. */
function writeSkill(
	root: string,
	name: string,
	block = `---\nname: ${name}\n---\n`,
): void {
	mkdirSync(join(root, name), { recursive: true });
	writeFileSync(join(root, name, "SKILL.md"), block);
}

function input(overrides: Partial<IndexInput> & { agentDir: string; cwd: string }) {
	return overrides;
}

describe("buildIndex", () => {
	it("indexes the two scanned built-in locations", () => {
		const root = tempDir("discovery-builtins-");
		const agentDir = join(root, "agent");
		const cwd = join(root, "project");
		writeSkill(join(agentDir, "skills"), "alpha");
		writeSkill(join(cwd, ".pi", "skills"), "beta");

		const index = buildIndex(input({ agentDir, cwd }));

		expect(index.entries.map((entry) => entry.id)).toEqual([
			"global:alpha",
			"project:beta",
		]);
		expect(index.locations.map((location) => location.id)).toEqual([
			"global",
			"project",
			"package",
			"temp",
		]);
		expect(index.locations[0]).toEqual({
			id: "global",
			path: join(agentDir, "skills"),
			writable: true,
		});
		expect(index.locations[1]).toEqual({
			id: "project",
			path: join(cwd, ".pi", "skills"),
			writable: true,
		});
		expect(index.locations[2].writable).toBe(false);
		expect(index.locations[3].writable).toBe(false);
	});

	it("registers a configured extra path after the built-ins", () => {
		const root = tempDir("discovery-extra-");
		const extra = join(root, "extra");
		writeSkill(extra, "gamma");

		const index = buildIndex(
			input({
				agentDir: join(root, "agent"),
				cwd: join(root, "project"),
				registry: { paths: { extra: { writable: true, path: extra } } },
			}),
		);

		expect(index.entries.map((entry) => entry.id)).toEqual(["extra:gamma"]);
		expect(index.locations.at(-1)).toEqual({
			id: "extra",
			path: extra,
			writable: true,
		});
	});

	it("orders configured paths by id after the built-ins", () => {
		const root = tempDir("discovery-extra-order-");
		const index = buildIndex(
			input({
				agentDir: join(root, "agent"),
				cwd: join(root, "project"),
				registry: {
					paths: {
						zeta: { writable: false, path: join(root, "z") },
						alpha: { writable: false, path: join(root, "a") },
					},
				},
			}),
		);
		expect(index.locations.map((location) => location.id)).toEqual([
			"global",
			"project",
			"package",
			"temp",
			"alpha",
			"zeta",
		]);
	});

	it("inherits the package and temp skills Pi discovered", () => {
		const root = tempDir("discovery-inherited-");
		const pkg = join(root, "pkg", "pkg-skill");
		const temp = join(root, "temp", "temp-skill");
		mkdirSync(pkg, { recursive: true });
		mkdirSync(temp, { recursive: true });
		writeFileSync(
			join(pkg, "SKILL.md"),
			"---\nname: pkg-skill\ndescription: from a package\n---\n",
		);
		writeFileSync(join(temp, "SKILL.md"), "---\nname: temp-skill\n---\n");

		const index = buildIndex({
			agentDir: join(root, "agent"),
			cwd: join(root, "project"),
			inherited: {
				package: [
					{
						name: "pkg-skill",
						filePath: join(pkg, "SKILL.md"),
						baseDir: pkg,
					},
				],
				temp: [
					{
						name: "temp-skill",
						filePath: join(temp, "SKILL.md"),
						baseDir: temp,
					},
				],
			},
		});

		expect(index.entries.map((entry) => entry.id)).toEqual([
			"package:pkg-skill",
			"temp:temp-skill",
		]);
		expect(index.entries[0].frontmatter).toEqual({
			name: "pkg-skill",
			description: "from a package",
		});
	});

	it("drops a disabled location together with the skills on disk", () => {
		const root = tempDir("discovery-disabled-");
		const agentDir = join(root, "agent");
		writeSkill(join(agentDir, "skills"), "alpha");
		writeSkill(join(root, "project", ".pi", "skills"), "beta");

		const index = buildIndex(
			input({ agentDir, cwd: join(root, "project") }),
		);
		const disabled = buildIndex(
			input({
				agentDir,
				cwd: join(root, "project"),
				registry: { disable: ["global", "package", "temp"] },
			}),
		);

		expect(index.entries).toHaveLength(2);
		expect(disabled.locations.map((location) => location.id)).toEqual([
			"project",
		]);
		expect(disabled.entries.map((entry) => entry.id)).toEqual(["project:beta"]);
	});

	it("does not let a configured path take over a built-in id", () => {
		const root = tempDir("discovery-collision-");
		const impostor = join(root, "impostor");
		writeSkill(impostor, "fake");

		const index = buildIndex(
			input({
				agentDir: join(root, "agent"),
				cwd: join(root, "project"),
				registry: { paths: { global: { writable: true, path: impostor } } },
			}),
		);

		expect(
			index.locations.filter((location) => location.id === "global"),
		).toHaveLength(1);
		expect(index.locations[0].path).toBe(join(root, "agent", "skills"));
		expect(index.entries).toEqual([]);
	});

	it("skips a directory without SKILL.md and a SKILL.md that is a directory", () => {
		const root = tempDir("discovery-shape-");
		const skills = join(root, "agent", "skills");
		mkdirSync(join(skills, "empty"), { recursive: true });
		writeSkill(skills, "real");
		mkdirSync(join(skills, "odd", "SKILL.md"), { recursive: true });

		const index = buildIndex(
			input({ agentDir: join(root, "agent"), cwd: join(root, "project") }),
		);

		expect(index.entries.map((entry) => entry.id)).toEqual(["global:real"]);
	});

	it("skips a directory whose name is not a legal skill name", () => {
		const root = tempDir("discovery-name-");
		const skills = join(root, "agent", "skills");
		writeSkill(skills, "good-name");
		writeSkill(skills, "Bad_Name");

		const index = buildIndex(
			input({ agentDir: join(root, "agent"), cwd: join(root, "project") }),
		);

		expect(index.entries.map((entry) => entry.id)).toEqual([
			"global:good-name",
		]);
	});

	it("skips a missing location directory", () => {
		const root = tempDir("discovery-missing-");
		const index = buildIndex(
			input({ agentDir: join(root, "agent"), cwd: join(root, "project") }),
		);
		expect(index.entries).toEqual([]);
		expect(index.locations).toHaveLength(4);
	});

	it("attaches frontmatter and fails closed to {} on a malformed block", () => {
		const root = tempDir("discovery-frontmatter-");
		const skills = join(root, "agent", "skills");
		writeSkill(
			skills,
			"good",
			"---\nname: good\ndescription: keeps metadata\n---\n# Body\n",
		);
		writeSkill(skills, "broken", "---\nname: [unclosed\n---\n");

		const index = buildIndex(
			input({ agentDir: join(root, "agent"), cwd: join(root, "project") }),
		);

		const byName = new Map(
			index.entries.map((entry) => [entry.name, entry.frontmatter]),
		);
		expect(byName.get("good")).toEqual({
			name: "good",
			description: "keeps metadata",
		});
		expect(byName.get("broken")).toEqual({});
	});

	it("sorts entries by location order, then name", () => {
		const root = tempDir("discovery-sort-");
		const skills = join(root, "agent", "skills");
		writeSkill(skills, "beta");
		writeSkill(skills, "alpha");
		writeSkill(join(root, "project", ".pi", "skills"), "alpha");

		const index = buildIndex(
			input({ agentDir: join(root, "agent"), cwd: join(root, "project") }),
		);

		expect(index.entries.map((entry) => entry.id)).toEqual([
			"global:alpha",
			"global:beta",
			"project:alpha",
		]);
	});

	it("follows a symlinked skill directory", () => {
		const root = tempDir("discovery-symlink-");
		const skills = join(root, "agent", "skills");
		const real = join(root, "elsewhere", "linked");
		writeSkill(join(root, "elsewhere"), "linked");
		mkdirSync(skills, { recursive: true });
		symlinkSync(real, join(skills, "linked"), "dir");

		const index = buildIndex(
			input({ agentDir: join(root, "agent"), cwd: join(root, "project") }),
		);

		expect(index.entries.map((entry) => entry.id)).toEqual(["global:linked"]);
		expect(index.entries[0].filePath).toBe(join(skills, "linked", "SKILL.md"));
	});

	it("keeps both skills when a name appears in two locations", () => {
		const root = tempDir("discovery-duplicate-");
		writeSkill(join(root, "agent", "skills"), "coding");
		writeSkill(join(root, "project", ".pi", "skills"), "coding");

		const index = buildIndex(
			input({ agentDir: join(root, "agent"), cwd: join(root, "project") }),
		);

		expect(index.entries.map((entry) => entry.id)).toEqual([
			"global:coding",
			"project:coding",
		]);
	});
});

describe("resolveLocations", () => {
	it("reports a configured id that collides with a built-in", () => {
		const root = tempDir("discovery-issue-reserved-");
		const resolved = resolveLocations({
			agentDir: join(root, "agent"),
			cwd: join(root, "project"),
			registry: { paths: { global: { writable: true, path: join(root, "x") } } },
		});

		expect(resolved.issues).toEqual([{ id: "global", reason: "reserved" }]);
		expect(resolved.locations.map((location) => location.id)).toEqual([
			"global",
			"project",
			"package",
			"temp",
		]);
		expect(resolved.locations[0].path).toBe(join(root, "agent", "skills"));
	});

	it("reports a configured id that cannot be spelled in an ID", () => {
		const root = tempDir("discovery-issue-invalid-");
		const resolved = resolveLocations({
			agentDir: join(root, "agent"),
			cwd: join(root, "project"),
			registry: {
				paths: { "Bad_Id": { writable: true, path: join(root, "bad") } },
			},
		});

		expect(resolved.issues).toEqual([{ id: "Bad_Id", reason: "invalid" }]);
		expect(resolved.locations.map((location) => location.id)).toEqual([
			"global",
			"project",
			"package",
			"temp",
		]);
	});

	it("reports every dropped path while keeping the valid ones", () => {
		const root = tempDir("discovery-issue-mixed-");
		const resolved = resolveLocations({
			agentDir: join(root, "agent"),
			cwd: join(root, "project"),
			registry: {
				paths: {
					zeta: { writable: false, path: join(root, "z") },
					temp: { writable: false, path: join(root, "t") },
					"No_Good": { writable: false, path: join(root, "n") },
				},
			},
		});

		expect(resolved.issues).toEqual([
			{ id: "No_Good", reason: "invalid" },
			{ id: "temp", reason: "reserved" },
		]);
		expect(resolved.locations.map((location) => location.id)).toEqual([
			"global",
			"project",
			"package",
			"temp",
			"zeta",
		]);
	});

	it("keeps the index unchanged by the issues", () => {
		const root = tempDir("discovery-issue-index-");
		const extra = join(root, "extra");
		writeSkill(extra, "gamma");
		const index = buildIndex({
			agentDir: join(root, "agent"),
			cwd: join(root, "project"),
			registry: {
				paths: {
					extra: { writable: true, path: extra },
					global: { writable: true, path: join(root, "impostor") },
				},
			},
		});

		expect(index.entries.map((entry) => entry.id)).toEqual(["extra:gamma"]);
		expect(index.locations.at(-1)?.id).toBe("extra");
	});
});

describe("collectTags", () => {
	it("aggregates ids by metadata.tags, sorted and deduplicated", () => {
		const root = tempDir("discovery-tags-");
		const skills = join(root, "agent", "skills");
		writeSkill(
			skills,
			"alpha",
			"---\nname: alpha\nmetadata:\n  tags: [networking, pi, networking]\n---\n",
		);
		writeSkill(
			skills,
			"beta",
			"---\nname: beta\nmetadata:\n  tags: [networking]\n---\n",
		);
		writeSkill(skills, "gamma", "---\nname: gamma\n---\n");

		const index = buildIndex(
			input({ agentDir: join(root, "agent"), cwd: join(root, "project") }),
		);
		const tags = collectTags(index.entries);

		expect(Array.from(tags.keys())).toEqual(["networking", "pi"]);
		expect(tags.get("networking")).toEqual(["global:alpha", "global:beta"]);
		expect(tags.get("pi")).toEqual(["global:alpha"]);
	});
});
