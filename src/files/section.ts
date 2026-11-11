/**
 * The sections of one file: where the headings stand, how they nest, which
 * lines belong to a section's own body, and what a set of selectors reaches.
 *
 * A heading is an ATX line with at most three leading spaces and optional
 * closing hashes. Lines inside a fenced block are content, never headings; a
 * line indented four spaces is code, not a heading. A fence closes only on the
 * same character, at least as long, with nothing after it, so a longer fence can
 * hold a shorter one and the heading it shows stays code.
 *
 * Every heading carries its physical line, counted from 1, so a reader can point
 * at the source it came from. A section's own body is the lines between its
 * heading and the next heading of any level: the text that belongs to it, with
 * the nested sections left to themselves.
 *
 * One parse answers every question the rest of the tree asks: navigation,
 * matching and projection all read this representation, so they never disagree
 * about where a heading stands.
 */
import { createFailure } from "../failure/create";
import type { Failure, SectionSelector } from "../failure/types";
export interface SectionHeading {
	/** The heading text, without the hash marks and the closing hashes. */
	readonly title: string;
	/** The heading's level, 1 to 6. */
	readonly level: number;
	/** The heading's physical line in the file, counted from 1. */
	readonly line: number;
	/** The heading line as the file carries it. */
	readonly heading: string;
	/** The lines between this heading and the next heading. */
	readonly content: string;
	/** The physical lines the body occupies. */
	readonly contentLines: readonly number[];
	/** The headings nested under this one, in source order. */
	readonly children: readonly SectionHeading[];
}

/** Every heading of one file, in source order. */
export interface SectionDocument {
	/** The file the headings were read from. */
	readonly path: string;
	/** The headings, in source order. */
	readonly headings: readonly SectionHeading[];
}

/** An ATX heading with at most three leading spaces and optional closing hashes. */
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;

/** A fence opener: ``` or ~~~, at least three, with an optional info string. */
const OPENING_FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/** A fence closer: the same character, at least as long, nothing after it. */
const CLOSING_FENCE = /^ {0,3}(`+|~+)\s*$/;

interface Fence {
	readonly marker: "`" | "~";
	readonly length: number;
}

/** A heading as the scan found it, before the body and the nesting are known. */
interface HeadingHit {
	readonly level: number;
	readonly line: number;
	readonly title: string;
	readonly heading: string;
}

/** A section's body: its text and the physical lines it occupies. */
interface SectionBody {
	readonly content: string;
	readonly contentLines: readonly number[];
}

/** The lines a section's body occupies, counted from 1. */
interface LineRange {
	/** The first line of the body. */
	readonly from: number;
	/** The line the body ends before. */
	readonly to: number;
}

/**
 * Read the headings of a Markdown text. One parse answers every question the
 * rest of the tree asks: navigation, matching and projection all read this
 * representation, so they never disagree about where a heading stands.
 */
export function parseSections(text: string, path: string): SectionDocument {
	const lines = physicalLines(text);
	const hits = scanHeadings(lines);
	const bodies = hits.map((hit, index) =>
		bodyOf(lines, { from: hit.line + 1, to: nextHeadingLine(hits, index) }),
	);
	return { path, headings: nest(hits, bodies) };
}

/** The file's lines: line endings normalized, a trailing newline adding none. */
function physicalLines(text: string): string[] {
	if (text.length === 0) {
		return [];
	}
	const lines = text.replace(/\r\n/g, "\n").split("\n");
	if (lines.length > 1 && lines[lines.length - 1] === "") {
		lines.pop();
	}
	return lines;
}

/** The headings the text carries, in source order, fenced lines skipped. */
function scanHeadings(lines: readonly string[]): HeadingHit[] {
	const hits: HeadingHit[] = [];
	let fence: Fence | undefined;

	for (const [index, line] of lines.entries()) {
		if (fence === undefined) {
			fence = openingFence(line);
		} else if (closesFence(line, fence)) {
			fence = undefined;
		}
		if (fence !== undefined) {
			continue;
		}
		const match = HEADING.exec(line);
		if (match === null) {
			continue;
		}
		hits.push({
			level: match[1].length,
			line: index + 1,
			title: match[2],
			heading: line,
		});
	}

	return hits;
}

function openingFence(line: string): Fence | undefined {
	const match = OPENING_FENCE.exec(line);
	if (match === null) {
		return undefined;
	}
	const run = match[1];
	// A backtick fence's info string may not contain a backtick, or the line
	// is an inline code span rather than a block.
	if (run[0] === "`" && match[2].includes("`")) {
		return undefined;
	}
	return {
		marker: run[0] === "`" ? "`" : "~",
		length: run.length,
	};
}

function closesFence(line: string, fence: Fence): boolean {
	const match = CLOSING_FENCE.exec(line);
	if (match === null) {
		return false;
	}
	const run = match[1];
	return run[0] === fence.marker && run.length >= fence.length;
}

/** The line of the heading that follows the one at `index`, or the file's end. */
function nextHeadingLine(hits: readonly HeadingHit[], index: number): number {
	const next = hits[index + 1];
	return next === undefined ? Number.POSITIVE_INFINITY : next.line;
}

/**
 * The lines between a heading and the next one, without the blank lines that
 * only space the text apart.
 */
function bodyOf(lines: readonly string[], range: LineRange): SectionBody {
	const end = Math.min(range.to, lines.length + 1);
	let first = range.from;
	let last = end - 1;

	while (first <= last && lines[first - 1].trim() === "") {
		first += 1;
	}
	while (last >= first && lines[last - 1].trim() === "") {
		last -= 1;
	}
	if (first > last) {
		return { content: "", contentLines: [] };
	}

	const contentLines: number[] = [];
	for (let line = first; line <= last; line += 1) {
		contentLines.push(line);
	}
	return { content: lines.slice(first - 1, last).join("\n"), contentLines };
}

/**
 * The headings as a tree: every heading nested under the nearest heading of a
 * lower level, and the list itself in source order.
 */
function nest(
	hits: readonly HeadingHit[],
	bodies: readonly SectionBody[],
): SectionHeading[] {
	const children = childIndexes(hits);
	const headings: SectionHeading[] = new Array(hits.length);
	for (let index = hits.length - 1; index >= 0; index -= 1) {
		const hit = hits[index];
		const body = bodies[index];
		headings[index] = {
			title: hit.title,
			level: hit.level,
			line: hit.line,
			heading: hit.heading,
			content: body.content,
			contentLines: body.contentLines,
			children: children[index].map((child) => headings[child]),
		};
	}
	return headings;
}

/** The direct children of every heading, as positions in the heading list. */
function childIndexes(hits: readonly HeadingHit[]): number[][] {
	const children: number[][] = hits.map(() => []);
	const stack: number[] = [];

	for (const [index, hit] of hits.entries()) {
		while (stack.length > 0 && hits[stack[stack.length - 1]].level >= hit.level) {
			stack.pop();
		}
		const parent = stack[stack.length - 1];
		if (parent !== undefined) {
			children[parent].push(index);
		}
		stack.push(index);
	}

	return children;
}

/** A selector that reached no heading, and the failure that says why. */
export interface SectionIssue {
	readonly selector: SectionSelector;
	readonly failure: Failure;
}

/** The outcome of resolving a set of selectors against one document. */
export interface SectionSelection {
	/** The headings the selectors reached, in source order, without repeats. */
	readonly selected: readonly SectionHeading[];
	/** The selectors that reached no heading, in the order they were given. */
	readonly issues: readonly SectionIssue[];
}

/** A heading as the tree shows it: the line it stands at, and its heading line. */
export interface SectionEntry {
	readonly line: number;
	readonly heading: string;
}

/** One selected section, projected for a reader. */
export interface ProjectedSection {
	readonly heading: string;
	readonly content: string;
	/** The nested headings, in source order: the section's own directory. */
	readonly subSections: readonly SectionEntry[];
}

/** What a preview shows: the file's tree, or the sections a selection chose. */
export type SectionProjection =
	| {
			readonly mode: "tree";
			readonly headings: readonly SectionEntry[];
			readonly viewedLines: number;
	  }
	| {
			readonly mode: "sections";
			readonly sections: readonly ProjectedSection[];
			readonly viewedLines: number;
	  };

/** The heading a selector reaches, or the failure that says it reaches none. */
type SelectorMatch =
	| { readonly ok: true; readonly heading: SectionHeading }
	| { readonly ok: false; readonly failure: Failure };

/**
 * Resolve selectors against the document. Every selector stands on its own: one
 * that reaches no heading is reported beside the ones that did, and the ones
 * that did are kept in the order the file carries them.
 */
export function selectSections(
	document: SectionDocument,
	selectors: readonly SectionSelector[],
): SectionSelection {
	const selected: SectionHeading[] = [];
	const issues: SectionIssue[] = [];

	for (const selector of selectors) {
		const match = matchSelector(document, selector);
		if (!match.ok) {
			issues.push({ selector, failure: match.failure });
			continue;
		}
		if (!selected.includes(match.heading)) {
			selected.push(match.heading);
		}
	}

	selected.sort((left, right) => left.line - right.line);
	return { selected, issues };
}

/**
 * Project what a preview shows: the file's whole tree when nothing was chosen,
 * the chosen sections otherwise, and the source lines the result stands for.
 */
export function projectSections(
	document: SectionDocument,
	selection: SectionSelection | undefined,
): SectionProjection {
	if (selection === undefined) {
		const headings = document.headings.map((heading) => ({
			line: heading.line,
			heading: heading.heading,
		}));
		return { mode: "tree", headings, viewedLines: headings.length };
	}

	const sections: ProjectedSection[] = [];
	const lines = new Set<number>();
	for (const heading of selection.selected) {
		const descendants = descendantsOf(heading);
		sections.push({
			heading: heading.heading,
			content: heading.content,
			subSections: descendants.map((descendant) => ({
				line: descendant.line,
				heading: descendant.heading,
			})),
		});
		lines.add(heading.line);
		for (const line of heading.contentLines) {
			lines.add(line);
		}
		for (const descendant of descendants) {
			lines.add(descendant.line);
		}
	}
	return { mode: "sections", sections, viewedLines: lines.size };
}

function matchSelector(
	document: SectionDocument,
	selector: SectionSelector,
): SelectorMatch {
	if (selector.kind === "line") {
		const heading = document.headings.find((entry) => entry.line === selector.line);
		return heading === undefined
			? { ok: false, failure: notFound(document, selector) }
			: { ok: true, heading };
	}

	const target = selector.name.trim().toLowerCase();
	const matches = document.headings.filter(
		(heading) => heading.title.toLowerCase() === target,
	);
	if (matches.length === 0) {
		return { ok: false, failure: notFound(document, selector) };
	}
	if (matches.length > 1) {
		return {
			ok: false,
			failure: createFailure("SECTION_AMBIGUOUS", {
				kind: "sectionAmbiguous",
				path: document.path,
				name: selector.name,
				candidates: matches.map((heading) => ({
					heading: heading.heading,
					line: heading.line,
				})),
			}),
		};
	}
	return { ok: true, heading: matches[0] };
}

function notFound(document: SectionDocument, selector: SectionSelector): Failure {
	return createFailure("SECTION_NOT_FOUND", {
		kind: "section",
		path: document.path,
		selector,
	});
}

/** The headings nested under a heading, in source order. */
function descendantsOf(heading: SectionHeading): SectionHeading[] {
	const descendants: SectionHeading[] = [];
	for (const child of heading.children) {
		descendants.push(child, ...descendantsOf(child));
	}
	return descendants;
}
