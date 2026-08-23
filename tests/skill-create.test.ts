import { afterAll, describe, expect, it, vi } from "vitest";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { createSkill } from "../skill-create";
import type { CreateSkillDeps } from "../skill-create";
import type { Registry, RegistryEntry } from "../registry";
import type { SkillStorage } from "../skill-id";

// Wrap node:fs's readFileSync in a controllable mock that delegates to the
// real implementation by default, so the post-write verification branch of
// writeSkillFileAtomic can be forced (it is unreachable with a real fs).
vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});
/**
 * Task 8 test suite (plan Task 8 Step 1, design.md §5.6). `Registry` and
 * `CreateSkillDeps` are fully injectable, so no pi runtime is needed; skills
 * are written into real temp directories so the on-disk contract (absolute
 * path, file exists, byte-verbatim content) is asserted for real.
 */

const tmpDirs: string[] = [];

function makeTempDir(prefix = "skill-create-test-"): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tmpDirs.push(dir);
	return dir;
}

afterAll(() => {
	for (const dir of tmpDirs) {
		rmSync(dir, { recursive: true, force: true });
	}
});

/** Content for tests that reject before any write; never read back. */
const SAMPLE_CONTENT = [
	"---",
	"name: sample",
	"description: sample content",
	"---",
	"# Sample",
	"",
	"Written verbatim.",
	"",
].join("\n");

function makeEntry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
	return {
		storage: "global",
		name: "dup",
		id: "global:dup",
		state: "active",
		frontmatter: {},
		filePath: join(tmpdir(), "skill-tools-registry", "global", "dup", "SKILL.md"),
		baseDir: join(tmpdir(), "skill-tools-registry", "global", "dup"),
		description: "duplicate skill",
		...overrides,
	};
}

function makeRegistry(overrides: Partial<Registry> = {}): Registry {
	const entries = overrides.entries ?? [];
	return {
		entries,
		conflicts: overrides.conflicts ?? [],
		indexEmpty: overrides.indexEmpty ?? false,
		filter(location?: SkillStorage) {
			return location === undefined
				? entries
				: entries.filter((e) => e.storage === location);
		},
	};
}

function makeDeps(overrides: Partial<CreateSkillDeps> = {}): CreateSkillDeps {
	return {
		registry: makeRegistry(),
		agentDir: join(tmpdir(), "skill-tools-create", "agent"),
		configDirName: ".pi",
		cwd: join(tmpdir(), "skill-tools-create", "cwd"),
		...overrides,
	};
}

describe("createSkill", () => {
	it("writes the supplied content verbatim — literal frontmatter included", async () => {
		const agentDir = makeTempDir();
		const content = [
			"---",
			"name: alpha",
			"description: alpha things",
			"license: MIT",
			"---",
			"# Alpha",
			"",
			"## Overview",
			"",
			"Hand-written body; nothing generated.",
			"",
		].join("\n");
		const result = await createSkill(
			{ name: "alpha", content },
			makeDeps({ agentDir }),
		);
		expect(result.error).toBeUndefined();
		if (result.error !== undefined) return;

		expect(isAbsolute(result.path)).toBe(true);
		expect(readFileSync(result.path, "utf8")).toBe(content);
		expect(result.content).toBe(content);
	});

	it("does not inject a default license — content without one is written unchanged", async () => {
		const agentDir = makeTempDir();
		const content = [
			"---",
			"name: mit-default",
			"description: no license given",
			"---",
			"# MIT Default",
			"",
		].join("\n");
		const result = await createSkill(
			{ name: "mit-default", content },
			makeDeps({ agentDir }),
		);
		expect(result.error).toBeUndefined();
		if (result.error !== undefined) return;

		const written = readFileSync(result.path, "utf8");
		expect(written).toBe(content);
		expect(written).not.toContain("license:");
		expect(result.content).toBe(content);
	});

	it("writes version and metadata verbatim as supplied — no reordering or rewriting", async () => {
		const agentDir = makeTempDir();
		const content = [
			"---",
			"name: a-full",
			"description: d",
			"version: 2.0.0",
			"metadata:",
			"  tags:",
			"    - networking",
			"---",
			"# A Full",
			"",
		].join("\n");
		const result = await createSkill(
			{ name: "a-full", content },
			makeDeps({ agentDir }),
		);
		expect(result.error).toBeUndefined();
		if (result.error !== undefined) return;

		expect(readFileSync(result.path, "utf8")).toBe(content);
		expect(result.content).toBe(content);
	});

	it("does not scaffold a skeleton — a non-skeleton body is written unchanged", async () => {
		const agentDir = makeTempDir();
		const content = [
			"# My Awesome Skill",
			"",
			"A single paragraph; deliberately no Overview/When to Use/Pitfalls/Checklist.",
			"",
		].join("\n");
		const result = await createSkill(
			{ name: "my-awesome-skill", content },
			makeDeps({ agentDir }),
		);
		expect(result.error).toBeUndefined();
		if (result.error !== undefined) return;

		const written = readFileSync(result.path, "utf8");
		expect(written).toBe(content);
		expect(written).not.toContain("## Overview");
		expect(written).not.toContain("## When to Use");
		expect(written).not.toContain("## Common Pitfalls");
		expect(written).not.toContain("## Verification Checklist");
	});

	it("rejects package storage with an npm management error", async () => {
		const agentDir = makeTempDir();
		const result = await createSkill(
			{ storage: "package", name: "nope", content: SAMPLE_CONTENT },
			makeDeps({ agentDir }),
		);
		expect(result.path).toBeUndefined();
		if (result.path !== undefined) return;
		expect(result.error).toContain("npm-managed");
		expect(existsSync(join(agentDir, "skills", "nope"))).toBe(false);
	});

	it("rejects a name already present in the registry, listing every occurrence's prefixed id and absolute path", async () => {
		const registry = makeRegistry({
			entries: [
				makeEntry({
					storage: "global",
					id: "global:dup",
					filePath: "/abs/global/dup/SKILL.md",
					baseDir: "/abs/global/dup",
				}),
				makeEntry({
					storage: "project",
					id: "project:dup",
					state: "shadowed",
					shadowedBy: "global:dup",
					filePath: "/abs/project/dup/SKILL.md",
					baseDir: "/abs/project/dup",
				}),
			],
		});
		const agentDir = makeTempDir();
		const result = await createSkill(
			{ name: "dup", content: SAMPLE_CONTENT },
			makeDeps({ registry, agentDir }),
		);
		expect(result.path).toBeUndefined();
		if (result.path !== undefined) return;

		expect(result.error).toContain("global:dup");
		expect(result.error).toContain("/abs/global/dup/SKILL.md");
		expect(result.error).toContain("project:dup");
		expect(result.error).toContain("/abs/project/dup/SKILL.md");
		expect(existsSync(join(agentDir, "skills", "dup"))).toBe(false);
	});

	it("rejects a name carried only by a shadowed entry", async () => {
		const registry = makeRegistry({
			entries: [
				makeEntry({
					name: "shadow",
					storage: "project",
					id: "project:shadow",
					state: "shadowed",
					shadowedBy: "global:shadow",
					filePath: "/abs/project/shadow/SKILL.md",
					baseDir: "/abs/project/shadow",
				}),
			],
		});
		const agentDir = makeTempDir();
		const result = await createSkill(
			{ name: "shadow", content: SAMPLE_CONTENT },
			makeDeps({ registry, agentDir }),
		);
		expect(result.path).toBeUndefined();
		if (result.path !== undefined) return;
		expect(result.error).toContain("project:shadow");
		expect(result.error).toContain("/abs/project/shadow/SKILL.md");
	});

	it("rejects an existing target directory even when the registry has no entry for the name", async () => {
		const agentDir = makeTempDir();
		mkdirSync(join(agentDir, "skills", "occupied"), { recursive: true });
		const result = await createSkill(
			{ name: "occupied", content: SAMPLE_CONTENT },
			makeDeps({ agentDir }),
		);
		expect(result.path).toBeUndefined();
		if (result.path !== undefined) return;
		expect(result.error).toContain("occupied");
		expect(result.error).toContain(join(agentDir, "skills", "occupied"));
		expect(existsSync(join(agentDir, "skills", "occupied", "SKILL.md"))).toBe(
			false,
		);
	});

	it("defaults to the global storage when the id carries no prefix", async () => {
		const agentDir = makeTempDir();
		const result = await createSkill(
			{ name: "bare", content: SAMPLE_CONTENT },
			makeDeps({ agentDir }),
		);
		expect(result.error).toBeUndefined();
		if (result.error !== undefined) return;
		expect(result.path).toBe(join(agentDir, "skills", "bare", "SKILL.md"));
		expect(existsSync(result.path)).toBe(true);
	});

	it("writes project storage under <cwd>/<configDirName>/skills", async () => {
		const cwdDir = makeTempDir();
		const result = await createSkill(
			{ storage: "project", name: "local-sk", content: SAMPLE_CONTENT },
			makeDeps({ cwd: cwdDir, configDirName: ".pi" }),
		);
		expect(result.error).toBeUndefined();
		if (result.error !== undefined) return;
		expect(result.path).toBe(
			join(cwdDir, ".pi", "skills", "local-sk", "SKILL.md"),
		);
		expect(existsSync(result.path)).toBe(true);
	});

	it("returns the absolute written path and leaves the file on disk on success", async () => {
		const agentDir = makeTempDir();
		const content = [
			"---",
			"name: disk-check",
			"description: d",
			"license: MIT",
			"---",
			"# Disk Check",
			"",
		].join("\n");
		const result = await createSkill(
			{ storage: "global", name: "disk-check", content },
			makeDeps({ agentDir }),
		);
		expect(result.error).toBeUndefined();
		if (result.error !== undefined) return;

		expect(isAbsolute(result.path)).toBe(true);
		expect(result.path).toBe(join(agentDir, "skills", "disk-check", "SKILL.md"));
		expect(existsSync(result.path)).toBe(true);
		expect(readFileSync(result.path, "utf8")).toBe(content);
		expect(result.content).toBe(content);
	});

	it("rejects a call against an empty index with the explicit empty-index error", async () => {
		const agentDir = makeTempDir();
		const result = await createSkill(
			{ name: "no-index-yet", content: SAMPLE_CONTENT },
			makeDeps({ registry: makeRegistry({ indexEmpty: true }), agentDir }),
		);
		expect(result.path).toBeUndefined();
		if (result.path !== undefined) return;
		expect(result.error).toContain("skill index is not yet populated");
		expect(existsSync(join(agentDir, "skills", "no-index-yet"))).toBe(false);
	});

	it("runs the write inside runExclusive when one is supplied", async () => {
		const agentDir = makeTempDir();
		let wrapped = 0;
		const runExclusive = async <T>(fn: () => Promise<T>): Promise<T> => {
			wrapped += 1;
			return fn();
		};
		const result = await createSkill(
			{ name: "queued", content: SAMPLE_CONTENT },
			makeDeps({ agentDir, runExclusive }),
		);
		expect(result.error).toBeUndefined();
		if (result.error !== undefined) return;
		expect(wrapped).toBe(1);
		expect(existsSync(result.path)).toBe(true);
	});

	it("fails closed on a name that would escape the skills root", async () => {
		const agentDir = makeTempDir();
		const result = await createSkill(
			{ name: "../uppercase", content: SAMPLE_CONTENT },
			makeDeps({ agentDir }),
		);
		expect(result.path).toBeUndefined();
		if (result.path !== undefined) return;
		expect(result.error).toContain("invalid");
		expect(existsSync(join(agentDir, "skills"))).toBe(false);
	});
});

describe("failure vocabulary integration", () => {
	it("classifies package storage as CREATE_PACKAGE_REJECTED", async () => {
		const result = await createSkill(
			{ storage: "package", name: "nope", content: SAMPLE_CONTENT },
			makeDeps({}),
		);
		expect(result.error).toBeDefined();
		if (result.error === undefined) return;
		expect(result.code).toBe("CREATE_PACKAGE_REJECTED");
		expect(result.evidence).toEqual({ kind: "none" });
	});

	it("classifies an invalid name as CREATE_NAME_REJECTED", async () => {
		const result = await createSkill(
			{ name: "../uppercase", content: SAMPLE_CONTENT },
			makeDeps({}),
		);
		expect(result.error).toBeDefined();
		if (result.error === undefined) return;
		expect(result.code).toBe("CREATE_NAME_REJECTED");
	});

	it("classifies an empty index as INDEX_EMPTY", async () => {
		const result = await createSkill(
			{ name: "no-index-yet", content: SAMPLE_CONTENT },
			makeDeps({ registry: makeRegistry({ indexEmpty: true }) }),
		);
		expect(result.error).toBeDefined();
		if (result.error === undefined) return;
		expect(result.code).toBe("INDEX_EMPTY");
	});

	it("classifies a duplicate name as CREATE_NAME_EXISTS", async () => {
		const result = await createSkill(
			{ name: "dup", content: SAMPLE_CONTENT },
			makeDeps({ registry: makeRegistry({ entries: [makeEntry()] }) }),
		);
		expect(result.error).toBeDefined();
		if (result.error === undefined) return;
		expect(result.code).toBe("CREATE_NAME_EXISTS");
	});

	it("classifies an existing target directory as CREATE_TARGET_EXISTS", async () => {
		const agentDir = makeTempDir();
		mkdirSync(join(agentDir, "skills", "occupied"), { recursive: true });
		const result = await createSkill(
			{ name: "occupied", content: SAMPLE_CONTENT },
			makeDeps({ agentDir }),
		);
		expect(result.error).toBeDefined();
		if (result.error === undefined) return;
		expect(result.code).toBe("CREATE_TARGET_EXISTS");
	});

	it("classifies a write failure as CREATE_WRITE_FAILED", async () => {
		const agentDir = makeTempDir();
		// The skills root slot is occupied by a FILE, so mkdir of the target
		// directory fails inside the atomic write (existsSync stays false).
		writeFileSync(join(agentDir, "skills"), "file");
		const result = await createSkill(
			{ name: "blocked", content: SAMPLE_CONTENT },
			makeDeps({ agentDir }),
		);
		expect(result.error).toBeDefined();
		if (result.error === undefined) return;
		expect(result.code).toBe("CREATE_WRITE_FAILED");
		expect(result.evidence).toEqual({ kind: "none" });
		expect(result.evidence).toEqual({ kind: "none" });
		expect(existsSync(join(agentDir, "skills", "blocked", "SKILL.md"))).toBe(
			false,
		);
	});

	it("classifies an invalid name as CREATE_NAME_REJECTED with none evidence", async () => {
		const result = await createSkill(
			{ name: "../uppercase", content: SAMPLE_CONTENT },
			makeDeps({}),
		);
		expect(result.error).toBeDefined();
		if (result.error === undefined) return;
		expect(result.code).toBe("CREATE_NAME_REJECTED");
		expect(result.evidence).toEqual({ kind: "none" });
	});

	it("classifies an empty index as INDEX_EMPTY with none evidence", async () => {
		const result = await createSkill(
			{ name: "no-index-yet", content: SAMPLE_CONTENT },
			makeDeps({ registry: makeRegistry({ indexEmpty: true }) }),
		);
		expect(result.error).toBeDefined();
		if (result.error === undefined) return;
		expect(result.code).toBe("INDEX_EMPTY");
		expect(result.evidence).toEqual({ kind: "none" });
	});

	it("classifies a duplicate name as CREATE_NAME_EXISTS with none evidence", async () => {
		const result = await createSkill(
			{ name: "dup", content: SAMPLE_CONTENT },
			makeDeps({ registry: makeRegistry({ entries: [makeEntry()] }) }),
		);
		expect(result.error).toBeDefined();
		if (result.error === undefined) return;
		expect(result.code).toBe("CREATE_NAME_EXISTS");
		expect(result.evidence).toEqual({ kind: "none" });
	});

	it("classifies an existing target directory as CREATE_TARGET_EXISTS with none evidence", async () => {
		const agentDir = makeTempDir();
		mkdirSync(join(agentDir, "skills", "occupied"), { recursive: true });
		const result = await createSkill(
			{ name: "occupied", content: SAMPLE_CONTENT },
			makeDeps({ agentDir }),
		);
		expect(result.error).toBeDefined();
		if (result.error === undefined) return;
		expect(result.code).toBe("CREATE_TARGET_EXISTS");
		expect(result.evidence).toEqual({ kind: "none" });
	});

	it("classifies a post-write verification mismatch as CREATE_VERIFY_FAILED", async () => {
		const agentDir = makeTempDir();
		// Force the post-write re-read to diverge: the first readFileSync call
		// inside createSkill is the verification re-read (the temp write is a
		// writeFileSync, not a read). The mismatch branch is otherwise
		// unreachable with a real node:fs.
		vi
			.mocked(readFileSync)
			.mockImplementationOnce(
				(_path: unknown, ..._args: unknown[]) => "tampered content",
			);
		try {
			const result = await createSkill(
				{ name: "round-trip", content: SAMPLE_CONTENT },
				makeDeps({ agentDir }),
			);
			expect(result.error).toBeDefined();
			if (result.error === undefined) return;
			expect(result.error).toContain("post-write verification failed");
			expect(result.code).toBe("CREATE_VERIFY_FAILED");
			expect(result.evidence).toEqual({ kind: "none" });
		} finally {
			vi.mocked(readFileSync).mockRestore();
		}
	});
});
