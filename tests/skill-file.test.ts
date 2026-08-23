import { describe, expect, it } from "vitest";
import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { readSkillFile, resolveSkillFile } from "../skill-file";

/** Build a temporary skill root with SKILL.md, a ref file, a NUL-byte
 * binary, a sibling directory outside the root, and a REAL symlink inside
 * the root pointing outside (design.md §5.4, §7). */
function makeSkillDir() {
	const tmp = mkdtempSync(path.join(os.tmpdir(), "skill-tools-"));
	const baseDir = path.join(tmp, "skill");
	const refDir = path.join(baseDir, "references");
	mkdirSync(refDir, { recursive: true });
	writeFileSync(path.join(baseDir, "SKILL.md"), "# My Skill\n\nBody text.\n");
	writeFileSync(path.join(refDir, "ref.md"), "# Ref\n\nReference body.\n");
	writeFileSync(path.join(baseDir, "bin.dat"), "line one\0line two");

	const outsideDir = path.join(tmp, "outside");
	mkdirSync(outsideDir);
	writeFileSync(path.join(outsideDir, "secret.md"), "# secret\n");
	// Real symlink inside the skill root pointing outside of it.
	symlinkSync(
		path.join(outsideDir, "secret.md"),
		path.join(baseDir, "escape.md"),
	);
	return { baseDir, realBase: realpathSync(baseDir) };
}
/** Build a root with a DANGLING symlink (its target directory does not
 * exist) and an intermediate symlink whose outside target exists but lacks
 * the referenced file. */
function makeDanglingLinkDir() {
	const tmp = mkdtempSync(path.join(os.tmpdir(), "skill-tools-"));
	const baseDir = path.join(tmp, "skill");
	mkdirSync(baseDir, { recursive: true });
	// Broken symlink: the base target directory does not exist.
	symlinkSync(
		path.join(tmp, "outside-gone"),
		path.join(baseDir, "dangling"),
		"dir",
	);
	// Live symlink: the target directory exists but has no secret.md.
	const outsideDir = path.join(tmp, "outside");
	mkdirSync(outsideDir);
	symlinkSync(outsideDir, path.join(baseDir, "linked"), "dir");
	return baseDir;
}

describe("resolveSkillFile", () => {
	it("defaults to <baseDir>/SKILL.md when no ref path is given", () => {
		const { baseDir, realBase } = makeSkillDir();
		const result = resolveSkillFile(baseDir);
		expect(result.error).toBeUndefined();
		if (result.error) return;
		expect(result.path).toBe(path.join(realBase, "SKILL.md"));
	});

	it("resolves a ref path inside the skill directory", () => {
		const { baseDir, realBase } = makeSkillDir();
		const result = resolveSkillFile(baseDir, "references/ref.md");
		expect(result.error).toBeUndefined();
		if (result.error) return;
		expect(result.path).toBe(path.join(realBase, "references", "ref.md"));
	});

	it("errors on a dot-dot escape", () => {
		const { baseDir } = makeSkillDir();
		const result = resolveSkillFile(baseDir, "../outside/secret.md");
		expect(result.error).toContain("escapes");
	});

	it("errors on an absolute ref path", () => {
		const { baseDir } = makeSkillDir();
		const result = resolveSkillFile(baseDir, "/etc/passwd");
		expect(result.error).toContain("absolute");
	});

	it("errors when a symlink inside the root points outside", () => {
		const { baseDir } = makeSkillDir();
		const result = resolveSkillFile(baseDir, "escape.md");
		expect(result.error).toContain("escapes");
	});

	it("errors when a dangling symlink component points outside a missing target", () => {
		const baseDir = makeDanglingLinkDir();
		const result = resolveSkillFile(baseDir, "dangling/secret.md");
		expect(result.error).toBeDefined();
		if (result.error === undefined) return;
		expect(result.error).toContain("escapes");
	});

	it("errors when an intermediate symlink points outside and the final file is missing there", () => {
		const baseDir = makeDanglingLinkDir();
		const result = resolveSkillFile(baseDir, "linked/secret.md");
		expect(result.error).toBeDefined();
		if (result.error === undefined) return;
		expect(result.error).toContain("escapes");
	});
});

describe("readSkillFile", () => {
	it("returns a 5000-line file verbatim with lines === 5000 and no truncation marker", () => {
		const { baseDir } = makeSkillDir();
		const body =
			Array.from({ length: 5000 }, (_, i) => `line ${i}`).join("\n") + "\n";
		const filePath = path.join(baseDir, "big.md");
		writeFileSync(filePath, body);

		const result = readSkillFile(filePath);
		expect(result.error).toBeUndefined();
		if (result.error) return;
		expect(result.text).toBe(body);
		expect(result.lines).toBe(5000);
		expect(result.bytes).toBe(body.length);
		expect(result.text).not.toMatch(/truncat/i);
	});

	it("rejects a NUL-byte file as not a text file", () => {
		const { baseDir } = makeSkillDir();
		const result = readSkillFile(path.join(baseDir, "bin.dat"));
		expect(result.error).toContain("not a text file");
	});

	it("returns only the frontmatter block when frontmatterOnly is set", () => {
		const { baseDir } = makeSkillDir();
		const filePath = path.join(baseDir, "fm.md");
		writeFileSync(
			filePath,
			"---\nname: demo\ndescription: test file\n---\n# Body\n",
		);

		const result = readSkillFile(filePath, { frontmatterOnly: true });
		expect(result.error).toBeUndefined();
		if (result.error) return;
		expect(result.text).toBe("---\nname: demo\ndescription: test file\n---\n");
		expect(result.text).not.toContain("# Body");
		expect(result.lines).toBe(4);
	});

	it("errors on frontmatterOnly when the file has no frontmatter", () => {
		const { baseDir } = makeSkillDir();
		const filePath = path.join(baseDir, "plain.md");
		writeFileSync(filePath, "# no frontmatter\n");

		const result = readSkillFile(filePath, { frontmatterOnly: true });
		expect(result.error).toContain("frontmatter");
	});

	it("errors with a clean message when the file does not exist", () => {
		const { baseDir } = makeSkillDir();
		const result = readSkillFile(path.join(baseDir, "missing.md"));
		expect(result.error).toContain("cannot read");
	});
});

describe("failure vocabulary integration", () => {
	it("classifies an absolute ref path as PATH_ABSOLUTE_REF", () => {
		const { baseDir } = makeSkillDir();
		const result = resolveSkillFile(baseDir, "/etc/passwd");
		expect(result.error).toBeDefined();
		if (result.error === undefined) return;
		expect(result.code).toBe("PATH_ABSOLUTE_REF");
		expect(result.evidence).toEqual({ kind: "none" });
	});

	it("classifies dot-dot and symlink escapes as PATH_ESCAPE", () => {
		const { baseDir } = makeSkillDir();
		const dotDot = resolveSkillFile(baseDir, "../outside/secret.md");
		expect(dotDot.error).toBeDefined();
		if (dotDot.error === undefined) return;
		expect(dotDot.code).toBe("PATH_ESCAPE");
		expect(dotDot.evidence).toEqual({ kind: "none" });

		const symlink = resolveSkillFile(baseDir, "escape.md");
		expect(symlink.error).toBeDefined();
		if (symlink.error === undefined) return;
		expect(symlink.code).toBe("PATH_ESCAPE");
		expect(symlink.evidence).toEqual({ kind: "none" });
	});

	it("classifies a dangling symlink escape as PATH_ESCAPE", () => {
		const baseDir = makeDanglingLinkDir();
		const result = resolveSkillFile(baseDir, "dangling/secret.md");
		expect(result.error).toBeDefined();
		if (result.error === undefined) return;
		expect(result.code).toBe("PATH_ESCAPE");
		expect(result.evidence).toEqual({ kind: "none" });
	});

	it("classifies an unresolvable base directory as PATH_UNRESOLVABLE", () => {
		const result = resolveSkillFile(
			path.join(os.tmpdir(), "no-such-skill-dir-xyz"),
		);
		expect(result.error).toBeDefined();
		if (result.error === undefined) return;
		expect(result.code).toBe("PATH_UNRESOLVABLE");
		expect(result.evidence).toEqual({ kind: "none" });
	});

	it("classifies read failures with their codes", () => {
		const { baseDir } = makeSkillDir();
		const nul = readSkillFile(path.join(baseDir, "bin.dat"));
		expect(nul.error).toBeDefined();
		if (nul.error === undefined) return;
		expect(nul.code).toBe("FILE_NOT_TEXT");
		expect(nul.evidence).toEqual({ kind: "none" });

		const missing = readSkillFile(path.join(baseDir, "missing.md"));
		expect(missing.error).toBeDefined();
		if (missing.error === undefined) return;
		expect(missing.code).toBe("FILE_UNREADABLE");
		expect(missing.evidence).toEqual({ kind: "none" });

		const plainPath = path.join(baseDir, "plain.md");
		writeFileSync(plainPath, "# no frontmatter\n");
		const noFm = readSkillFile(plainPath, { frontmatterOnly: true });
		expect(noFm.error).toBeDefined();
		if (noFm.error === undefined) return;
		expect(noFm.code).toBe("FILE_NO_FRONTMATTER");
		expect(noFm.evidence).toEqual({ kind: "none" });
	});
});
