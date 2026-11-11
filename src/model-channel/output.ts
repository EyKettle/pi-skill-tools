/**
 * The model channel's success text: what the tool result's `content` says.
 *
 * This text is the reader's whole view of a successful call, and the card
 * shows it verbatim as `{output}`, so every line here is the document's
 * wording, not a paraphrase. The module knows nothing of the index or the
 * card: display ids and paths arrive as strings.
 */
import type { Failure } from "../failure/types";
import { sectionIssueText } from "./failure-text";

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

/** A heading as a reader sees it in a tree: the line it stands at, and its heading. */
export interface PreviewEntry {
	readonly line: number;
	readonly heading: string;
}

/** One selected section, as the model text shows it. */
export interface PreviewSection {
	readonly heading: string;
	readonly content: string;
	/** The nested headings, in source order: the section's own directory. */
	readonly subSections: readonly PreviewEntry[];
}

/** What a preview shows: the file's tree, or the sections a selection chose. */
export type PreviewContent =
	| { readonly mode: "tree"; readonly tree: readonly PreviewEntry[] }
	| { readonly mode: "sections"; readonly sections: readonly PreviewSection[] };

/** What a preview states: the file it read, its statistics, its content, and its issues. */
export interface PreviewText {
	/** The file the preview read: its display id and absolute path. */
	readonly source: ListedItem;
	readonly totalLines: number;
	readonly totalBytes: number;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly content: PreviewContent;
	/** The selections that reached no heading. */
	readonly issues: readonly Failure[];
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
/** A single-file skill can hold no related files; the sentence is fixed. */
export const SINGLE_FILE_SKILL = "Single file skill has no related files";
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

/**
 * `preview_skill`: the source line, the statistics, the sections or the tree
 * between the separators, and the selections that reached no heading after
 * them. An empty file keeps the source line and answers with the empty
 * sentence: the call still says which file it read.
 */
export function previewSkillText(preview: PreviewText): string {
	const source = itemLine(preview.source);
	if (preview.totalLines === 0) {
		return `${source}\n${EMPTY_PREVIEW}`;
	}
	const lines = [
		source,
		`Total Lines: ${preview.totalLines}`,
		`Total Bytes: ${preview.totalBytes}`,
		`Created At: ${preview.createdAt}`,
		`Updated At: ${preview.updatedAt}`,
		"======",
		...contentLines(preview.content),
		"======",
	];
	if (preview.issues.length > 0) {
		lines.push("[WARN] Some section selections failed:");
		for (const issue of preview.issues) {
			lines.push(sectionIssueText(issue));
		}
	}
	return lines.join("\n");
}

/** The lines the framed part carries: the tree, or the chosen sections. */
function contentLines(content: PreviewContent): string[] {
	if (content.mode === "tree") {
		return content.tree.map(treeLine);
	}
	const lines: string[] = [];
	for (const [index, section] of content.sections.entries()) {
		if (index > 0) {
			lines.push("");
		}
		lines.push(...sectionLines(section));
	}
	return lines;
}

/** One section: its heading, its own body, and the directory under it. */
function sectionLines(section: PreviewSection): string[] {
	const parts = [section.heading];
	if (section.content !== "") {
		parts.push(section.content);
	}
	if (section.subSections.length > 0) {
		parts.push(
			section.subSections.map(treeLine).join("\n"),
		);
	}
	return parts.join("\n\n").split("\n");
}

/** One entry of the section tree: the line a heading stands at, and its heading. */
function treeLine(entry: PreviewEntry): string {
	return `${entry.line}:${entry.heading}`;
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
	return items.map(itemLine).join("\n");
}

/** One listed object as a reader sees it: its display id, then its path. */
function itemLine(item: ListedItem): string {
	return `[${item.displayId}] ${item.path}`;
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
