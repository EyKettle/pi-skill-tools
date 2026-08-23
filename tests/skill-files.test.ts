import { describe, expect, it, afterAll } from "vitest";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listSkillFiles } from "../skill-files";

/**
 * Build the plan's fixture skill directory (plan Task 6 Step 1):
 * SKILL.md, references/a.md, scripts/run.sh, templates/t.json,
 * extra/other.txt, loose.md, node_modules/pkg/index.js, .hidden/x.md.
 */
function buildFixtureDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "skill-files-test-"));
	mkdirSync(join(dir, "references"));
	mkdirSync(join(dir, "scripts"));
	mkdirSync(join(dir, "templates"));
	mkdirSync(join(dir, "extra"));
	mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
	mkdirSync(join(dir, ".hidden"));
	writeFileSync(join(dir, "SKILL.md"), "# Fixture skill\n");
	writeFileSync(join(dir, "references", "a.md"), "# reference a\n");
	writeFileSync(join(dir, "scripts", "run.sh"), "#!/bin/sh\necho hi\n");
	writeFileSync(join(dir, "templates", "t.json"), '{ "k": 1 }\n');
	writeFileSync(join(dir, "extra", "other.txt"), "extra file\n");
	writeFileSync(join(dir, "loose.md"), "# loose file\n");
	writeFileSync(
		join(dir, "node_modules", "pkg", "index.js"),
		"module.exports = 42;\n",
	);
	writeFileSync(join(dir, ".hidden", "x.md"), "# hidden\n");
	return dir;
}

const tmpDirs: string[] = [];

function makeTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "skill-files-test-"));
	tmpDirs.push(dir);
	return dir;
}

afterAll(() => {
	for (const dir of tmpDirs) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("listSkillFiles", () => {
	it("excludes SKILL.md, skips node_modules/ and dot-directories, and reports every other file", () => {
		const fixture = buildFixtureDir();
		tmpDirs.push(fixture);
		const result = listSkillFiles("global", "fixture", fixture);
		expect(result.error).toBeUndefined();
		if (result.error !== undefined) return;
		const entries = result.entries;
		expect(entries.map((e) => e.refId)).toEqual([
			"global:fixture/references/a.md",
			"global:fixture/scripts/run.sh",
			"global:fixture/templates/t.json",
			"global:fixture/extra/other.txt",
			"global:fixture/loose.md",
		]);
		for (const entry of entries) {
			expect(entry.path.startsWith("/")).toBe(true);
			expect(entry.bytes).toBeGreaterThan(0);
		}
		const ref = entries.find(
			(e) => e.refId === "global:fixture/references/a.md",
		);
		expect(ref).toBeDefined();
		expect(ref!.path).toBe(join(fixture, "references", "a.md"));
		expect(ref!.bytes).toBe("# reference a\n".length);
		expect(
			entries.some((e) => e.path.startsWith(join(fixture, "node_modules"))),
		).toBe(false);
		expect(
			entries.some((e) => e.path.startsWith(join(fixture, ".hidden"))),
		).toBe(false);
	});

	it("orders conventional directories first, then the rest by POSIX relative path", () => {
		const fixture = buildFixtureDir();
		tmpDirs.push(fixture);
		const result = listSkillFiles("global", "demo", fixture);
		expect(result.error).toBeUndefined();
		if (result.error !== undefined) return;
		const ids = result.entries.map((e) => e.refId);
		expect(ids.indexOf("global:demo/references/a.md")).toBeLessThan(
			ids.indexOf("global:demo/scripts/run.sh"),
		);
		expect(ids.indexOf("global:demo/scripts/run.sh")).toBeLessThan(
			ids.indexOf("global:demo/templates/t.json"),
		);
		expect(ids.indexOf("global:demo/templates/t.json")).toBeLessThan(
			ids.indexOf("global:demo/extra/other.txt"),
		);
		expect(ids.indexOf("global:demo/extra/other.txt")).toBeLessThan(
			ids.indexOf("global:demo/loose.md"),
		);
	});

	it("renders ref ids via the storage:name/relative-path grammar", () => {
		const fixture = buildFixtureDir();
		tmpDirs.push(fixture);
		const result = listSkillFiles(
			"project",
			"tools",
			join(fixture, "references"),
		);
		expect(result.error).toBeUndefined();
		if (result.error !== undefined) return;
		expect(result.entries.map((e) => e.refId)).toEqual(["project:tools/a.md"]);
	});

	it("does not follow symlinks", () => {
		const dir = makeTempDir();
		const target = makeTempDir();
		writeFileSync(join(target, "real.md"), "# real\n");
		symlinkSync(target, join(dir, "linked"), "dir");
		const result = listSkillFiles("global", "demo", dir);
		expect(result.error).toBeUndefined();
		if (result.error !== undefined) return;
		expect(result.entries).toEqual([]);
	});

	it("returns an empty array for an empty skill directory without throwing", () => {
		const dir = makeTempDir();
		expect(() => listSkillFiles("global", "empty", dir)).not.toThrow();
		const result = listSkillFiles("global", "empty", dir);
		expect(result.error).toBeUndefined();
		if (result.error !== undefined) return;
		expect(result.entries).toEqual([]);
	});

	it("returns a structured error when baseDir does not exist", () => {
		const dir = makeTempDir();
		const missing = join(dir, "missing");
		expect(() => listSkillFiles("global", "gone", missing)).not.toThrow();
		const result = listSkillFiles("global", "gone", missing);
		expect(result.error).toBeDefined();
		if (result.error === undefined) return;
		expect(result.error).toContain("cannot read");
	});

	it("returns a structured error when baseDir is unreadable", () => {
		const dir = makeTempDir();
		chmodSync(dir, 0o000);
		try {
			const result = listSkillFiles("global", "locked", dir);
			expect(result.error).toBeDefined();
			if (result.error === undefined) return;
			expect(result.error).toContain("cannot read");
		} finally {
			chmodSync(dir, 0o755);
		}
	});
});

describe("failure vocabulary integration", () => {
	it("classifies a missing base dir as DIR_UNREADABLE", () => {
		const dir = makeTempDir();
		const result = listSkillFiles("global", "gone", join(dir, "missing"));
		expect(result.error).toBeDefined();
		if (result.error === undefined) return;
		expect(result.code).toBe("DIR_UNREADABLE");
		expect(result.evidence).toEqual({ kind: "none" });
	});
});
