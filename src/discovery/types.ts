/**
 * Discovery's value shapes: what a location is, what an indexed skill is, and
 * what the index as a whole exposes.
 *
 * The location set is open: the four built-in paths plus whatever
 * `skills.registry.paths` registers. A location is validated against the
 * index, never against a closed union, so `SkillStorage` names the concept
 * without enumerating its members.
 */

/** A location identifier; the set is open and validated against the index. */
export type SkillStorage = string;

/**
 * One registered discovery location: the directories it scans, in order.
 *
 * `layout` tells the scanner what a root holds: a direct root lists skills
 * itself, while a unit root's entries are packages that list skills inside.
 * A disabled location stays registered, so an ID naming it can report that
 * the location exists and is turned off; it holds no scanned skills.
 */
export interface RegistryLocation {
	readonly id: SkillStorage;
	readonly roots?: readonly string[];
	readonly writable: boolean;
	readonly layout?: "direct" | "units";
	readonly disabled?: boolean;
}

/** One skill the index knows: its address, its main document, its metadata. */
export interface RegistryEntry {
	readonly location: SkillStorage;
	readonly name: string;
	readonly id: string;
	readonly filePath: string;
	readonly baseDir: string;
	readonly frontmatter: Record<string, unknown>;
}

/** The index: the locations that exist, and the skills they hold. */
export interface Index {
	readonly locations: readonly RegistryLocation[];
	readonly entries: readonly RegistryEntry[];
}

/** Why a configured discovery path could not become a location. */
export type LocationIssueReason = "reserved" | "invalid";

/** A configured path that was dropped, with the one rule that dropped it. */
export interface LocationIssue {
	readonly id: string;
	readonly reason: LocationIssueReason;
}

/** The registered locations, plus the configured paths that were dropped. */
export interface ResolvedLocations {
	readonly locations: readonly RegistryLocation[];
	readonly issues: readonly LocationIssue[];
}

/** The registry settings discovery reads, as configuration states them. */
export interface DiscoveryConfig {
	readonly disable?: readonly string[];
	readonly paths?: Readonly<
		Record<string, { readonly writable: boolean; readonly path: string }>
	>;
}

/** Everything `buildIndex` needs from the caller. */
export interface IndexInput {
	readonly agentDir: string;
	readonly cwd: string;
	readonly registry?: DiscoveryConfig;
}
