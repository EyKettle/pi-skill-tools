/**
 * Pure-fabrication module for extracting sections from Markdown text.
 *
 * Provides deterministic level-2 heading section extraction with code fence
 * awareness (ignores false headings inside ``` or ~~~ blocks).
 */

export interface ExtractedSection {
	readonly heading: string;
	readonly content: string;
	readonly lines: number;
	readonly bytes: number;
}

const LEVEL_2_HEADING = /^##\s+(.+?)\s*$/;
const SECTION_BOUNDARY = /^#{1,2}\s+/;
const CODE_FENCE = /^(```|~~~)/;

/**
 * Extract a level-2 markdown section by heading title.
 * Ignores headings inside fenced code blocks. Stops at the next level-1 or level-2 heading.
 */
export function extractSection(
	markdownText: string,
	headingTitle: string,
): ExtractedSection | undefined {
	if (markdownText.trim().length === 0) {
		return undefined;
	}

	const normalizedTarget = headingTitle.trim().toLowerCase();
	const lines = markdownText.replace(/\r\n/g, "\n").split("\n");

	let inCodeFence = false;
	let fenceMarker = "";
	let capturing = false;
	let capturedHeading = "";
	const capturedLines: string[] = [];

	for (const line of lines) {
		const trimmed = line.trim();

		// Track fenced code blocks to prevent matching fake headings
		if (CODE_FENCE.test(trimmed)) {
			const marker = trimmed.slice(0, 3);
			if (!inCodeFence) {
				inCodeFence = true;
				fenceMarker = marker;
			} else if (marker === fenceMarker) {
				inCodeFence = false;
				fenceMarker = "";
			}
		}

		if (!inCodeFence) {
			if (!capturing) {
				const match = LEVEL_2_HEADING.exec(trimmed);
				if (match !== null && match[1].toLowerCase() === normalizedTarget) {
					capturing = true;
					capturedHeading = line;
					capturedLines.push(line);
				}
				continue;
			}

			// We are capturing: a subsequent level 1 or 2 heading marks the section end
			if (capturedLines.length > 1 && SECTION_BOUNDARY.test(trimmed)) {
				break;
			}
		}

		if (capturing) {
			capturedLines.push(line);
		}
	}

	if (!capturing) {
		return undefined;
	}

	// Trim trailing blank lines from captured content
	while (capturedLines.length > 0 && capturedLines[capturedLines.length - 1].trim() === "") {
		capturedLines.pop();
	}

	const content = capturedLines.join("\n");
	return {
		heading: capturedHeading,
		content,
		lines: capturedLines.length,
		bytes: Buffer.byteLength(content, "utf8"),
	};
}
