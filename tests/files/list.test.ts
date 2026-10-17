/**
 * Directory listing: the files a skill keeps in its type directories, never
 * the main document, never a link, and never a hidden or vendor tree.
 */
import { afterAll, describe, expect, it } from "vitest";
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
import { listSkillFiles } from "../../src/files/list";

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

function makeSkillDir(): string {
	const dir = tempDir("files-list-");
	mkdirSync(join(dir, "references", "sub"), { recursive: true });
	mkdirSync(join(dir, "scripts"));
	mkdirSync(join(dir, "extra"));
	mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
	mkdirSync(join(dir, ".hidden"));
	writeFileSync(join(dir, "SKILL.md"), "# Fixture skill\n");
	writeFileSync(join(dir, "loose.md"), "# loose file\n");
	writeFileSync(join(dir, "references", "a.md"), "# a\n");
	writeFileSync(join(dir, "references", "sub", "deep.md"), "# deep\n");
	writeFileSync(join(dir, "scripts", "run.sh"), "#!/bin/sh\n");
	writeFileSync(join(dir, "extra", "other.txt"), "extra\n");
	writeFileSync(join(dir, "node_modules", "pkg", "index.js"), "x\n");
	writeFileSync(join(dir, ".hidden", "x.md"), "# hidden\n");
	return dir;
}

describe("listSkillFiles", () => {
	it("lists the files under type directories, sorted by relative path", () => {
		const dir = makeSkillDir();
		const result = listSkillFiles(dir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.entries.map((entry) => entry.refPath)).toEqual([
			"extra/other.txt",
			"references/a.md",
			"references/sub/deep.md",
			"scripts/run.sh",
		]);
	});

	it("reports absolute paths and byte sizes", () => {
		const dir = makeSkillDir();
		const result = listSkillFiles(dir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const reference = result.entries.find(
			(entry) => entry.refPath === "references/a.md",
		);
		expect(reference).toEqual({
			refPath: "references/a.md",
			path: join(dir, "references", "a.md"),
			bytes: "# a\n".length,
		});
	});

	it("never lists the main document or a loose file", () => {
		const dir = makeSkillDir();
		const result = listSkillFiles(dir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const paths = result.entries.map((entry) => entry.refPath);
		expect(paths).not.toContain("SKILL.md");
		expect(paths).not.toContain("loose.md");
	});

	it("skips hidden entries, node_modules and .git", () => {
		const dir = makeSkillDir();
		mkdirSync(join(dir, ".git"));
		writeFileSync(join(dir, ".git", "config"), "[core]\n");
		const result = listSkillFiles(dir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const paths = result.entries.map((entry) => entry.refPath);
		expect(paths.some((entry) => entry.startsWith(".hidden/"))).toBe(false);
		expect(paths.some((entry) => entry.startsWith("node_modules/"))).toBe(
			false,
		);
		expect(paths.some((entry) => entry.startsWith(".git/"))).toBe(false);
	});

	it("does not follow a linked directory or a linked file", () => {
		const dir = makeSkillDir();
		const outside = tempDir("files-list-outside-");
		writeFileSync(join(outside, "real.md"), "# real\n");
		symlinkSync(outside, join(dir, "linked"));
		mkdirSync(join(dir, "other"));
		symlinkSync(join(outside, "real.md"), join(dir, "other", "link.md"));

		const result = listSkillFiles(dir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const paths = result.entries.map((entry) => entry.refPath);
		expect(paths).not.toContain("other/link.md");
		expect(paths.some((entry) => entry.startsWith("linked/"))).toBe(false);
	});

	it("returns no entries for a skill without type directories", () => {
		const dir = tempDir("files-list-empty-");
		writeFileSync(join(dir, "SKILL.md"), "# Empty\n");
		const result = listSkillFiles(dir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.entries).toEqual([]);
	});

	it("reports a missing directory with its absolute path", () => {
		const root = tempDir("files-list-missing-");
		const dir = join(root, "gone");
		const result = listSkillFiles(dir);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.failure.code).toBe("PATH_NOT_FOUND");
		expect(result.failure.evidence).toEqual({ kind: "path", path: dir });
	});

	it("reports an unreadable directory as a read failure", () => {
		if (process.getuid?.() === 0) return;
		const dir = makeSkillDir();
		const locked = join(dir, "references");
		chmodSync(locked, 0o000);
		try {
			const result = listSkillFiles(dir);
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.failure.code).toBe("READ_FAILED");
			expect(result.failure.evidence.kind).toBe("pathError");
			if (result.failure.evidence.kind !== "pathError") return;
			expect(result.failure.evidence.path).toBe(locked);
		} finally {
			chmodSync(locked, 0o755);
		}
	});
});
