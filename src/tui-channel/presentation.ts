/**
 * The card's projection: one payload, the call's arguments, and the tool
 * result's text become the lines the terminal shows.
 *
 * Collapsed, the call slot is `{title} {args}` and the result slot is
 * `{answer} {extra}`. Expanded, the call slot is `{title} {info}`, the full
 * argument list follows, and the result slot is `{output}` — the tool result's
 * `content`, verbatim — or the answer when there is no content. A failure
 * answers with the failure's recovery sentence and hides the info; a load or
 * unload card is only its labels.
 */
import type {
	CardProjection,
	CardSpan,
	TransportPayload,
} from "./types";

export interface PresentOptions {
	readonly tool: string;
	readonly args: Record<string, unknown>;
	readonly expanded: boolean;
	/** The tool result's `content`: the text the model reads, verbatim. */
	readonly content?: string;
	/** The expand hotkey; without it no expand hint is drawn. */
	readonly keyHint?: string;
}

const TITLES: Readonly<Record<string, string>> = {
	list_skills: "List",
	list_skill_tags: "List",
	list_skill_files: "List",
	preview_skill: "Preview",
	search_skill: "Search",
	create_skill: "Create",
	rename_skill: "Rename",
	remove_skill: "Remove",
};

/** Project one tool result (or its absence) into the card's slots. */
export function presentRow(
	payload: TransportPayload | undefined,
	options: PresentOptions,
): CardProjection {
	if (options.tool === "import_skill" || options.tool === "cancel_skill") {
		return {
			call: [],
			fullArgs: [],
			result: [],
			labels: labelsOf(payload, options.tool),
		};
	}

	const title = TITLES[options.tool] ?? options.tool;
	const args = renderArgs(options.tool, options.args);
	if (payload === undefined) {
		return {
			call: [
				span(title, "toolTitle"),
				span(" ", "text"),
				span(args, "customMessageLabel"),
				span(" …", "muted"),
			],
			fullArgs: [],
			result: [],
		};
	}

	if (payload.outcome === "failure") {
		return {
			call: screenCall(title, args, options, undefined),
			fullArgs: options.expanded ? fullArgs(options.args) : [],
			result: [[span(payload.failure.recovery, "toolOutput")]],
		};
	}

	const view = resultOf(payload);
	// `{output}` follows the model text unless the document states the block
	// a tool shows; `create_skill` is that case.
	const output =
		view.output !== undefined
			? view.output.map((line) => [span(line, "toolOutput")])
			: outputLines(options.content);
	return {
		call: screenCall(title, args, options, view.info),
		fullArgs: options.expanded ? fullArgs(options.args) : [],
		result: options.expanded
			? output.length > 0
				? output
				: [[span(view.answer, "toolOutput")]]
			: [
					[
						span(view.answer, "toolOutput"),
						...(output.length > 0 && options.keyHint !== undefined
							? [span(`  • ${options.keyHint} to expand`, "muted")]
							: []),
					],
				],
	};
}

interface ResultView {
	readonly answer: string;
	readonly info?: string;
	/** The card's own `{output}`, when the document overrides the default. */
	readonly output?: readonly string[];
}

function screenCall(
	title: string,
	args: string,
	options: PresentOptions,
	info: string | undefined,
): readonly CardSpan[] {
	const label = options.expanded && info !== undefined ? info : args;
	const role =
		options.expanded && info !== undefined ? "text" : "customMessageLabel";
	return [span(title, "toolTitle"), span(" ", "text"), span(label, role)];
}

function resultOf(payload: TransportPayload): ResultView {
	if (payload.outcome === "failure") {
		return { answer: payload.failure.recovery };
	}
	switch (payload.tool) {
		case "list_skills":
			return counted(payload.data.count, "Listed", "skill", "skills", "No skill found");
		case "list_skill_tags":
			return counted(payload.data.count, "Listed", "tag", "tags", "No tag found");
		case "list_skill_files":
			return counted(payload.data.count, "Listed", "file", "files", "No file found");
		case "search_skill":
			return counted(payload.data.count, "Found", "skill", "skills", "No matches");
		case "preview_skill": {
			const data = payload.data;
			if (data.totalLines === 0) {
				return { answer: "Nothing to view", info: "(0)" };
			}
			const shown = data.sectionLines ?? data.totalLines;
			return { answer: `Viewed ${shown}/${data.totalLines} lines` };
		}
		case "create_skill": {
			const data = payload.data;
			if (data.lines === 0) {
				// An empty write shows nothing; the answer carries the empty state.
				return { answer: "Nothing to write", info: "(0 B, 0 L)" };
			}
			return {
				answer: `Wrote ${data.lines} ${noun(data.lines, "line", "lines")} (${data.bytes} B)`,
				info: `(${data.bytes} B, ${data.lines} L)`,
				output: [
					`Path: ${data.path}`,
					"======",
					data.content.endsWith("\n")
						? data.content.slice(0, -1)
						: data.content,
					"======",
				],
			};
		}
		case "rename_skill": {
			const data = payload.data;
			return {
				answer: `${data.from} → ${data.to}`,
				info:
					data.kind === "skill"
						? `(${data.fileCount} files)`
						: undefined,
			};
		}
		case "remove_skill": {
			const data = payload.data;
			return {
				answer: `Removed ${data.displayId}`,
				info:
					data.kind === "skill"
						? `(${data.fileCount} files)`
						: undefined,
			};
		}
		case "import_skill":
		case "cancel_skill":
			return { answer: "" };
	}
}

/** A listing's answer: the verb, the count, its noun, and the empty sentence. */
function counted(
	count: number,
	verb: string,
	one: string,
	many: string,
	empty: string,
): ResultView {
	if (count === 0) {
		return { answer: empty, info: "(0)" };
	}
	return {
		answer: `${verb} ${count} ${noun(count, one, many)}`,
		info: `(${count})`,
	};
}

function labelsOf(
	payload: TransportPayload | undefined,
	tool: "import_skill" | "cancel_skill",
): readonly CardSpan[] {
	if (payload === undefined || payload.outcome === "failure") {
		return [];
	}
	if (payload.tool !== tool) {
		return [];
	}
	const role = tool === "import_skill" ? "success" : "error";
	return payload.data.displayIds.map((displayId) =>
		span(`Skill::${displayId}`, role),
	);
}

// ---------------------------------------------------------------------------
// call arguments

function renderArgs(tool: string, args: Record<string, unknown>): string {
	switch (tool) {
		case "list_skills":
			return `skills${locationSuffix(args)}`;
		case "list_skill_tags":
			return `skill tags${locationSuffix(args)}`;
		case "list_skill_files":
			return `skill refs${stringSuffix(args, "id")}`;
		case "preview_skill":
			return `${text(args.id)}${sectionSuffix(args)}`;
		case "search_skill":
			return filterText(args.filter);
		case "create_skill":
		case "remove_skill":
			return text(args.id);
		case "rename_skill":
			// The id and the new name are what the answer states.
			return "";
		default:
			return "";
	}
}

function locationSuffix(args: Record<string, unknown>): string {
	return args.location === undefined ? "" : ` ${text(args.location)}`;
}

function stringSuffix(args: Record<string, unknown>, key: string): string {
	return args[key] === undefined ? "" : ` ${text(args[key])}`;
}

function sectionSuffix(args: Record<string, unknown>): string {
	return args.section === undefined ? "" : ` "${text(args.section)}"`;
}

function filterText(value: unknown): string {
	if (typeof value !== "object" || value === null) {
		return "";
	}
	return Object.entries(value)
		.map(([key, entry]) => `${key}: ${formatValue(entry)}`)
		.join(", ");
}

function fullArgs(args: Record<string, unknown>): string[] {
	const lines: string[] = [];
	for (const [key, value] of Object.entries(args)) {
		const rendered = formatValue(value);
		const [first, ...rest] = rendered.split("\n");
		lines.push(`${key}: ${first}`);
		lines.push(...rest);
	}
	return lines;
}

function formatValue(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map(formatValue).join(", ");
	}
	if (typeof value === "object" && value !== null) {
		return JSON.stringify(value);
	}
	return String(value);
}

function text(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function noun(count: number, one: string, many: string): string {
	return count === 1 ? one : many;
}

function span(text: string, role: CardSpan["role"]): CardSpan {
	return { text, role };
}

/** The tool result's text as card lines; empty when there is no text. */
function outputLines(content: string | undefined): readonly (readonly CardSpan[])[] {
	if (content === undefined || content.length === 0) {
		return [];
	}
	const trimmed = content.endsWith("\n") ? content.slice(0, -1) : content;
	return trimmed
		.split("\n")
		.map((line) => [span(line, "toolOutput")]);
}
