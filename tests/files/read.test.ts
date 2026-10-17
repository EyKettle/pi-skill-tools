/**
 * File access: containment against the skill directory (dot-dot and symlink
 * escapes alike), whole untruncated reads, binary rejection, and the section
 * projection.
 */
import { afterAll, describe, expect, it } from "vitest";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readSkillFile, resolveSkillFile } from "../../src/files/read";

const tmpDirs: string[] = [];

function tempDir(prefix: string): string {
	const dir = mkdtempSync(path.join(tmpdir(), prefix));
	tmpDirs.push(dir);
	return dir;
}

afterAll(() => {
	for (const dir of tmpDirs) {
		rmSync(dir, { recursive: true, force: true });
	}
});

interface Fixture {
	baseDir: string;
	realBase: string;
}

function makeSkillDir(): Fixture {
	const tmp = tempDir("files-read-");
	const baseDir = path.join(tmp, "skill");
	mkdirSync(path.join(baseDir, "references"), { recursive: true });
	writeFileSync(path.join(baseDir, "SKILL.md"), "# My Skill\n\nBody text.\n");
	writeFileSync(path.join(baseDir, "references", "ref.md"), "# Ref\n");
	writeFileSync(path.join(baseDir, "bin.dat"), "line one\0line two");

	const outside = path.join(tmp, "outside");
	mkdirSync(outside);
	writeFileSync(path.join(outside, "secret.md"), "# secret\n");
	symlinkSync(path.join(outside, "secret.md"), path.join(baseDir, "escape.md"));
	symlinkSync(
		path.join(baseDir, "references", "ref.md"),
		path.join(baseDir, "inside.md"),
	);
	return { baseDir, realBase: realpathSync(baseDir) };
}

function makeLinkDirs(): string {
	const tmp = tempDir("files-links-");
	const baseDir = path.join(tmp, "skill");
	mkdirSync(baseDir, { recursive: true });
	// A dangling directory link: its target does not exist.
	symlinkSync(path.join(tmp, "outside-gone"), path.join(baseDir, "dangling"));
	// A live link outside whose target directory lacks the referenced file.
	const outside = path.join(tmp, "outside");
	mkdirSync(outside);
	symlinkSync(outside, path.join(baseDir, "linked"));
	return baseDir;
}

function resolved(baseDir: string, refPath?: string): string {
	const result = resolveSkillFile(baseDir, refPath);
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error("resolve failed");
	return result.path;
}

function rejection(baseDir: string, refPath?: string) {
	const result = resolveSkillFile(baseDir, refPath);
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error("resolve should fail");
	return result.failure;
}

describe("resolveSkillFile", () => {
	it("defaults to the skill's main document", () => {
		const { baseDir, realBase } = makeSkillDir();
		expect(resolved(baseDir)).toBe(path.join(realBase, "SKILL.md"));
	});

	it("resolves a relative reference inside the skill directory", () => {
		const { baseDir, realBase } = makeSkillDir();
		expect(resolved(baseDir, "references/ref.md")).toBe(
			path.join(realBase, "references", "ref.md"),
		);
	});

	it("follows a symlink that stays inside the skill directory", () => {
		const { baseDir, realBase } = makeSkillDir();
		expect(resolved(baseDir, "inside.md")).toBe(
			path.join(realBase, "references", "ref.md"),
		);
	});

	it("rejects an absolute reference with the raw input", () => {
		const { baseDir } = makeSkillDir();
		const failure = rejection(baseDir, "/etc/passwd");
		expect(failure.code).toBe("REF_PATH_INVALID");
		expect(failure.evidence).toEqual({
			kind: "input",
			input: "/etc/passwd",
		});
	});

	it("rejects a dot-dot escape", () => {
		const { baseDir } = makeSkillDir();
		const failure = rejection(baseDir, "../outside/secret.md");
		expect(failure.code).toBe("REF_PATH_INVALID");
		expect(failure.evidence).toEqual({
			kind: "input",
			input: "../outside/secret.md",
		});
	});

	it("rejects a symlink that points outside", () => {
		const { baseDir } = makeSkillDir();
		const failure = rejection(baseDir, "escape.md");
		expect(failure.code).toBe("REF_PATH_INVALID");
	});

	it("rejects a dangling symlink component before its target exists", () => {
		const baseDir = makeLinkDirs();
		expect(rejection(baseDir, "dangling/secret.md").code).toBe(
			"REF_PATH_INVALID",
		);
	});

	it("rejects an intermediate symlink that lands outside", () => {
		const baseDir = makeLinkDirs();
		expect(rejection(baseDir, "linked/secret.md").code).toBe(
			"REF_PATH_INVALID",
		);
	});

	it("reports a missing target with its absolute path", () => {
		const { baseDir } = makeSkillDir();
		const target = path.join(baseDir, "references", "missing.md");
		const failure = rejection(baseDir, "references/missing.md");
		expect(failure.code).toBe("PATH_NOT_FOUND");
		expect(failure.evidence).toEqual({ kind: "path", path: target });
	});

	it("reports a missing skill directory with its absolute path", () => {
		const root = tempDir("files-missing-base-");
		const baseDir = path.join(root, "gone");
		const failure = rejection(baseDir);
		expect(failure.code).toBe("PATH_NOT_FOUND");
		expect(failure.evidence).toEqual({ kind: "path", path: baseDir });
	});
});

describe("readSkillFile", () => {
	it("reads a 5000-line file verbatim without truncation", () => {
		const { baseDir } = makeSkillDir();
		const body =
			Array.from({ length: 5000 }, (_, index) => `line ${index}`).join("\n") +
			"\n";
		const filePath = path.join(baseDir, "big.md");
		writeFileSync(filePath, body);

		const result = readSkillFile(filePath);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.text).toBe(body);
		expect(result.lines).toBe(5000);
		expect(result.bytes).toBe(body.length);
	});

	it("counts lines the way an editor does at the boundaries", () => {
		const { baseDir } = makeSkillDir();
		const cases: Array<[string, number]> = [
			["a\nb\n", 2],
			["a\nb", 2],
			["\n", 1],
			["", 0],
		];
		for (const [content, lines] of cases) {
			const filePath = path.join(baseDir, `lines-${JSON.stringify(content)}`);
			writeFileSync(filePath, content);
			const result = readSkillFile(filePath);
			expect(result.ok).toBe(true);
			if (!result.ok) continue;
			expect(result.lines).toBe(lines);
		}
	});

	it("rejects a NUL byte inside the sniff window", () => {
		const { baseDir } = makeSkillDir();
		const filePath = path.join(baseDir, "bin.dat");
		const result = readSkillFile(filePath);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.failure.code).toBe("FILE_NOT_TEXT");
		expect(result.failure.evidence).toEqual({ kind: "path", path: filePath });
	});

	it("accepts a NUL byte beyond the sniff window", () => {
		const { baseDir } = makeSkillDir();
		const filePath = path.join(baseDir, "late-nul.dat");
		writeFileSync(filePath, `${"a".repeat(9000)}\0tail`);
		const result = readSkillFile(filePath);
		expect(result.ok).toBe(true);
	});

	it("reports a missing file with its absolute path", () => {
		const { baseDir } = makeSkillDir();
		const filePath = path.join(baseDir, "missing.md");
		const result = readSkillFile(filePath);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.failure.code).toBe("PATH_NOT_FOUND");
		expect(result.failure.evidence).toEqual({ kind: "path", path: filePath });
	});

	it("reports an unreadable file with its path and the underlying error", () => {
		if (process.getuid?.() === 0) return;
		const { baseDir } = makeSkillDir();
		const filePath = path.join(baseDir, "locked.md");
		writeFileSync(filePath, "# locked\n");
		chmodSync(filePath, 0o000);
		try {
			const result = readSkillFile(filePath);
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.failure.code).toBe("READ_FAILED");
			expect(result.failure.evidence.kind).toBe("pathError");
			if (result.failure.evidence.kind !== "pathError") return;
			expect(result.failure.evidence.path).toBe(filePath);
			expect(result.failure.evidence.error.length).toBeGreaterThan(0);
		} finally {
			chmodSync(filePath, 0o644);
		}
	});

	it("carries the file's timestamps", () => {
		const { baseDir } = makeSkillDir();
		const filePath = path.join(baseDir, "SKILL.md");
		const result = readSkillFile(filePath);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.createdAt).toBeInstanceOf(Date);
		expect(result.updatedAt).toBeInstanceOf(Date);
		expect(Math.abs(Date.now() - result.updatedAt.getTime())).toBeLessThan(
			60_000,
		);
	});

	it("projects the requested section and keeps the whole text", () => {
		const { baseDir } = makeSkillDir();
		const filePath = path.join(baseDir, "SKILL.md");
		writeFileSync(
			filePath,
			"# Skill\n\n## When to Use\nUse it here.\n\n## Other\nOther.\n",
		);

		const result = readSkillFile(filePath, { section: "When to Use" });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.text).toBe(
			"# Skill\n\n## When to Use\nUse it here.\n\n## Other\nOther.\n",
		);
		expect(result.section).toEqual({
			heading: "## When to Use",
			content: "## When to Use\nUse it here.",
			lines: 2,
			bytes: Buffer.byteLength("## When to Use\nUse it here.", "utf8"),
		});
	});

	it("reports a missing section with its name and path", () => {
		const { baseDir } = makeSkillDir();
		const filePath = path.join(baseDir, "SKILL.md");
		const result = readSkillFile(filePath, { section: "Nope" });
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.failure.code).toBe("SECTION_NOT_FOUND");
		expect(result.failure.evidence).toEqual({
			kind: "section",
			section: "Nope",
			path: filePath,
		});
	});

	it("has no section field when none was requested", () => {
		const { baseDir } = makeSkillDir();
		const result = readSkillFile(path.join(baseDir, "SKILL.md"));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.section).toBeUndefined();
	});
});
