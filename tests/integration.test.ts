/**
 * Task 11 integration suite (plan Task 11, design.md §5) — the declared
 * coverage for index.ts's controller behavior, driven through the PURE
 * pipeline. index.ts itself is not unit-testable under vitest (pi/typebox
 * imports resolve only inside the pi runtime), so this file replicates its
 * controller wiring — `registryDeps(ctx)` (index.ts:194-210) — against a REAL
 * tree of skill files on disk: `buildRegistry` with a `scanDir` that truly
 * reads directories (a mini-reimplementation of pi's rule: a directory
 * containing `SKILL.md` is a skill root) and `readFrontmatter` mirroring
 * `parseFrontmatterBlock(readFileSync(...)).data`, then the input slices and
 * output builders of every tool. All fs access is real (mkdtempSync/set,
 * readFileSync); nothing is mocked.
 */
import { afterAll, describe, expect, it } from "vitest";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	matchedValues,
	matchesFrontmatter,
	parseFrontmatterBlock,
} from "../frontmatter";
import { buildRegistry, collectTags } from "../registry";
import type { PiSkill, RegistryDeps } from "../registry";
import { parseSkillId, resolveSkillId } from "../skill-id";
import { readSkillFile, resolveSkillFile } from "../skill-file";
import { wrapSkillBlock } from "../tools/view-skill";
import { wrapSkillPeekBlock } from "../tools/peek-skill";
import { extractSection } from "../skill-section";
import { listSkillFiles } from "../skill-files";
import { createSkill } from "../skill-create";
import type { CreateSkillDeps } from "../skill-create";
import { buildListOutput } from "../tools/list-skills";
import { buildTagsOutput } from "../tools/list-skill-tags";
import { buildSearchOutput } from "../tools/search-skills";
import { buildFilesOutput } from "../tools/list-skill-files";

// ---------------------------------------------------------------------------
// temp-tree plumbing (mkdtempSync, rmSync in afterAll — real files, no mocks)
// ---------------------------------------------------------------------------

const tmpDirs: string[] = [];

function makeTempDir(prefix = "skill-tools-integration-"): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tmpDirs.push(dir);
	return dir;
}

afterAll(() => {
	for (const dir of tmpDirs) {
		rmSync(dir, { recursive: true, force: true });
	}
});

/** A directory containing SKILL.md is a skill root (pi's loadSkillsFromDir rule,
 * mini-reimplementation for the shadow scan). */
function scanSkillFromDir(dir: string): PiSkill[] {
	let names;
	try {
		names = readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	const found: PiSkill[] = [];
	for (const dirent of names) {
		if (!dirent.isDirectory()) continue;
		const skillDir = join(dir, dirent.name);
		const skillFile = join(skillDir, "SKILL.md");
		if (!existsSync(skillFile)) continue;
		found.push({
			name: dirent.name,
			description: "",
			filePath: skillFile,
			baseDir: skillDir,
			sourceInfo: { scope: "user", origin: "top-level" },
		});
	}
	return found;
}

/** index.ts:202-203 readFrontmatter wiring: real fs read + parseFrontmatterBlock. */
function readFrontmatterFromDisk(filePath: string): Record<string, unknown> {
	return parseFrontmatterBlock(readFileSync(filePath, "utf8")).data;
}

const REF_GUIDE_MD = [
	"# Git Utils Guide",
	"",
	"Reference target used by the list_skill_files round-trip.",
	"Each line stays byte-stable so the resolved-path reads match the disk.",
	"",
].join("\n");

const GLOBAL_GIT_UTILS_MD = [
	"---",
	"name: git-utils",
	"description: Global git utils skill with reference files",
	"---",
	"# Git Utils",
	"",
	"## When to Use",
	"",
	"Reference-backed reads.",
	"",
].join("\n");

const PROJECT_GIT_UTILS_MD = [
	"---",
	"name: git-utils",
	"description: Project copy shadowed by the global winner",
	"---",
	"# Git Utils (project copy)",
	"",
].join("\n");

const PKGUTIL_MD = [
	"---",
	"name: pkgutil",
	"description: Skill shipped inside a package's skills directory",
	"---",
	"# Package Util",
	"",
].join("\n");

/** Tagged skill whose body exceeds pi's collapsed read cap (2000 lines / 50KB). */
function taggedSkillMd(): string {
	const frontmatter = [
		"---",
		"name: tagged-tools",
		"description: Integration skill carrying metadata.tags",
		"metadata:",
		"  tags:",
		"    - networking",
		"    - tui",
		"---",
	];
	const body: string[] = [];
	for (let i = 0; i < 2200; i++) {
		body.push(
			`Section ${i}: filler that forces the no-truncation guarantee to be exercised on a file pi itself would cap.`,
		);
	}
	return `${frontmatter.join("\n")}\n${body.join("\n")}\n`;
}

interface IntegrationTree {
	agentDir: string;
	cwd: string;
	homeDir: string;
	configDirName: string;
	activeSkills: PiSkill[];
	paths: {
		globalGitUtils: string;
		globalTagged: string;
		projectGitUtils: string;
		packagePkgutil: string;
		refGuide: string;
	};
}

/**
 * Build the Task 11 tree: a global root (agentDir/skills) with two skills —
 * `git-utils` (reference files) and `tagged-tools` (metadata.tags, body over
 * pi's read cap); a project root (cwd/.pi/skills) holding `git-utils`, whose
 * name collides with the global one; and a package root (pkg/skills) holding
 * the active `pkgutil` skill.
 */
function buildSkillTree(dir: string): IntegrationTree {
	const agentDir = join(dir, "agent");
	const globalSkills = join(agentDir, "skills");

	const gitUtilsDir = join(globalSkills, "git-utils");
	const gitUtilsRefDir = join(gitUtilsDir, "references");
	mkdirSync(gitUtilsRefDir, { recursive: true });
	const globalGitUtils = join(gitUtilsDir, "SKILL.md");
	writeFileSync(globalGitUtils, GLOBAL_GIT_UTILS_MD);
	const refGuide = join(gitUtilsRefDir, "GUIDE.md");
	writeFileSync(refGuide, REF_GUIDE_MD);

	const taggedDir = join(globalSkills, "tagged-tools");
	mkdirSync(taggedDir, { recursive: true });
	const globalTagged = join(taggedDir, "SKILL.md");
	writeFileSync(globalTagged, taggedSkillMd());

	const cwd = join(dir, "proj");
	const projectSkills = join(cwd, ".pi", "skills");
	const projectGitUtils = join(projectSkills, "git-utils", "SKILL.md");
	mkdirSync(join(projectSkills, "git-utils"), { recursive: true });
	writeFileSync(projectGitUtils, PROJECT_GIT_UTILS_MD);

	const packageSkills = join(dir, "pkg", "skills");
	const packagePkgutil = join(packageSkills, "pkgutil", "SKILL.md");
	mkdirSync(join(packageSkills, "pkgutil"), { recursive: true });
	writeFileSync(packagePkgutil, PKGUTIL_MD);

	const homeDir = join(dir, "home");
	mkdirSync(homeDir, { recursive: true });

	const activeSkills: PiSkill[] = [
		{
			name: "git-utils",
			description: "Global git utils skill with reference files",
			filePath: globalGitUtils,
			baseDir: gitUtilsDir,
			sourceInfo: { scope: "user", origin: "top-level" },
		},
		{
			name: "tagged-tools",
			description: "Integration skill carrying metadata.tags",
			filePath: globalTagged,
			baseDir: taggedDir,
			sourceInfo: { scope: "user", origin: "top-level" },
		},
		{
			name: "pkgutil",
			description: "Skill shipped inside a package's skills directory",
			filePath: packagePkgutil,
			baseDir: join(packageSkills, "pkgutil"),
			sourceInfo: { scope: "user", origin: "package" },
		},
	];

	return {
		agentDir,
		cwd,
		homeDir,
		configDirName: ".pi",
		activeSkills,
		paths: {
			globalGitUtils,
			globalTagged,
			projectGitUtils,
			packagePkgutil,
			refGuide,
		},
	};
}

/** RegistryDeps mirroring index.ts's registryDeps(ctx). */
function registryDepsOf(tree: IntegrationTree): RegistryDeps {
	return {
		activeSkills: tree.activeSkills,
		scanDir: scanSkillFromDir,
		readFrontmatter: readFrontmatterFromDisk,
		agentDir: tree.agentDir,
		configDirName: tree.configDirName,
		cwd: tree.cwd,
		homeDir: tree.homeDir,
		isProjectTrusted: () => true,
	};
}

function makeCreateDeps(tree: IntegrationTree): CreateSkillDeps {
	return {
		registry: buildRegistry(registryDepsOf(tree)),
		agentDir: tree.agentDir,
		configDirName: tree.configDirName,
		cwd: tree.cwd,
	};
}

// ---------------------------------------------------------------------------
// the tools' read pipeline, driven end-to-end over the real tree
// ---------------------------------------------------------------------------

describe("integration: skill tools pipeline over a real skills tree", () => {
	const tree = buildSkillTree(makeTempDir());

	it("builds the index from real disk with all three storages and the shadow collision", () => {
		const registry = buildRegistry(registryDepsOf(tree));

		expect(registry.indexEmpty).toBe(false);
		expect(registry.entries.map((e) => e.id)).toEqual([
			"global:git-utils",
			"global:tagged-tools",
			"project:git-utils",
			"package:pkgutil",
		]);

		const shadowed = registry.entries.find((e) => e.id === "project:git-utils");
		expect(shadowed?.state).toBe("shadowed");
		expect(shadowed?.shadowedBy).toBe("global:git-utils");
		expect(shadowed?.filePath).toBe(tree.paths.projectGitUtils);
		// the shadowed copy really came off disk, not from the active list
		expect(existsSync(shadowed?.filePath ?? "")).toBe(true);

		// list_skills view-scope filter
		expect(registry.filter("global").map((e) => e.id)).toEqual([
			"global:git-utils",
			"global:tagged-tools",
		]);
		expect(registry.filter("project").map((e) => e.id)).toEqual([
			"project:git-utils",
		]);
	});

	it("lists all three location markers: conflicted names keep prefixed ids, others stay bare", () => {
		const registry = buildRegistry(registryDepsOf(tree));

		expect(registry.conflicts).toEqual([
			{
				name: "git-utils",
				participants: ["global:git-utils", "project:git-utils"],
			},
		]);
		const text = buildListOutput(registry.filter(undefined), {
			conflicts: registry.conflicts,
		});
		// git-utils is conflicted (global + project copies present), so both
		// rows disambiguate with the prefixed id; the other skills stay bare.
		expect(text).toContain(
			`- global:git-utils [active] ${tree.paths.globalGitUtils}`,
		);
		expect(text).toContain(
			`- project:git-utils [shadowed] ${tree.paths.projectGitUtils}`,
		);
		expect(text).toContain(
			`- tagged-tools [active] ${tree.paths.globalTagged}`,
		);
		expect(text).toContain(`- pkgutil [active] ${tree.paths.packagePkgutil}`);
		// output is the list rows only: no conflicts: block, no count line
		expect(text).not.toContain("conflicts:");
		expect(text).not.toMatch(/\d+ skills?$/);
		expect(text.split("\n")).toHaveLength(4);
	});

	it("tag listing and search find only the metadata.tags skill", () => {
		const registry = buildRegistry(registryDepsOf(tree));

		const byTag = collectTags(registry.filter(undefined));
		const tagsText = buildTagsOutput(byTag);
		expect(tagsText).toBe("networking, tui");
		expect(tagsText).not.toContain("git-utils");
		expect(tagsText).not.toContain("pkgutil");

		// search_skills with a metadata.tags filter (array doc value vs scalar filter)
		const filter = { "metadata.tags": ["networking"] };
		const matches = registry
			.filter(undefined)
			.filter((entry) => matchesFrontmatter(entry.frontmatter, filter));
		expect(matches).toHaveLength(1);
		expect(matches[0].id).toBe("global:tagged-tools");
		// controller row wiring (index.ts): name plus per-key matchedValues rows
		const rows = matches.map((m) => ({
			id: m.id,
			filePath: m.filePath,
			name: m.name,
			matchedKeys: Object.entries(filter)
				.map(([key, filterValue]) => ({
					key,
					values: matchedValues(m.frontmatter, key, filterValue),
				}))
				.filter(({ values }) => values.length > 0),
		}));
		const searchText = buildSearchOutput(rows, {
			conflicts: registry.conflicts,
		});
		// headerless entry: bare name (git-utils is the only conflicted name,
		// so tagged-tools stays unprefixed) with the tags value rendered and
		// the matched item asterisk-wrapped
		expect(searchText).toBe(
			`tagged-tools ${tree.paths.globalTagged}\nmetadata.tags: *networking*, tui`,
		);
		expect(searchText).not.toContain("- ");
		expect(searchText).not.toContain("global:tagged-tools");
	});

	it("readSkillFile returns byte-identical content to disk even beyond pi's collapsed read cap", () => {
		const registry = buildRegistry(registryDepsOf(tree));

		// exact controller chain: parseSkillId -> resolveSkillId -> entry ->
		// resolveSkillFile -> readSkillFile (index.ts:391-423)
		const parsedId = parseSkillId("global:tagged-tools");
		expect(parsedId.error).toBeUndefined();
		if (parsedId.error !== undefined) return;

		const resolved = resolveSkillId(
			registry.entries,
			parsedId.storage,
			parsedId.name,
		);
		expect(resolved.error).toBeUndefined();
		if (resolved.error !== undefined) return;

		const entry = registry.entries.find(
			(e) => e.storage === resolved.storage && e.name === resolved.name,
		);
		expect(entry).toBeDefined();
		if (entry === undefined) return;

		const resolvedFile = resolveSkillFile(entry.baseDir, parsedId.refPath);
		expect(resolvedFile.error).toBeUndefined();
		if (resolvedFile.error !== undefined) return;

		const read = readSkillFile(resolvedFile.path);
		expect(read.error).toBeUndefined();
		if (read.error !== undefined) return;

		const diskText = readFileSync(tree.paths.globalTagged, "utf8");
		expect(read.text).toBe(diskText); // byte-identical, nothing truncated
		expect(read.bytes).toBe(Buffer.byteLength(diskText, "utf8"));
		expect(read.lines).toBe(diskText.split("\n").length - 1);
		expect(read.lines).toBeGreaterThan(2000); // past pi's collapsed cap

		// model channel: the complete file wrapped in <SKILL name location>
		const content = wrapSkillBlock(entry.name, resolvedFile.path, read.text);
		expect(content).toContain('<SKILL name="');
		expect(content).toContain("</SKILL>");
		const inner = content
			.replace(/^<SKILL\b[^>]*>\n/, "")
			.replace(/\n<\/SKILL>$/, "");
		expect(inner).toBe(diskText); // full file, no truncation
	});

	it("peek_skill extracts ## When to Use from disk and wraps with <SKILL_PEEK>", () => {
		const registry = buildRegistry(registryDepsOf(tree));
		const entry = registry.entries.find(
			(e) => e.storage === "global" && e.name === "git-utils",
		);
		expect(entry).toBeDefined();
		if (entry === undefined) return;

		const resolvedFile = resolveSkillFile(entry.baseDir);
		expect(resolvedFile.error).toBeUndefined();
		if (resolvedFile.error !== undefined) return;

		const read = readSkillFile(resolvedFile.path);
		expect(read.error).toBeUndefined();
		if (read.error !== undefined) return;

		const section = extractSection(read.text, "When to Use");
		expect(section).toBeDefined();
		if (section === undefined) return;

		expect(section.content).toContain("## When to Use");
		expect(section.content).toContain("Reference-backed reads.");

		const content = wrapSkillPeekBlock(entry.name, resolvedFile.path, section.content);
		expect(content).toContain('<SKILL_PEEK name="git-utils" location="');
		expect(content).toContain("</SKILL_PEEK>");
		expect(content).toContain("Reference-backed reads.");
	});

	it("list_skill_files ids resolve through parseSkillId + resolveSkillFile to existing paths", () => {
		const registry = buildRegistry(registryDepsOf(tree));
		const entry = registry.entries.find(
			(e) => e.storage === "global" && e.name === "git-utils",
		);
		expect(entry).toBeDefined();
		if (entry === undefined) return;
		const baseDir = entry.baseDir;

		const listed = listSkillFiles("global", "git-utils", baseDir);
		expect(listed.error).toBeUndefined();
		if (listed.error !== undefined) return;

		expect(listed.entries).toHaveLength(1);
		const fileRow = listed.entries[0];
		expect(fileRow.refId).toBe("global:git-utils/references/GUIDE.md");

		// the file output the model sees
		const filesText = buildFilesOutput(listed.entries);
		expect(filesText).toContain(`- references/GUIDE.md ${fileRow.path}`);

		// the ref id must parse and resolve back to an EXISTING path on disk
		const parsed = parseSkillId(fileRow.refId);
		expect(parsed.error).toBeUndefined();
		if (parsed.error !== undefined) return;
		expect(parsed.storage).toBe("global");
		expect(parsed.name).toBe("git-utils");
		expect(parsed.refPath).toBe("references/GUIDE.md");

		const roundTrip = resolveSkillFile(baseDir, parsed.refPath);
		expect(roundTrip.error).toBeUndefined();
		if (roundTrip.error !== undefined) return;
		expect(existsSync(roundTrip.path)).toBe(true);
		// and the resolved file is the same content as listed (no divergence)
		expect(readFileSync(roundTrip.path, "utf8")).toBe(
			readFileSync(fileRow.path, "utf8"),
		);
	});
});

// ---------------------------------------------------------------------------
// create_skill integration: real writes into the same temp tree style
// ---------------------------------------------------------------------------

describe("create_skill integration over the real tree", () => {
	it("rejects a name that already exists, listing both prefixed ids", async () => {
		const tree = buildSkillTree(makeTempDir("skill-tools-create-"));
		const deps = makeCreateDeps(tree);

		const result = await createSkill(
			{
				name: "git-utils",
				content:
					"---\nname: git-utils\ndescription: duplicate name attempt\n---\n# Attempt\n",
			},
			deps,
		);
		if (result.error === undefined) {
			throw new Error("expected a rejection, got success");
		}
		expect(result.error).toContain("already exists");
		expect(result.error).toContain("global:git-utils");
		expect(result.error).toContain("project:git-utils");
		expect(result.error).toContain("use a different name");
	});

	it("writes a project skill on a populated registry", async () => {
		const tree = buildSkillTree(makeTempDir("skill-tools-create-"));
		const deps = makeCreateDeps(tree);

		const content = [
			"---",
			"name: fresh-skill",
			"description: Brand new",
			"---",
			"# Fresh Skill",
			"",
			"Body written verbatim; no skeleton generated.",
			"",
		].join("\n");
		const result = await createSkill(
			{ storage: "project", name: "fresh-skill", content },
			deps,
		);
		if (result.error !== undefined) {
			throw new Error(`expected success, got ${result.error}`);
		}
		const expectedPath = join(
			tree.cwd,
			".pi",
			"skills",
			"fresh-skill",
			"SKILL.md",
		);
		expect(result.path).toBe(expectedPath);
		expect(existsSync(expectedPath)).toBe(true);

		// the on-disk file is the supplied content byte-for-byte, and
		// result.content round-trips for rendering and line counting
		expect(readFileSync(expectedPath, "utf8")).toBe(content);
		expect(result.content).toBe(content);
	});

	it("rejects creation on an empty registry with the explicit R1-2 empty-index error", async () => {
		const emptyDir = makeTempDir("skill-tools-empty-index-");
		const configDirName = ".pi";
		const deps: RegistryDeps = {
			activeSkills: [],
			scanDir: scanSkillFromDir,
			readFrontmatter: readFrontmatterFromDisk,
			agentDir: emptyDir,
			configDirName,
			cwd: emptyDir,
			homeDir: emptyDir,
			isProjectTrusted: () => false,
		};
		const registry = buildRegistry(deps);
		expect(registry.indexEmpty).toBe(true);
		expect(registry.entries).toHaveLength(0);
		const result = await createSkill(
			{
				name: "anything",
				content: "---\nname: anything\n---\n# Anything\n",
			},
			{
				registry,
				agentDir: emptyDir,
				configDirName,
				cwd: emptyDir,
			},
		);
		if (result.error === undefined) {
			throw new Error("expected empty-index rejection, got success");
		}
		expect(result.error).toBe(
			"skill index is not yet populated; the before_agent_start cache has not captured any skills",
		);
		expect(existsSync(join(emptyDir, "skills", "anything"))).toBe(false);
	});
});
