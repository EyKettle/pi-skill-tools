/**
 * Removal: a skill's main document takes the whole directory, a related-file
 * id takes that one file, and a read-only location refuses both.
 */
import { afterAll, describe, expect, it } from "vitest";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { removeSkill } from "../../src/management/remove";
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
	const root = tempDir("mgmt-remove-");
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

describe("removeSkill", () => {
	it("removes the skill directory and reports every file", () => {
		const w = world();
		const dir = writeSkill(path.join(w.agentDir, "skills"), "alpha");
		mkdirSync(path.join(dir, "references"));
		writeFileSync(path.join(dir, "references", "notes.md"), "# Notes\n");

		const result = removeSkill(portsFor(w), "alpha");

		expect(result.ok).toBe(true);
		if (!result.ok || result.kind !== "skill") return;
		expect(result.path).toBe(dir);
		expect(result.files).toEqual([
			path.join(dir, "SKILL.md"),
			path.join(dir, "references", "notes.md"),
		]);
		expect(existsSync(dir)).toBe(false);
	});

	it("removes one related file and keeps the skill", () => {
		const w = world();
		const dir = writeSkill(path.join(w.agentDir, "skills"), "alpha");
		mkdirSync(path.join(dir, "references"));
		const file = path.join(dir, "references", "notes.md");
		writeFileSync(file, "# Notes\n");

		const result = removeSkill(
			portsFor(w),
			"alpha/references/notes.md",
		);

		expect(result.ok).toBe(true);
		if (!result.ok || result.kind !== "file") return;
		expect(result.path).toBe(file);
		expect(existsSync(file)).toBe(false);
		expect(existsSync(path.join(dir, "SKILL.md"))).toBe(true);
	});

	it("refuses a read-only location", () => {
		const root = tempDir("mgmt-remove-package-");
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
			removeSkill(
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
			),
		);
		expect(failure.code).toBe("LOCATION_READ_ONLY");
		expect(existsSync(entry.baseDir)).toBe(true);
	});

	it("reports an absent skill", () => {
		const w = world();
		const failure = failureOf(removeSkill(portsFor(w), "absent"));
		expect(failure.code).toBe("ID_NOT_FOUND");
	});

	it("reports a related file that is not on disk", () => {
		const w = world();
		writeSkill(path.join(w.agentDir, "skills"), "alpha");

		const failure = failureOf(
			removeSkill(portsFor(w), "alpha/references/absent.md"),
		);

		expect(failure.code).toBe("PATH_NOT_FOUND");
	});

	it("rejects a related-file reference that escapes the skill directory", () => {
		const w = world();
		writeSkill(path.join(w.agentDir, "skills"), "alpha");

		const failure = failureOf(
			removeSkill(portsFor(w), "alpha/../escape.md"),
		);

		expect(failure.code).toBe("REF_PATH_INVALID");
	});

	it("reports a delete failure with the target and the underlying error", () => {
		if (process.getuid?.() === 0) return;
		const w = world();
		const dir = writeSkill(path.join(w.agentDir, "skills"), "alpha");
		mkdirSync(path.join(dir, "references"));
		const file = path.join(dir, "references", "notes.md");
		writeFileSync(file, "# Notes\n");
		chmodSync(path.join(dir, "references"), 0o500);
		try {
			const failure = failureOf(
				removeSkill(portsFor(w), "alpha/references/notes.md"),
			);
			expect(failure.code).toBe("WRITE_FAILED");
			expect(failure.evidence.kind).toBe("pathError");
			if (failure.evidence.kind !== "pathError") return;
			expect(failure.evidence.path).toBe(file);
		} finally {
			chmodSync(path.join(dir, "references"), 0o755);
		}
	});
});
