/**
 * The model channel's success text: what the tool result's `content` says.
 *
 * This text is the reader's whole view of a successful call, and the card
 * shows it verbatim as `{output}`, so every line here is the document's
 * wording, not a paraphrase. The module knows nothing of the index or the
 * card: display ids and paths arrive as strings.
 */

/** One listed object: its display id and the path on disk. */
export interface ListedItem {
	readonly displayId: string;
	readonly path: string;
}

/** One search hit: its display id and the document's frontmatter, verbatim. */
export interface SearchHit {
	readonly displayId: string;
	readonly frontmatter: string;
}

/** One row of a load or cancel result. */
export interface ChangeRow {
	readonly displayId: string;
	readonly action: "Loaded" | "Refreshed" | "Unchanged" | "Unloaded";
}

/** What a preview states, with or without a projected section. */
export interface PreviewText {
	readonly totalLines: number;
	readonly totalBytes: number;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly section?: string;
}

/** A removal of a skill: the directory and every file under it. */
export interface RemovedSkill {
	readonly path: string;
	readonly files: readonly string[];
}

/** A rename of a skill: the directory on both sides, and every file with its own pair. */
export interface MovedSkill {
	readonly from: string;
	readonly to: string;
	readonly files: readonly {
		readonly from: string;
		readonly to: string;
	}[];
}

export const EMPTY_LIST_SKILLS = "No skill found";
export const EMPTY_LIST_TAGS = "No tag found";
export const EMPTY_LIST_FILES = "No file found";
export const EMPTY_PREVIEW = "Nothing to view";
export const EMPTY_SEARCH = "No matches";
export const EMPTY_CREATE = "Nothing to write";

/** `list_skills`: one `[id] path` line per skill. */
export function listSkillsText(items: readonly ListedItem[]): string {
	return listText(items, EMPTY_LIST_SKILLS);
}

/** `list_skill_tags`: every tag on one line, comma-separated. */
export function listSkillTagsText(tags: readonly string[]): string {
	if (tags.length === 0) {
		return EMPTY_LIST_TAGS;
	}
	return tags.join(", ");
}

/** `list_skill_files`: one `[id] path` line per related file. */
export function listSkillFilesText(items: readonly ListedItem[]): string {
	return listText(items, EMPTY_LIST_FILES);
}

/** `preview_skill`: the statistics, then the section between separators. */
export function previewSkillText(preview: PreviewText): string {
	if (preview.totalLines === 0) {
		return EMPTY_PREVIEW;
	}
	const lines = [
		`Total Lines: ${preview.totalLines}`,
		`Total Bytes: ${preview.totalBytes}`,
		`Created At: ${preview.createdAt}`,
		`Updated At: ${preview.updatedAt}`,
	];
	if (preview.section !== undefined) {
		lines.push("======", preview.section, "======");
	}
	return lines.join("\n");
}

/**
 * `search_skill`: `[id]` then the document's frontmatter, one block each,
 * blocks separated by a blank line.
 */
export function searchSkillText(hits: readonly SearchHit[]): string {
	if (hits.length === 0) {
		return EMPTY_SEARCH;
	}
	// Entries are blank-line separated.
	return hits
		.map((hit) => `[${hit.displayId}]\n${hit.frontmatter}`)
		.join("\n\n");
}

/**
 * A load or unload result: the action, then every id it applied to.
 *
 * One text serves both tools: the action word already says which happened,
 * so the caller does not distinguish import from cancel.
 */
export function changeSkillText(rows: readonly ChangeRow[]): string {
	return changeText(rows);
}

/** `create_skill`: the path the file was written to. */
export function createSkillText(path: string): string {
	return `Actual Wrote Path: ${path}`;
}

/** `remove_skill`: the skill directory and the files that left with it. */
export function removeSkillText(removed: RemovedSkill): string {
	return [
		`Removed folder: ${removed.path}`,
		"Removed files:",
		...removed.files.map((file) => `- ${file}`),
	].join("\n");
}

/** `rename_skill`: both sides of the move, for the directory and every file. */
export function renameSkillText(moved: MovedSkill): string {
	return [
		`Moved path: ${moved.from} → ${moved.to}`,
		"Moved files:",
		...moved.files.map((file) => `- ${file.from} → ${file.to}`),
	].join("\n");
}

/** A related file that left or moved: one line naming the path. */
export function removedFileText(path: string): string {
	return `Removed: ${path}`;
}

export function movedFileText(path: string): string {
	return `Moved: ${path}`;
}

function listText(items: readonly ListedItem[], empty: string): string {
	if (items.length === 0) {
		return empty;
	}
	return items.map((item) => `[${item.displayId}] ${item.path}`).join("\n");
}

/**
 * A change's text: one action word per group, then the ids it applied to
 * without a separator, as the document states it. Groups keep the order their
 * first row appeared in.
 */
function changeText(rows: readonly ChangeRow[]): string {
	const groups = new Map<string, string[]>();
	for (const row of rows) {
		const ids = groups.get(row.action);
		if (ids === undefined) {
			groups.set(row.action, [`[${row.displayId}]`]);
		} else {
			ids.push(`[${row.displayId}]`);
		}
	}
	return Array.from(groups, ([action, ids]) => `${action} ${ids.join("")}`).join(
		"\n",
	);
}
