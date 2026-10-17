/**
 * The four `/skill:*` commands, over the same use cases the tools call.
 *
 * A command answers with one message; the plugin decides how to show it. The
 * loaded set is read from, and changed through, the one `SkillTree`, so a
 * command and a tool can never disagree about what is loaded.
 */
import type { Index } from "../discovery/types";
import { changeSkillText } from "../model-channel/output";
import type { SkillTree } from "../skill-tree/types";

export type CommandName = "loaded" | "import" | "cancel" | "clear";

export interface CommandPorts {
	readonly tree: SkillTree;
	readonly index: () => Index;
	/** Whether history folding is available, for the loaded report. */
	readonly historyEnabled: () => boolean;
	/** Called after a change lands, so the status bar and cache follow. */
	readonly afterChange: () => void;
}

/** Run one command and return the message to show. */
export function runCommand(
	ports: CommandPorts,
	name: CommandName,
	args: string,
): string {
	switch (name) {
		case "loaded":
			return reportLoaded(ports);
		case "import":
			return runImport(ports, args);
		case "cancel":
			return runCancel(ports, args);
		case "clear":
			return runClear(ports);
	}
}

/** `/skill:loaded`: what is loaded, and whether history folding works. */
function reportLoaded(ports: CommandPorts): string {
	const history = ports.historyEnabled()
		? "History: available."
		: "History: unavailable; changes are not entering the commit log.";
	const loaded = ports.tree.state;
	if (loaded.length === 0) {
		return `No skills loaded. ${history}`;
	}
	const lines = loaded.map((entry) => `- ${entry.id} (${entry.path})`);
	return [`Loaded ${loaded.length}:`, ...lines, history].join("\n");
}

/** `/skill:import <id…>`; without ids, every loaded entry is re-read. */
function runImport(ports: CommandPorts, args: string): string {
	const ids = splitIds(args);
	const targets = ids.length > 0 ? ids : ports.tree.state.map((e) => e.id);
	if (targets.length === 0) {
		return "No skills loaded to re-read.";
	}
	const result = ports.tree.importSkills(ports.index(), targets);
	if (!result.ok) {
		return `${result.failure.code}: ${result.failure.recovery}`;
	}
	ports.afterChange();
	return changeSkillText(result.results);
}

/** `/skill:cancel <id…>`. */
function runCancel(ports: CommandPorts, args: string): string {
	const ids = splitIds(args);
	if (ids.length === 0) {
		return "Provide at least one ID to cancel.";
	}
	const result = ports.tree.cancelSkills(ports.index(), ids);
	if (!result.ok) {
		return `${result.failure.code}: ${result.failure.recovery}`;
	}
	ports.afterChange();
	return changeSkillText(result.results);
}

/** `/skill:clear`: cancel everything that is loaded. */
function runClear(ports: CommandPorts): string {
	const ids = ports.tree.state.map((entry) => entry.id);
	if (ids.length === 0) {
		return "No skills loaded.";
	}
	const result = ports.tree.cancelSkills(ports.index(), ids);
	if (!result.ok) {
		return `${result.failure.code}: ${result.failure.recovery}`;
	}
	ports.afterChange();
	return changeSkillText(result.results);
}

/** The ids a command line carries, trimmed and without empties. */
function splitIds(args: string): string[] {
	return args
		.split(/\s+/)
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
}
