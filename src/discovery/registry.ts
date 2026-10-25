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
		},
		{
			id: "project",
			roots: [path.join(input.cwd, ".pi", "skills")],
			writable: true,
		},
		{
			id: "package",
			roots: [
				path.join(input.agentDir, "npm", "node_modules"),
				path.join(input.cwd, ".pi", "npm", "node_modules"),
			],
			writable: false,
		},
		{
			id: "temp",
			roots: [path.join(input.agentDir, "extensions")],
			writable: false,
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
		extras.push({ id, roots: [entry.path], writable: entry.writable });
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
