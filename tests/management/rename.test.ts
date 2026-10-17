/**
 * Renaming: the skill directory moves within its location, a related file
 * changes its basename, and neither lands on an existing target.
 */
import { afterAll, describe, expect, it } from "vitest";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { renameSkill } from "../../src/management/rename";
import type { ManagementPorts } from "../../src/management/types";
import { buildIndex } from "../../src/discovery/registry";
import { resolveSkillFile } from "../../src/files/read";
import { walkFiles } from "../../src/files/list";
import type { Index, RegistryEntry } from "../../src/discovery/types";
import type { Failure } from "../../src/failure/types";

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

interface World {
	readonly agentDir: string;
	readonly cwd: string;
}

function world(): World {
	const root = tempDir("mgmt-rename-");
	const agentDir = path.join(root, "agent");
	const cwd = path.join(root, "project");
	mkdirSync(path.join(agentDir, "skills"), { recursive: true });
	mkdirSync(path.join(cwd, ".pi", "skills"), { recursive: true });
	return { agentDir, cwd };
}

function writeSkill(
	root: string,
	name: string,
	body = `---\nname: ${name}\n---\n`,
): string {
	const dir = path.join(root, name);
	mkdirSync(dir, { recursive: true });
	writeFileSync(path.join(dir, "SKILL.md"), body);
	return dir;
}

function portsFor(
	w: World,
	overrides: Partial<ManagementPorts> = {},
): ManagementPorts {
	return {
		index: buildIndex({ agentDir: w.agentDir, cwd: w.cwd }),
		defaultLocation: "global",
		listFiles: (root) => {
			const walked = walkFiles(root, {
				skipHidden: false,
				ignoredDirectories: new Set<string>(),
				minDepth: 0,
			});
			return walked.ok
				? { ok: true, files: walked.files.map((file) => file.path) }
				: walked;
		},
		resolveRef: (baseDir, refPath) => resolveSkillFile(baseDir, refPath),
		...overrides,
	};
}

function failureOf(result: { ok: boolean }): Failure {
	expect(result.ok).toBe(false);
	return (result as { ok: false; failure: Failure }).failure;
}

describe("renameSkill", () => {
	it("moves the skill directory and reports every moved file", () => {
		const w = world();
		const skills = path.join(w.agentDir, "skills");
		const oldDir = writeSkill(skills, "alpha");
		mkdirSync(path.join(oldDir, "references"));
		writeFileSync(path.join(oldDir, "references", "notes.md"), "# Notes\n");

		const result = renameSkill(portsFor(w), "alpha", "beta");

		expect(result.ok).toBe(true);
		if (!result.ok || result.kind !== "skill") return;
		const newDir = path.join(skills, "beta");
		expect(result.from).toBe(oldDir);
		expect(result.to).toBe(newDir);
		expect(result.files).toEqual([
			path.join(newDir, "SKILL.md"),
			path.join(newDir, "references", "notes.md"),
		]);
		expect(readdirSync(skills)).toEqual(["beta"]);
	});

	it("refuses a read-only location", () => {
		const root = tempDir("mgmt-rename-package-");
		const pkg = path.join(root, "pkg");
		writeSkill(pkg, "alpha");
		const entry: RegistryEntry = {
			location: "package",
			name: "alpha",
			id: "package:alpha",
			filePath: path.join(pkg, "alpha", "SKILL.md"),
			baseDir: path.join(pkg, "alpha"),
			frontmatter: {},
		};
		const index: Index = {
			locations: [{ id: "package", path: pkg, writable: false }],
			entries: [entry],
		};

		const failure = failureOf(
			renameSkill(
				{
					index,
					defaultLocation: "package",
					listFiles: (root) => {
						const walked = walkFiles(root, {
							skipHidden: false,
							ignoredDirectories: new Set<string>(),
							minDepth: 0,
						});
						return walked.ok
							? { ok: true, files: walked.files.map((file) => file.path) }
							: walked;
					},
					resolveRef: (baseDir, refPath) =>
						resolveSkillFile(baseDir, refPath),
				},
				"alpha",
				"beta",
			),
		);
		expect(failure.code).toBe("LOCATION_READ_ONLY");
		expect(failure.evidence).toEqual({
			kind: "location",
			location: "package",
		});
	});

	it("rejects a name the index already holds", () => {
		const w = world();
		writeSkill(path.join(w.agentDir, "skills"), "alpha");
		writeSkill(path.join(w.agentDir, "skills"), "beta");

		const failure = failureOf(renameSkill(portsFor(w), "alpha", "beta"));

		expect(failure.code).toBe("TARGET_EXISTS");
		expect(failure.evidence).toEqual({
			kind: "conflict",
			target: { kind: "id", id: "global:beta" },
		});
	});

	it("rejects an existing target directory that the index does not hold", () => {
		const w = world();
		writeSkill(path.join(w.agentDir, "skills"), "alpha");
		const ghost = path.join(w.agentDir, "skills", "ghost");
		mkdirSync(ghost);

		const failure = failureOf(renameSkill(portsFor(w), "alpha", "ghost"));

		expect(failure.code).toBe("TARGET_EXISTS");
		expect(failure.evidence).toEqual({
			kind: "conflict",
			target: { kind: "path", path: ghost },
		});
	});

	it("rejects a new name outside the skill-name grammar", () => {
		const w = world();
		writeSkill(path.join(w.agentDir, "skills"), "alpha");

		const failure = failureOf(renameSkill(portsFor(w), "alpha", "Bad_Name"));

		expect(failure.code).toBe("ID_NAME_INVALID");
	});

	it("reports an absent skill", () => {
		const w = world();
		const failure = failureOf(renameSkill(portsFor(w), "absent", "beta"));
		expect(failure.code).toBe("ID_NOT_FOUND");
	});

	it("renames a related file inside its type directory", () => {
		const w = world();
		const dir = writeSkill(path.join(w.agentDir, "skills"), "alpha");
		mkdirSync(path.join(dir, "references"));
		const oldFile = path.join(dir, "references", "notes.md");
		writeFileSync(oldFile, "# Notes\n");

		const result = renameSkill(
			portsFor(w),
			"alpha/references/notes.md",
			"notes-v2.md",
		);

		expect(result.ok).toBe(true);
		if (!result.ok || result.kind !== "file") return;
		expect(result.from).toBe(oldFile);
		expect(result.to).toBe(path.join(dir, "references", "notes-v2.md"));
		expect(readdirSync(path.join(dir, "references"))).toEqual([
			"notes-v2.md",
		]);
	});

	it("rejects a related-file target that already exists", () => {
		const w = world();
		const dir = writeSkill(path.join(w.agentDir, "skills"), "alpha");
		mkdirSync(path.join(dir, "references"));
		writeFileSync(path.join(dir, "references", "notes.md"), "# Notes\n");
		writeFileSync(path.join(dir, "references", "other.md"), "# Other\n");

		const failure = failureOf(
			renameSkill(portsFor(w), "alpha/references/notes.md", "other.md"),
		);

		expect(failure.code).toBe("TARGET_EXISTS");
		expect(failure.evidence).toEqual({
			kind: "conflict",
			target: {
				kind: "path",
				path: path.join(dir, "references", "other.md"),
			},
		});
	});

	it("rejects a new related-file name that is a path", () => {
		const w = world();
		const dir = writeSkill(path.join(w.agentDir, "skills"), "alpha");
		mkdirSync(path.join(dir, "references"));
		writeFileSync(path.join(dir, "references", "notes.md"), "# Notes\n");

		const failure = failureOf(
			renameSkill(portsFor(w), "alpha/references/notes.md", "sub/x.md"),
		);

		expect(failure.code).toBe("REF_PATH_INVALID");
	});

	it("reports a related file that is not on disk", () => {
		const w = world();
		writeSkill(path.join(w.agentDir, "skills"), "alpha");

		const failure = failureOf(
			renameSkill(portsFor(w), "alpha/references/absent.md", "x.md"),
		);

		expect(failure.code).toBe("PATH_NOT_FOUND");
	});
});
