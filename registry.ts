/**
 * The skill index: pi's loaded set plus per-location shadow discovery
 * (design.md §3). `buildRegistry` classifies each active skill into
 * `global` / `project` / `package`, derives the scan roots pi itself would
 * have visited, re-runs the injected `scanDir` (pi's `loadSkillsFromDir`) on
 * every root, and surfaces same-name duplicates as `shadowed` entries with
 * the winning active skill's prefixed id. The scan is neither a second
 * location authority nor an exhaustive disk walk: skills pi never loaded
 * (disabled by settings, missing description, ignore files, outside the
 * three managed locations) never appear here — the observed scope is exactly
 * "pi's loaded set, plus shadowed duplicates" (§3.3).
 *
 * `disableModelInvocation` skills stay in the index and are flagged
 * `hidden` — they remain invocable via `/skill:name`, so a management tool
 * must show them (§3.1). Frontmatter is attached entry-wise through the
 * injected `readFrontmatter` (§3.4), fail-closed like the sibling modules:
 * a throwing or non-record reader yields `{}`, a throwing `scanDir` yields
 * an empty scan, an unresolvable canonicalization falls back to the lexical
 * path. `buildRegistry` never throws; every failure inside is structured
 * data.
 */
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { getByPath } from "./frontmatter";
import { formatSkillId, SKILL_STORAGES } from "./skill-id";
import type { SkillStorage } from "./skill-id";

/**
 * Local structural mirror of pi's `Skill` (dist/core/skills.d.ts). Deliberately
 * NOT imported from the pi package: the registry must stay compilable without
 * a pi dependency (plan Task 7 Step 3).
 */
export interface PiSkill {
	name: string;
	description: string;
	filePath: string;
	baseDir: string;
	sourceInfo: { scope: string; origin: string };
	disableModelInvocation?: boolean;
}

/** Fully injectable registry inputs (design.md §2.1). */
export interface RegistryDeps {
	activeSkills: PiSkill[];
	scanDir: (dir: string) => PiSkill[];
	readFrontmatter: (filePath: string) => Record<string, unknown>;
	agentDir: string;
	configDirName: string;
	cwd: string;
	homeDir: string;
	isProjectTrusted: () => boolean;
	realpath?: (p: string) => string;
}

export type RegistryEntryState = "active" | "hidden" | "shadowed";

export interface RegistryEntry {
	storage: SkillStorage;
	name: string;
	id: string;
	state: RegistryEntryState;
	frontmatter: Record<string, unknown>;
	filePath: string;
	baseDir: string;
	description: string;
	shadowedBy?: string;
}

export interface RegistryConflict {
	name: string;
	participants: string[];
}

export interface Registry {
	entries: RegistryEntry[];
	conflicts: RegistryConflict[];
	indexEmpty: boolean;
	/** View-scope helper for the tools: `undefined` → all entries (§5.1-5.3). */
	filter(location?: SkillStorage): RegistryEntry[];
}

/**
 * Build the index. Active skills are classified into the three storages;
 * temporary-scope and otherwise-unclassifiable skills are dropped (§1.2,
 * §3.2). Scan roots follow pi's own locations: the two global roots, the
 * project root plus each existing `<ancestor>/.agents/skills` (walking up
 * from `cwd` to the git root, or the filesystem root) — the entire project
 * walk is skipped when `isProjectTrusted()` is false — and one root per
 * active package skill residing in `<pkg>/skills` (grandparent-guarded, so
 * package-manager resolution stays outsourced to pi, §3.3). Every scanned
 * filePath is canonicalized and matched against the active set by realpath:
 * a match is a symlinked duplicate and yields no shadow. Surviving scanned
 * entries whose name is not in the active set are dropped; the rest become
 * `shadowed` entries annotated with the winning active id.
 */
export function buildRegistry(deps: RegistryDeps): Registry {
	const canonical = deps.realpath ?? realpathSync;
	const entries: RegistryEntry[] = [];
	const activeByRealPath = new Set<string>();
	// pi's active set is name-unique (loadSkills collapses on collisions,
	// dist/core/skills.js:311); the first active entry with a name is the
	// win owner shadow-copies point at.
	const activeByName = new Map<string, RegistryEntry>();

	for (const skill of deps.activeSkills) {
		const storage = classify(skill);
		if (storage === undefined) {
			continue;
		}
		entries.push(activeEntry(storage, skill, deps));
		activeByRealPath.add(canonicalize(canonical, skill.filePath));
	}
	for (const entry of entries) {
		if (!activeByName.has(entry.name)) {
			activeByName.set(entry.name, entry);
		}
	}

	const scannedRealPaths = new Set<string>();
	for (const root of scanRoots(deps)) {
		let scanned: PiSkill[];
		try {
			scanned = deps.scanDir(root.dir);
		} catch {
			scanned = [];
		}
		for (const skill of scanned) {
			const realPath = canonicalize(canonical, skill.filePath);
			if (activeByRealPath.has(realPath) || scannedRealPaths.has(realPath)) {
				continue;
			}
			scannedRealPaths.add(realPath);
			const winner = activeByName.get(skill.name);
			if (winner === undefined) {
				continue; // drop rule §3.3
			}
			entries.push({
				storage: root.storage,
				name: skill.name,
				id: formatSkillId(root.storage, skill.name),
				state: "shadowed",
				frontmatter: readFrontmatterSafe(deps, skill.filePath),
				filePath: skill.filePath,
				baseDir: skill.baseDir,
				description: skill.description,
				shadowedBy: winner.id,
			});
		}
	}

	entries.sort(compareEntries);
	return {
		entries,
		conflicts: conflictsOf(entries),
		indexEmpty: entries.length === 0,
		filter(location) {
			return location === undefined
				? entries
				: entries.filter((e) => e.storage === location);
		},
	};
}

/**
 * Aggregate prefixed ids by `metadata.tags` for `list_skill_tags` (design.md
 * §5.2). Only `metadata.tags` is read — it is the single supported tag
 * source. A skill without an array under that path never appears; ids are
 * sorted per tag for stable output.
 */
export function collectTags(
	entries: ReadonlyArray<RegistryEntry>,
): Map<string, string[]> {
	const byTag = new Map<string, string[]>();
	for (const entry of entries) {
		const tags = getByPath(entry.frontmatter, "metadata.tags");
		if (!Array.isArray(tags)) {
			continue;
		}
		for (const raw of tags) {
			const tag = String(raw);
			if (tag.length === 0) {
				continue;
			}
			const list = byTag.get(tag);
			if (list === undefined) {
				byTag.set(tag, [entry.id]);
			} else {
				list.push(entry.id);
			}
		}
	}
	for (const list of byTag.values()) {
		list.sort();
	}
	return byTag;
}

// ---------------------------------------------------------------------------
// helpers

/** Location classification (§3.2): package wins regardless of scope. */
function classify(skill: PiSkill): SkillStorage | undefined {
	const { origin, scope } = skill.sourceInfo;
	if (origin === "package") {
		return "package";
	}
	if (scope === "temporary") {
		return undefined;
	}
	if (scope === "user" && origin === "top-level") {
		return "global";
	}
	if (scope === "project" && origin === "top-level") {
		return "project";
	}
	return undefined;
}

function activeEntry(
	storage: SkillStorage,
	skill: PiSkill,
	deps: RegistryDeps,
): RegistryEntry {
	return {
		storage,
		name: skill.name,
		id: formatSkillId(storage, skill.name),
		state: skill.disableModelInvocation === true ? "hidden" : "active",
		frontmatter: readFrontmatterSafe(deps, skill.filePath),
		filePath: skill.filePath,
		baseDir: skill.baseDir,
		description: skill.description,
	};
}

interface ScanRoot {
	storage: SkillStorage;
	dir: string;
}

function scanRoots(deps: RegistryDeps): ScanRoot[] {
	const roots: ScanRoot[] = [
		{ storage: "global", dir: path.join(deps.agentDir, "skills") },
		{ storage: "global", dir: path.join(deps.homeDir, ".agents", "skills") },
	];
	if (deps.isProjectTrusted()) {
		roots.push({
			storage: "project",
			dir: path.join(deps.cwd, deps.configDirName, "skills"),
		});
		roots.push(...ancestorAgentsSkillRoots(deps.cwd));
	}
	roots.push(...packageRoots(deps.activeSkills));
	return roots;
}

/**
 * Each existing `<ancestor>/.agents/skills`, walking from `cwd` upward and
 * stopping at the git repo root (a directory containing `.git`) or the
 * filesystem root (design.md §3.3).
 */
function ancestorAgentsSkillRoots(cwd: string): ScanRoot[] {
	const roots: ScanRoot[] = [];
	let dir = cwd;
	for (;;) {
		const candidate = path.join(dir, ".agents", "skills");
		if (existsSync(candidate)) {
			roots.push({ storage: "project", dir: candidate });
		}
		if (existsSync(path.join(dir, ".git"))) {
			break;
		}
		const parent = path.dirname(dir);
		if (parent === dir) {
			break;
		}
		dir = parent;
	}
	return roots;
}

/**
 * Leaves only package roots with the name against the active package skills
 * — `<pkg>/skills/<name>/SKILL.md` → `<pkg>/skills`. The basename guard
 * rejects look-alike layouts so package-manager resolution stays pi's job
 * (design.md §3.3).
 */
function packageRoots(activeSkills: PiSkill[]): ScanRoot[] {
	const roots: ScanRoot[] = [];
	const seen = new Set<string>();
	for (const skill of activeSkills) {
		if (skill.sourceInfo.origin !== "package") {
			continue;
		}
		const root = path.dirname(path.dirname(skill.filePath));
		if (path.basename(root) !== "skills" || seen.has(root)) {
			continue;
		}
		seen.add(root);
		roots.push({ storage: "package", dir: root });
	}
	return roots;
}

/** Fail-closed frontmatter read (design.md §3.4): `{}` on any failure. */
function readFrontmatterSafe(
	deps: RegistryDeps,
	filePath: string,
): Record<string, unknown> {
	try {
		const data = deps.readFrontmatter(filePath);
		return isRecord(data) ? data : {};
	} catch {
		return {};
	}
}

/** Scan dedup matcher: canonical path, lexical path only as a last resort. */
function canonicalize(
	realpath: (p: string) => string,
	filePath: string,
): string {
	try {
		return realpath(filePath);
	} catch {
		return filePath;
	}
}

function conflictsOf(entries: RegistryEntry[]): RegistryConflict[] {
	const byName = new Map<string, string[]>();
	for (const entry of entries) {
		const ids = byName.get(entry.name);
		if (ids === undefined) {
			byName.set(entry.name, [entry.id]);
		} else {
			ids.push(entry.id);
		}
	}
	const conflicts: RegistryConflict[] = [];
	for (const [name, ids] of byName) {
		if (ids.length < 2) {
			continue;
		}
		conflicts.push({ name, participants: [...ids].sort() });
	}
	conflicts.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
	return conflicts;
}

/** Stable presentation order: global, project, package, then name, path. */
function compareEntries(a: RegistryEntry, b: RegistryEntry): number {
	const rank = storageRank(a.storage) - storageRank(b.storage);
	if (rank !== 0) {
		return rank;
	}
	if (a.name !== b.name) {
		return a.name < b.name ? -1 : 1;
	}
	if (a.filePath !== b.filePath) {
		return a.filePath < b.filePath ? -1 : 1;
	}
	return 0;
}

function storageRank(storage: SkillStorage): number {
	return SKILL_STORAGES.indexOf(storage);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
