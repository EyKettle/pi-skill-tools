/**
 * The plugin's configuration, read from the host's own settings files.
 *
 * Two files contribute — the agent-wide one and the project one — and the
 * project file wins where both state the same key. A missing file, a missing
 * key, or a value of the wrong type takes the default: a typo in a settings
 * file must not stop the extension from loading.
 *
 * This module reads files and nothing else, so it is testable without a host.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { isRecord } from "../shared/predicates";

/** A discovery location registered through `skills.registry.paths`. */
export interface ConfiguredPath {
	readonly writable: boolean;
	readonly path: string;
}

export interface ResolvedConfig {
	/** Whether the commit log records changes. */
	readonly historyEnabled: boolean;
	/** Locations turned off by `skills.registry.disable`. */
	readonly disable: readonly string[];
	/** The location a bare id is created at. */
	readonly defaultLocation: string;
	/** Extra discovery locations, in configuration order. */
	readonly paths: Readonly<Record<string, ConfiguredPath>>;
}

export interface SettingsInput {
	readonly agentDir: string;
	readonly cwd: string;
	/** The project's configuration directory name, such as `.pi`. */
	readonly configDirName: string;
}

const DEFAULTS: ResolvedConfig = {
	historyEnabled: true,
	disable: [],
	defaultLocation: "global",
	paths: {},
};

/** The plugin's configuration, merged across the two settings files. */
export function resolveConfig(input: SettingsInput): ResolvedConfig {
	const global = readSettings(path.join(input.agentDir, "settings.json"));
	const project = readSettings(
		path.join(input.cwd, input.configDirName, "settings.json"),
	);
	const history = {
		...historySection(global),
		...historySection(project),
	};
	const registry = {
		...registrySection(global),
		...registrySection(project),
	};

	return {
		historyEnabled:
			typeof history.enabled === "boolean" ? history.enabled : DEFAULTS.historyEnabled,
		disable: stringArray(registry.disable) ? registry.disable : DEFAULTS.disable,
		defaultLocation:
			typeof registry.default === "string" && registry.default.length > 0
				? registry.default
				: DEFAULTS.defaultLocation,
		paths: configuredPaths(registry.paths),
	};
}

/** One settings file's parsed content; `{}` when it is absent or unusable. */
export function readSettings(file: string): Record<string, unknown> {
	let raw: string;
	try {
		raw = readFileSync(file, "utf8");
	} catch {
		return {};
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return {};
	}
	return isRecord(parsed) ? parsed : {};
}

function skillsSection(settings: Record<string, unknown>): Record<string, unknown> {
	const skills = settings.skills;
	return isRecord(skills) ? skills : {};
}

function historySection(settings: Record<string, unknown>): Record<string, unknown> {
	const history = skillsSection(settings).history;
	return isRecord(history) ? history : {};
}

function registrySection(settings: Record<string, unknown>): Record<string, unknown> {
	const registry = skillsSection(settings).registry;
	return isRecord(registry) ? registry : {};
}

/** A configured path set, keeping only the entries that name a real pair. */
function configuredPaths(value: unknown): Record<string, ConfiguredPath> {
	if (!isRecord(value)) {
		return DEFAULTS.paths;
	}
	const paths: Record<string, ConfiguredPath> = {};
	for (const [id, entry] of Object.entries(value)) {
		if (!isRecord(entry)) continue;
		if (typeof entry.path !== "string" || entry.path.length === 0) continue;
		if (typeof entry.writable !== "boolean") continue;
		paths[id] = { writable: entry.writable, path: entry.path };
	}
	return paths;
}

function stringArray(value: unknown): value is readonly string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}
