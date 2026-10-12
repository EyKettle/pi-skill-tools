/**
 * skill-block.ts — the loaded set's render: entries in load order, each
 * wrapped as an attributed block, joined by a blank line; an empty set hands
 * out the empty string (plan Task 3).
 *
 * The wrapper is one implementation for two consumers: the tools' model
 * channel and this block.
 *
 * Pure module: no filesystem, no Pi import.
 */
import type { LoadedSet } from "./state";

/**
 * Model-channel wrapper: the complete file (or frontmatter) inside an
 * attributed open/close pair. `location` is the resolved absolute path.
 */
export function wrapSkillBlock(
	name: string,
	path: string,
	text: string,
): string {
	return `<SKILL name="${name}" location="${path}">\n${text}\n</SKILL>`;
}

/** The state's render, in load order. */
export function renderSkillBlock(set: LoadedSet): string {
	return set.entries
		.map((entry) => wrapSkillBlock(entry.name, entry.path, entry.body))
		.join("\n\n");
}
