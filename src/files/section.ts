/**
 * Markdown section extraction by heading title.
 *
 * A section starts at the heading whose title matches (case-insensitive) and
 * ends at the next heading of the same or a higher level. Lines inside a
 * fenced block are content, never headings; a line indented four spaces is
 * code, not a heading. A fence closes only on the same character, at least
 * as long, with nothing after it, so a longer fence can hold a shorter one
 * and the heading it shows stays code. The result carries the heading line
 * itself, so the reader sees the section in its own context.
 */

export interface ExtractedSection {
	readonly heading: string;
	readonly content: string;
	readonly lines: number;
	readonly bytes: number;
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

export function extractSection(
	markdownText: string,
	headingTitle: string,
): ExtractedSection | undefined {
	if (markdownText.trim().length === 0) {
		return undefined;
	}

	const target = headingTitle.trim().toLowerCase();
	const lines = markdownText.replace(/\r\n/g, "\n").split("\n");

	let fence: Fence | undefined;
	let capturing = false;
	let capturedLevel = 0;
	const capturedHeadingLines: string[] = [];

	for (const line of lines) {
		if (fence === undefined) {
			fence = openingFence(line);
		} else if (closesFence(line, fence)) {
			fence = undefined;
		}

		if (fence === undefined) {
			const heading = HEADING.exec(line);
			if (heading !== null) {
				const level = heading[1].length;
				if (!capturing) {
					if (heading[2].toLowerCase() === target) {
						capturing = true;
						capturedLevel = level;
						capturedHeadingLines.push(line);
						continue;
					}
				} else if (level <= capturedLevel) {
					break;
				}
			}
		}

		if (capturing) {
			capturedHeadingLines.push(line);
		}
	}

	if (!capturing) {
		return undefined;
	}

	while (
		capturedHeadingLines.length > 0 &&
		capturedHeadingLines[capturedHeadingLines.length - 1].trim() === ""
	) {
		capturedHeadingLines.pop();
	}

	const content = capturedHeadingLines.join("\n");
	return {
		heading: capturedHeadingLines[0],
		content,
		lines: capturedHeadingLines.length,
		bytes: Buffer.byteLength(content, "utf8"),
	};
}
