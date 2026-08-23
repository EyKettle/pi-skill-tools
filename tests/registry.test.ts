import { afterAll, describe, expect, it } from "vitest";
import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRegistry, collectTags } from "../registry";
import type { PiSkill, RegistryDeps, RegistryEntry } from "../registry";

/**
 * Task 7 test suite (plan Task 7 Step 1, design.md §3). `RegistryDeps` is
 * fully injectable, so no pi runtime is needed: fake `activeSkills`,
 * `scanDir`, and `readFrontmatter` plus real temp directories where realpath
 * behaviour matters.
 */

function makeSkill(overrides: Partial<PiSkill> = {}): PiSkill {
	return {
		name: "alpha",
		description: "alpha description",
		filePath: "/skills/alpha/SKILL.md",
		baseDir: "/skills/alpha",
		sourceInfo: { scope: "user", origin: "top-level" },
		...overrides,
	};
}

function makeDeps(overrides: Partial<RegistryDeps> = {}): RegistryDeps {
	return {
		activeSkills: [makeSkill()],
		scanDir: () => [],
		readFrontmatter: () => ({}),
		agentDir: "/tmp/agent",
		configDirName: ".pi",
		cwd: "/tmp/proj",
		homeDir: "/tmp/home",
		isProjectTrusted: () => true,
		...overrides,
	};
}

const tmpDirs: string[] = [];

function makeTempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tmpDirs.push(dir);
	return dir;
}

afterAll(() => {
	for (const dir of tmpDirs) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("buildRegistry", () => {
	it("classifies a user top-level skill as global", () => {
		const registry = buildRegistry(
			makeDeps({
				activeSkills: [
					makeSkill({
						name: "g-skill",
						sourceInfo: { scope: "user", origin: "top-level" },
					}),
				],
			}),
		);
		expect(registry.entries).toHaveLength(1);
		expect(registry.entries[0].storage).toBe("global");
		expect(registry.entries[0].id).toBe("global:g-skill");
		expect(registry.entries[0].state).toBe("active");
	});

	it("classifies a project top-level skill as project", () => {
		const registry = buildRegistry(
			makeDeps({
				activeSkills: [
					makeSkill({
						name: "proj-skill",
						sourceInfo: { scope: "project", origin: "top-level" },
					}),
				],
			}),
		);
		expect(registry.entries[0].storage).toBe("project");
		expect(registry.entries[0].id).toBe("project:proj-skill");
	});

	it("classifies a package-origin skill as package regardless of scope", () => {
		for (const scope of ["user", "project"] as const) {
			const registry = buildRegistry(
				makeDeps({
					activeSkills: [
						makeSkill({
							name: "pkg-skill",
							sourceInfo: { scope, origin: "package" },
						}),
					],
				}),
			);
			expect(registry.entries[0].storage).toBe("package");
			expect(registry.entries[0].id).toBe("package:pkg-skill");
		}
	});

	it("excludes a temporary-scope skill from the index", () => {
		const registry = buildRegistry(
			makeDeps({
				activeSkills: [
					makeSkill({
						sourceInfo: { scope: "temporary", origin: "top-level" },
					}),
				],
			}),
		);
		expect(registry.entries).toHaveLength(0);
		expect(registry.indexEmpty).toBe(true);
	});

	it("keeps disableModelInvocation skills and flags them hidden", () => {
		const registry = buildRegistry(
			makeDeps({
				activeSkills: [
					makeSkill({ name: "manual", disableModelInvocation: true }),
				],
			}),
		);
		expect(registry.entries).toHaveLength(1);
		expect(registry.entries[0].id).toBe("global:manual");
		expect(registry.entries[0].state).toBe("hidden");
	});

	it("marks a scanned same-name skill as shadowed with the winner's prefixed id and reports the conflict", () => {
		const projectRoot = join("/tmp/proj", ".pi", "skills");
		const registry = buildRegistry(
			makeDeps({
				activeSkills: [
					makeSkill({
						name: "coding",
						filePath: "/tmp/agent/skills/coding/SKILL.md",
						baseDir: "/tmp/agent/skills/coding",
					}),
				],
				scanDir: (dir) =>
					dir === projectRoot
						? [
								makeSkill({
									name: "coding",
									filePath: join(projectRoot, "coding", "SKILL.md"),
									baseDir: join(projectRoot, "coding"),
								}),
							]
						: [],
				readFrontmatter: (filePath) => ({ file: filePath }),
			}),
		);

		const shadow = registry.entries.find(
			(e) => e.name === "coding" && e.state === "shadowed",
		);
		expect(shadow).toBeDefined();
		expect(shadow?.id).toBe("project:coding");
		expect(shadow?.state).toBe("shadowed");
		expect(shadow?.shadowedBy).toBe("global:coding");
		expect(shadow?.filePath).toBe(join(projectRoot, "coding", "SKILL.md"));
		// design §3.4: the scanned entry carries its own attached frontmatter
		expect(shadow?.frontmatter).toEqual({
			file: join(projectRoot, "coding", "SKILL.md"),
		});
		expect(registry.conflicts).toEqual([
			{ name: "coding", participants: ["global:coding", "project:coding"] },
		]);
	});

	it("drops a scanned skill whose name is in no active entry", () => {
		const registry = buildRegistry(
			makeDeps({
				activeSkills: [makeSkill()],
				scanDir: () => [makeSkill({ name: "orphan" })],
			}),
		);
		expect(registry.entries.map((e) => e.name)).toEqual(["alpha"]);
		expect(registry.conflicts).toEqual([]);
	});

	it("does not shadow an active skill whose realpath collides via a symlink (real temp dirs)", () => {
		const tmp = makeTempDir("registry-realpath-");
		const real = join(tmp, "real");
		const link = join(tmp, "link");
		mkdirSync(join(real, "dup"), { recursive: true });
		writeFileSync(join(real, "dup", "SKILL.md"), "---\nname: dup\n---\n");
		symlinkSync(real, link, "dir");
		expect(realpathSync(join(link, "dup", "SKILL.md"))).toBe(
			realpathSync(join(real, "dup", "SKILL.md")),
		);
		const registry = buildRegistry(
			makeDeps({
				activeSkills: [
					makeSkill({
						name: "dup",
						filePath: join(real, "dup", "SKILL.md"),
						baseDir: join(real, "dup"),
					}),
				],
				scanDir: () => [
					makeSkill({
						name: "dup",
						filePath: join(link, "dup", "SKILL.md"),
						baseDir: join(link, "dup"),
					}),
				],
			}),
		);
		expect(registry.entries.filter((e) => e.name === "dup")).toHaveLength(1);
		expect(registry.entries[0].id).toBe("global:dup");
		expect(registry.conflicts).toHaveLength(0);
	});

	it("skips project roots entirely when the project is untrusted (real temp dirs)", () => {
		const tmp = makeTempDir("registry-untrusted-");
		const cwd = join(tmp, "work");
		mkdirSync(join(cwd, ".pi", "skills"), { recursive: true });
		// An existing ancestor `.agents/skills` one level up must also stay
		// unscanned: un/trusted-ness gates the whole project walk, not just
		// the `cwd/.pi/skills` root (design.md §3.3).
		mkdirSync(join(tmp, ".agents", "skills"), { recursive: true });
		const calls: string[] = [];
		buildRegistry(
			makeDeps({
				cwd,
				isProjectTrusted: () => false,
				scanDir: (dir) => {
					calls.push(dir);
					return [];
				},
			}),
		);
		expect(calls).toContain(join("/tmp/agent", "skills"));
		expect(calls.some((dir) => dir.startsWith(cwd))).toBe(false);
		expect(calls).not.toContain(join(tmp, ".agents", "skills"));
	});

	it("derives a package scan root from an active package skill inside skills/", () => {
		const calls: string[] = [];
		const packageSkill = makeSkill({
			name: "pkg-skill",
			filePath: join("/pkg", "skills", "pkg-skill", "SKILL.md"),
			baseDir: join("/pkg", "skills", "pkg-skill"),
			sourceInfo: { scope: "user", origin: "package" },
		});
		buildRegistry(
			makeDeps({
				activeSkills: [packageSkill],
				scanDir: (dir) => {
					calls.push(dir);
					return [];
				},
			}),
		);
		expect(calls).toContain(join("/pkg", "skills"));
	});

	it("yields no package root when the package skill's grandparent is not named skills", () => {
		const trustedCalls: string[] = [];
		const packageSkill = makeSkill({
			filePath: join("/pkg", "vendor", "pkg-skill", "SKILL.md"),
			baseDir: join("/pkg", "vendor", "pkg-skill"),
			sourceInfo: { scope: "user", origin: "package" },
		});
		buildRegistry(
			makeDeps({
				activeSkills: [packageSkill],
				scanDir: (dir) => {
					trustedCalls.push(dir);
					return [];
				},
			}),
		);
		expect(trustedCalls).not.toContain(join("/pkg", "vendor"));

		// even a `skills`-shaped parent must be ignored when the origin is not
		// package: roots follow pi's locations, not a path shape
		const nonPackageCalls: string[] = [];
		buildRegistry(
			makeDeps({
				activeSkills: [
					makeSkill({
						name: "not-pkg",
						filePath: join("/pkg", "skills", "not-pkg", "SKILL.md"),
						baseDir: join("/pkg", "skills", "not-pkg"),
						sourceInfo: { scope: "project", origin: "top-level" },
					}),
				],
				scanDir: (dir) => {
					nonPackageCalls.push(dir);
					return [];
				},
			}),
		);
		expect(nonPackageCalls).not.toContain(join("/pkg", "skills"));
	});

	it("walks ancestors for .agents/skills but stops at the git root", () => {
		const tmp = makeTempDir("registry-walk-");
		const repoRoot = join(tmp, "repo");
		const cwd = join(repoRoot, "nested");
		mkdirSync(join(repoRoot, ".git"), { recursive: true });
		mkdirSync(join(repoRoot, ".agents", "skills"), { recursive: true });
		mkdirSync(join(cwd, ".agents", "skills"), { recursive: true });
		mkdirSync(join(tmp, ".agents", "skills"), { recursive: true });
		const calls: string[] = [];
		buildRegistry(
			makeDeps({
				cwd,
				scanDir: (dir) => {
					calls.push(dir);
					return [];
				},
			}),
		);
		expect(calls).toContain(join(cwd, ".pi", "skills"));
		expect(calls).toContain(join(cwd, ".agents", "skills"));
		expect(calls).toContain(join(repoRoot, ".agents", "skills"));
		// above the git root the walk stops
		expect(calls).not.toContain(join(tmp, ".agents", "skills"));
	});

	it("filters the index to a single location", () => {
		const registry = buildRegistry(
			makeDeps({
				activeSkills: [
					makeSkill({
						name: "a",
						filePath: "/g/a/SKILL.md",
						baseDir: "/g/a",
					}),
					makeSkill({
						name: "b",
						filePath: "/p/b/SKILL.md",
						baseDir: "/p/b",
						sourceInfo: { scope: "project", origin: "top-level" },
					}),
					makeSkill({
						name: "c",
						filePath: "/k/skills/c/SKILL.md",
						baseDir: "/k/skills/c",
						sourceInfo: { scope: "project", origin: "package" },
					}),
				],
			}),
		);
		expect(registry.filter("package").map((e) => e.id)).toEqual(["package:c"]);
		expect(registry.filter(undefined)).toHaveLength(3);
	});

	it("reports indexEmpty only for a truly empty index", () => {
		const empty = buildRegistry(makeDeps({ activeSkills: [] }));
		expect(empty.entries).toHaveLength(0);
		expect(empty.indexEmpty).toBe(true);

		const full = buildRegistry(
			makeDeps({ activeSkills: [makeSkill({ name: "keep" })] }),
		);
		expect(full.entries).toHaveLength(1);
		expect(full.indexEmpty).toBe(false);
	});

	it("attaches the readFrontmatter result as each entry's frontmatter", () => {
		const frontmatter = { license: "MIT", metadata: { tags: ["networking"] } };
		const registry = buildRegistry(
			makeDeps({
				readFrontmatter: () => frontmatter,
			}),
		);
		expect(registry.entries[0].frontmatter).toEqual(frontmatter);
	});

	it("keeps an entry with {} when readFrontmatter throws", () => {
		const registry = buildRegistry(
			makeDeps({
				readFrontmatter: () => {
					throw new Error("boom");
				},
			}),
		);
		expect(registry.entries).toHaveLength(1);
		expect(registry.entries[0].frontmatter).toEqual({});
	});

	it("yields {} when readFrontmatter returns a non-record", () => {
		const registry = buildRegistry(
			makeDeps({
				readFrontmatter: () => [] as unknown as Record<string, unknown>,
			}),
		);
		expect(registry.entries[0].frontmatter).toEqual({});
	});
});

describe("collectTags", () => {
	it("aggregates prefixed ids by frontmatter.metadata.tags; tag-less skills never appear", () => {
		const frontmatterByPath: Record<string, Record<string, unknown>> = {
			"/g/alpha/SKILL.md": { metadata: { tags: ["networking", "pi"] } },
			"/p/beta/SKILL.md": { metadata: { tags: ["networking"] } },
			"/g/gamma/SKILL.md": { description: "no tags here" },
		};
		const registry = buildRegistry(
			makeDeps({
				activeSkills: [
					makeSkill({
						name: "alpha",
						filePath: "/g/alpha/SKILL.md",
						baseDir: "/g/alpha",
					}),
					makeSkill({
						name: "beta",
						filePath: "/p/beta/SKILL.md",
						baseDir: "/p/beta",
						sourceInfo: { scope: "project", origin: "top-level" },
					}),
					makeSkill({
						name: "gamma",
						filePath: "/g/gamma/SKILL.md",
						baseDir: "/g/gamma",
					}),
				],
				readFrontmatter: (filePath) => frontmatterByPath[filePath] ?? {},
			}),
		);
		const tags = collectTags(registry.entries);
		expect(tags.get("networking")).toEqual(["global:alpha", "project:beta"]);
		expect(tags.get("pi")).toEqual(["global:alpha"]);
		const all = Array.from(tags.keys());
		expect(all).not.toContain("gamma");
		expect(Array.from(tags.values()).flat()).not.toContain("global:gamma");
	});
});
