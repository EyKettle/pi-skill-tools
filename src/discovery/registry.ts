/**
 * The skill index: every skill reachable through a registered discovery path.
 *
 * The index scans the paths it owns and takes the skills Pi discovered for the
 * locations that inherit Pi's mechanism (`package`, `temp`). It does not use
 * Pi's skill index as a location authority and it is not an exhaustive disk
 * walk: one directory level per location, `SKILL.md` present, name addressable.
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
	InheritedSkill,
	LocationIssue,
	RegistryEntry,
	RegistryLocation,
	ResolvedLocations,
	SkillStorage,
} from "./types";


/**
 * Build the index from the resolved registry settings and the skills Pi
 * discovered for the inherited locations.
 */
export function buildIndex(input: IndexInput): Index {
	const { locations } = resolveLocations(input);
	const inherited = input.inherited ?? {};
	const entries: RegistryEntry[] = [];

	for (const location of locations) {
		if (location.path !== undefined) {
			entries.push(...scan(location, location.path));
		}
	}
	entries.push(...inheritedEntries(locations, "package", inherited.package));
	entries.push(...inheritedEntries(locations, "temp", inherited.temp));

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
			path: path.join(input.agentDir, "skills"),
			writable: true,
		},
		{
			id: "project",
			path: path.join(input.cwd, ".pi", "skills"),
			writable: true,
		},
		// These two inherit Pi's discovery mechanism: no directory of ours.
		{ id: "package", writable: false },
		{ id: "temp", writable: false },
	];
	// A configured path never redefines a built-in id, disabled or not.
	const reserved = new Set(declared.map((location) => location.id));
	const builtins = declared.filter((location) => !disabled.has(location.id));

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
		if (disabled.has(id)) {
			continue;
		}
		extras.push({ id, path: entry.path, writable: entry.writable });
	}

	return {
		locations: [...builtins, ...sortById(extras)],
		issues: sortById(issues),
	};
}

function sortById<T extends { readonly id: string }>(items: T[]): T[] {
	return items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ---------------------------------------------------------------------------
// scanning

/** One level of a location: each addressable directory with a `SKILL.md`. */
function scan(
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
		const name = dirent.name;
		if (!isSkillName(name)) {
			continue;
		}
		const baseDir = path.join(root, name);
		const filePath = path.join(baseDir, "SKILL.md");
		if (!isFile(filePath)) {
			continue;
		}
		entries.push({
			location: location.id,
			name,
			id: formatSkillId(location.id, name),
			filePath,
			baseDir,
			frontmatter: readFrontmatter(filePath),
		});
	}
	return entries;
}

function inheritedEntries(
	locations: readonly RegistryLocation[],
	location: SkillStorage,
	skills: readonly InheritedSkill[] | undefined,
): RegistryEntry[] {
	if (
		skills === undefined ||
		!locations.some((registered) => registered.id === location)
	) {
		return [];
	}
	return skills
		.filter((skill) => isSkillName(skill.name))
		.map((skill) => ({
			location,
			name: skill.name,
			id: formatSkillId(location, skill.name),
			filePath: skill.filePath,
			baseDir: skill.baseDir,
			frontmatter: readFrontmatter(skill.filePath),
		}));
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
