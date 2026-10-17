/**
 * Creation: verbatim content, the default and prefixed locations, the
 * read-only refusal, conflict interception, and related files under an
 * existing skill.
 */
import { afterAll, describe, expect, it } from "vitest";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSkill } from "../../src/management/create";
import type { ManagementPorts } from "../../src/management/types";
import { buildIndex } from "../../src/discovery/registry";
import { resolveSkillFile } from "../../src/files/read";
import type { Index } from "../../src/discovery/types";
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
	const root = tempDir("mgmt-create-");
	const agentDir = path.join(root, "agent");
	const cwd = path.join(root, "project");
	mkdirSync(path.join(agentDir, "skills"), { recursive: true });
	mkdirSync(path.join(cwd, ".pi", "skills"), { recursive: true });
	return { agentDir, cwd };
}

function portsFor(
	w: World,
	overrides: Partial<ManagementPorts> = {},
): ManagementPorts {
	return {
		index: buildIndex({ agentDir: w.agentDir, cwd: w.cwd }),
		defaultLocation: "global",
		resolveRef: (baseDir, refPath) => resolveSkillFile(baseDir, refPath),
		...overrides,
	};
}

function failureOf(result: { ok: boolean }): Failure {
	expect(result.ok).toBe(false);
	return (result as { ok: false; failure: Failure }).failure;
}

const CONTENT = "---\nname: alpha\ndescription: demo\n---\n# Alpha\n";

describe("createSkill", () => {
	it("writes the content verbatim at the default location", () => {
		const w = world();
		const result = createSkill(portsFor(w), "alpha", CONTENT);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.path).toBe(
			path.join(w.agentDir, "skills", "alpha", "SKILL.md"),
		);
		expect(result.bytes).toBe(Buffer.byteLength(CONTENT, "utf8"));
		expect(result.lines).toBe(5);
		expect(readFileSync(result.path, "utf8")).toBe(CONTENT);
	});

	it("writes to a prefixed location", () => {
		const w = world();
		const result = createSkill(portsFor(w), "project:beta", "# Beta\n");

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.path).toBe(
			path.join(w.cwd, ".pi", "skills", "beta", "SKILL.md"),
		);
	});

	it("refuses a package location", () => {
		const w = world();
		const failure = failureOf(createSkill(portsFor(w), "package:gamma", "x"));
		expect(failure.code).toBe("LOCATION_READ_ONLY");
		expect(failure.evidence).toEqual({
			kind: "location",
			location: "package",
		});
	});

	it("refuses a temp location", () => {
		const w = world();
		const failure = failureOf(createSkill(portsFor(w), "temp:gamma", "x"));
		expect(failure.code).toBe("LOCATION_READ_ONLY");
	});

	it("reports an unregistered location prefix", () => {
		const w = world();
		const failure = failureOf(createSkill(portsFor(w), "extra:gamma", "x"));
		expect(failure.code).toBe("ID_LOCATION_UNKNOWN");
		expect(failure.evidence).toEqual({
			kind: "locations",
			locations: ["global", "project", "package", "temp"],
		});
	});

	it("reports an unregistered default location", () => {
		const w = world();
		const failure = failureOf(
			createSkill(portsFor(w, { defaultLocation: "nowhere" }), "alpha", "x"),
		);
		expect(failure.code).toBe("ID_LOCATION_UNKNOWN");
	});

	it("rejects a name the index already holds, naming the entry", () => {
		const w = world();
		expect(createSkill(portsFor(w), "alpha", CONTENT).ok).toBe(true);
		const failure = failureOf(
			createSkill(portsFor(w), "alpha", "# Other\n"),
		);
		expect(failure.code).toBe("TARGET_EXISTS");
		expect(failure.evidence).toEqual({
			kind: "conflict",
			target: { kind: "id", id: "global:alpha" },
		});
	});

	it("rejects a name the index holds in another location", () => {
		const w = world();
		expect(createSkill(portsFor(w), "project:alpha", CONTENT).ok).toBe(true);
		const failure = failureOf(createSkill(portsFor(w), "alpha", CONTENT));
		expect(failure.code).toBe("TARGET_EXISTS");
		expect(failure.evidence).toEqual({
			kind: "conflict",
			target: { kind: "id", id: "project:alpha" },
		});
	});

	it("rejects an existing target on disk that the index does not hold", () => {
		const w = world();
		const ghost = path.join(w.agentDir, "skills", "ghost");
		mkdirSync(ghost);
		const failure = failureOf(createSkill(portsFor(w), "ghost", CONTENT));
		expect(failure.code).toBe("TARGET_EXISTS");
		expect(failure.evidence).toEqual({
			kind: "conflict",
			target: { kind: "path", path: ghost },
		});
	});

	it("rejects a name outside the skill-name grammar", () => {
		const w = world();
		const failure = failureOf(createSkill(portsFor(w), "Bad_Name", "x"));
		expect(failure.code).toBe("ID_NAME_INVALID");
		expect(failure.evidence).toEqual({ kind: "input", input: "Bad_Name" });
	});

	it("creates a related file under an existing skill, making its directory", () => {
		const w = world();
		expect(createSkill(portsFor(w), "alpha", CONTENT).ok).toBe(true);
		const result = createSkill(
			portsFor(w),
			"alpha/references/notes.md",
			"# Notes\n",
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.path).toBe(
			path.join(w.agentDir, "skills", "alpha", "references", "notes.md"),
		);
		expect(readFileSync(result.path, "utf8")).toBe("# Notes\n");
	});

	it("reports a related file whose skill is absent", () => {
		const w = world();
		const failure = failureOf(
			createSkill(portsFor(w), "absent/references/notes.md", "x"),
		);
		expect(failure.code).toBe("ID_NOT_FOUND");
	});

	it("rejects a related file that already exists", () => {
		const w = world();
		expect(createSkill(portsFor(w), "alpha", CONTENT).ok).toBe(true);
		const references = path.join(
			w.agentDir,
			"skills",
			"alpha",
			"references",
		);
		mkdirSync(references);
		writeFileSync(path.join(references, "notes.md"), "# Old\n");
		const failure = failureOf(
			createSkill(portsFor(w), "alpha/references/notes.md", "# New\n"),
		);
		expect(failure.code).toBe("TARGET_EXISTS");
		expect(failure.evidence).toEqual({
			kind: "conflict",
			target: {
				kind: "path",
				path: path.join(
					w.agentDir,
					"skills",
					"alpha",
					"references",
					"notes.md",
				),
			},
		});
	});

	it("rejects a related-file reference that escapes the skill directory", () => {
		const w = world();
		expect(createSkill(portsFor(w), "alpha", CONTENT).ok).toBe(true);
		const failure = failureOf(
			createSkill(portsFor(w), "alpha/../escape.md", "x"),
		);
		expect(failure.code).toBe("REF_PATH_INVALID");
	});

	it("reports a write failure with the target and the underlying error", () => {
		const w = world();
		const fileAsRoot = path.join(w.agentDir, "not-a-dir");
		writeFileSync(fileAsRoot, "x");
		const index: Index = {
			locations: [{ id: "broken", path: fileAsRoot, writable: true }],
			entries: [],
		};
		const failure = failureOf(
			createSkill(
				{
					index,
					defaultLocation: "broken",
					resolveRef: (baseDir, refPath) => resolveSkillFile(baseDir, refPath),
				},
				"alpha",
				"x",
			),
		);
		expect(failure.code).toBe("WRITE_FAILED");
		expect(failure.evidence.kind).toBe("pathError");
		if (failure.evidence.kind !== "pathError") return;
		expect(failure.evidence.path).toBe(
			path.join(fileAsRoot, "alpha", "SKILL.md"),
		);
		expect(failure.evidence.error.length).toBeGreaterThan(0);
	});
});
