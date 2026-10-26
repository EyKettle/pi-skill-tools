/**
 * The skill index: every skill reachable through a registered discovery path.
 *
 * The index scans every root of every enabled location. It does not use Pi's
 * skill index as a location authority and it is not an exhaustive disk walk:
 * one directory level per root, `SKILL.md` present, name addressable.
 * A bad directory, an unreadable file, or a malformed block degrades to a
 * skipped skill or empty frontmatter — building the index never throws.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { getByPath, parseFrontmatterBlock } from "./frontmatter";
import { formatSkillId, isSkillName } from "./skill-id";
import type {
	Index,
	IndexInput,
	LocationIssue,
	RegistryEntry,
	RegistryLocation,
	ResolvedLocations,
} from "./types";


/** Build the index from the resolved registry settings. */
export function buildIndex(input: IndexInput): Index {
	const { locations } = resolveLocations(input);
	const entries: RegistryEntry[] = [];
	// One location scans several roots; the first root holding a name wins.
	const seen = new Set<string>();

	for (const location of locations) {
		if (location.disabled === true) {
			continue;
		}
		for (const root of location.roots ?? []) {
			for (const entry of scan(location, root)) {
				if (seen.has(entry.id)) {
					continue;
				}
				seen.add(entry.id);
				entries.push(entry);
			}
		}
	}

	entries.sort(compareByLocation(locations));
	return { locations, entries };
}

/**
 * Aggregate IDs by `metadata.tags`, the one supported tag source. IDs are
 * deduplicated and sorted per tag; tags are sorted, so two builds of the same
 * tree read the same list.
 */
export function collectTags(
	entries: readonly RegistryEntry[],
): Map<string, string[]> {
	const byTag = new Map<string, Set<string>>();
	for (const entry of entries) {
		const tags = getByPath(entry.frontmatter, "metadata.tags");
		if (!Array.isArray(tags)) {
			continue;
		}
		for (const raw of tags) {
			if (
				typeof raw !== "string" &&
				typeof raw !== "number" &&
				typeof raw !== "boolean"
			) {
				continue;
			}
			const tag = String(raw);
			if (tag.length === 0) {
				continue;
			}
			const ids = byTag.get(tag);
			if (ids === undefined) {
				byTag.set(tag, new Set([entry.id]));
			} else {
				ids.add(entry.id);
			}
		}
	}
	return new Map(
		Array.from(byTag.entries())
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([tag, ids]) => [tag, Array.from(ids).sort()]),
	);
}

// ---------------------------------------------------------------------------
// locations

/**
 * The built-in four plus the configured paths, with every dropped configured
 * path reported once. Rejecting a path is decided here alone: the caller
 * surfaces the issues, it does not re-derive them.
 */
export function resolveLocations(input: IndexInput): ResolvedLocations {
	const config = input.registry ?? {};
	const disabled = new Set(config.disable ?? []);

	const declared: RegistryLocation[] = [
		{
			id: "global",
			roots: [path.join(input.agentDir, "skills")],
			writable: true,
			layout: "direct",
		},
		{
			id: "project",
			roots: [path.join(input.cwd, ".pi", "skills")],
			writable: true,
			layout: "direct",
		},
		{
			id: "package",
			roots: [
				path.join(input.agentDir, "npm", "node_modules"),
				path.join(input.cwd, ".pi", "npm", "node_modules"),
			],
			writable: false,
			layout: "units",
		},
		{
			id: "temp",
			roots: [path.join(input.agentDir, "extensions")],
			writable: false,
			layout: "units",
		},
	];
	// A configured path never redefines a built-in id, disabled or not.
	const reserved = new Set(declared.map((location) => location.id));

	const issues: LocationIssue[] = [];
	const extras: RegistryLocation[] = [];
	for (const [id, entry] of Object.entries(config.paths ?? {})) {
		if (!isSkillName(id)) {
			issues.push({ id, reason: "invalid" });
			continue;
		}
		if (reserved.has(id)) {
			issues.push({ id, reason: "reserved" });
			continue;
		}
		extras.push({ id, roots: [entry.path], writable: entry.writable, layout: "direct" });
	}

	const locations = [...declared, ...sortById(extras)].map((location) =>
		disabled.has(location.id) ? { ...location, disabled: true } : location,
	);

	return { locations, issues: sortById(issues) };
}

function sortById<T extends { readonly id: string }>(items: T[]): T[] {
	return items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ---------------------------------------------------------------------------
// scanning

/** The skills a root holds, by the shape the location's layout declares. */
function scan(
	location: RegistryLocation,
	root: string,
): RegistryEntry[] {
	return location.layout === "units"
		? scanUnits(location, root)
		: scanDirect(location, root, true);
}

/**
 * A direct root lists skills itself: `<name>/SKILL.md` or, when the single
 * file is asked for, `<name>.md`. The single-file form's base directory is
 * the root, so its related files are the root's — which is what
 * `list_skill_files` turns into the warning.
 */
function scanDirect(
	location: RegistryLocation,
	root: string,
	singleFile: boolean,
): RegistryEntry[] {
	let dirents;
	try {
		dirents = readdirSync(root, { withFileTypes: true });
	} catch {
		return []; // a missing or unreadable location holds nothing
	}

	const entries: RegistryEntry[] = [];
	for (const dirent of dirents) {
		const name = dirent.name;
		if (singleFile && name.endsWith(".md") && isFile(path.join(root, name))) {
			const skill = name.slice(0, -3);
			if (isSkillName(skill)) {
				entries.push(entryAt(location, skill, path.join(root, name), root));
			}
			continue;
		}
		if (
			(dirent.isDirectory() || dirent.isSymbolicLink()) &&
			isSkillName(name) &&
			isFile(path.join(root, name, "SKILL.md"))
		) {
			entries.push(
				entryAt(location, name, path.join(root, name, "SKILL.md"), path.join(root, name)),
			);
		}
	}
	return entries;
}

/**
 * A unit root holds packages. A package's own name is any directory name; the
 * skills inside it are what the index addresses.
 */
function scanUnits(
	location: RegistryLocation,
	root: string,
): RegistryEntry[] {
	let dirents;
	try {
		dirents = readdirSync(root, { withFileTypes: true });
	} catch {
		return []; // a missing or unreadable location holds nothing
	}

	const entries: RegistryEntry[] = [];
	for (const dirent of dirents) {
		if (!dirent.isDirectory() && !dirent.isSymbolicLink()) {
			continue;
		}
		entries.push(...scanUnitSkills(location, path.join(root, dirent.name)));
	}
	return entries;
}

/**
 * The skill shapes one package can hold: `<unit>/<name>/SKILL.md`, then
 * `<unit>/skills/<name>/SKILL.md` and `<unit>/skills/<name>.md`.
 */
function scanUnitSkills(
	location: RegistryLocation,
	unit: string,
): RegistryEntry[] {
	return [
		...scanDirect(location, unit, false),
		...scanDirect(location, path.join(unit, "skills"), true),
	];
}

/** One indexed skill: its main document and the directory that holds it. */
function entryAt(
	location: RegistryLocation,
	name: string,
	filePath: string,
	baseDir: string,
): RegistryEntry {
	return {
		location: location.id,
		name,
		id: formatSkillId(location.id, name),
		filePath,
		baseDir,
		frontmatter: readFrontmatter(filePath),
	};
}

/** Fail-closed read: an unreadable or malformed document has no frontmatter. */
function readFrontmatter(filePath: string): Record<string, unknown> {
	try {
		return parseFrontmatterBlock(readFileSync(filePath, "utf8")).data;
	} catch {
		return {};
	}
}

function isFile(filePath: string): boolean {
	try {
		return statSync(filePath).isFile();
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------
// ordering

/** Location order is the registered order; within a location, the name. */
function compareByLocation(
	locations: readonly RegistryLocation[],
): (a: RegistryEntry, b: RegistryEntry) => number {
	const rank = new Map(
		locations.map((location, index) => [location.id, index]),
	);
	return (a, b) =>
		(rank.get(a.location) ?? rank.size) - (rank.get(b.location) ?? rank.size) ||
		a.name.localeCompare(b.name) ||
		a.filePath.localeCompare(b.filePath);
}
