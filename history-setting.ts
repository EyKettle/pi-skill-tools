/**
 * history-setting.ts — the `skills.history.enable` reader (plan Task 4).
 *
 * The switch is read from `{agent_dir}/settings.json` on disk, not through
 * the settings write channel; a missing file or key, or a value that is not
 * a boolean, means enabled.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { getByPath } from "./frontmatter";

/** Whether the commit log is being recorded; absent or unreadable means on. */
export function historyEnabled(agentDir: string): boolean {
	let raw: string;
	try {
		raw = readFileSync(path.join(agentDir, "settings.json"), "utf8");
	} catch {
		return true;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return true;
	}
	if (typeof parsed !== "object" || parsed === null) {
		return true;
	}
	return (
		getByPath(parsed as Record<string, unknown>, "skills.history.enable") !== false
	);
}
