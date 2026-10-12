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
import { parseSkillId, reproduceSkillId } from "./skill-id";
import type { LoadedSet } from "./state";

/**
 * Model-channel wrapper: the complete file (or frontmatter) inside an
 * attributed open/close pair. `location` is the resolved absolute path.
 */
export function wrapSkillBlock(
	id: string,
	path: string,
	text: string,
): string {
	return `<SKILL id="${id}" location="${path}">\n${text}\n</SKILL>`;
}

/**
 * The id as it displays: the full id while its name has a location conflict,
 * the bare form otherwise (the `{dynamic-skill-id}` projection).
 */
function displayId(id: string, conflicts: ReadonlySet<string>): string {
	const parsed = parseSkillId(id);
	if (parsed.error !== undefined) {
		return id;
	}
	if (conflicts.has(parsed.name)) {
		return id;
	}
	return reproduceSkillId({ name: parsed.name, refPath: parsed.refPath });
}

/** The state's render, in load order; each id projects to its display form. */
export function renderSkillBlock(
	set: LoadedSet,
	conflicts: ReadonlySet<string>,
): string {
	return set.entries
		.map((entry) =>
			wrapSkillBlock(displayId(entry.id, conflicts), entry.path, entry.body),
		)
		.join("\n\n");
}
