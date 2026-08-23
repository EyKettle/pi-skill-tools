/**
 * Shared pi-styled TUI helpers for the six tools (design.md §5, §6).
 *
 * These helpers build **pi display** strings; they never import pi-tui so
 * they run standalone and stay unit-testable without a terminal — index.ts
 * owns component construction and injects the real theme through the
 * structural `ThemeLike`. Per-tool output builders live with their tool
 * definitions in `tools/` (e.g. `buildListOutput` in
 * `tools/list-skills.ts`).
 *
 * - `formatToolCallLine` — the tool-call row: `toolTitle` bold name, then
 *   `accent` arguments.
 * - `clampLines` — cap a collapsed result at 15 lines with pi's official
 *   overflow line (design.md §6.1, grep.js:58).
 * - `shortenPath` / `linkPath` — display-path shortening and OSC 8
 *   hyperlinks (design §6.2).
 */
import { pathToFileURL } from "node:url";

/** Structural mirror of pi's theme: an injected function triple (design §6). */
export interface ThemeLike {
	fg(role: string, text: string): string;
	bg(role: string, text: string): string;
	bold(text: string): string;
}

export interface ToolCallLineOptions {
	theme?: ThemeLike;
}

export interface ClampLineOptions {
	maxLines?: number;
	theme?: ThemeLike;
	keyHint?: (bindingKey: string, fallback: string) => string;
}

/** pi's binding-key for the "expand" action (dist/core/tools/grep.js:58). */
const EXPAND_KEY = "app.tools.expand";

/** pi's collapsed-result cap (design.md §6.1 mirrors grep.js:58). */
export const DEFAULT_MAX_OUTPUT_LINES = 15;

/** Theme passthrough: every role renders as its plain text. */
const plainTheme: ThemeLike = {
	fg: (_role, text) => text,
	bg: (_role, text) => text,
	bold: (text) => text,
};

/** Plain-text keyHint stub: echo the callers fallback description. */
function defaultKeyHint(_bindingKey: string, fallback: string): string {
	return fallback;
}

/**
 * Shorten a display path: the home directory becomes `~`. A sibling path
 * that merely *contains* the home string (e.g. `/home/me2/...`) is left
 * intact — the match must fall on a path-segment boundary (design §6.2,
 * reimplementation of pi's render-utils `shortenPath`).
 */
export function shortenPath(pathText: string, homeDir: string): string {
	if (homeDir === "/") {
		return pathText;
	}
	const home = homeDir.endsWith("/") ? homeDir.slice(0, -1) : homeDir;
	if (pathText === home) {
		return "~";
	}
	if (pathText.startsWith(`${home}/`)) {
		return `~${pathText.slice(home.length)}`;
	}
	return pathText;
}

/**
 * The tool-title slice of a tool-call row: the tool name bold, painted
 * with the `toolTitle` role.
 */
export function formatToolTitle(
	name: string,
	options: ToolCallLineOptions = {},
): string {
	const theme = options.theme ?? plainTheme;
	return theme.fg("toolTitle", theme.bold(name));
}

/**
 * The arguments slice of a tool-call row, painted with the `accent`
 * role; empty when `args` is empty.
 */
export function formatToolArgs(
	args: string,
	options: ToolCallLineOptions = {},
): string {
	if (args === "") {
		return "";
	}
	const theme = options.theme ?? plainTheme;
	return theme.fg("accent", args);
}

/**
 * Kind-colored prefix for skill-id titles. `call` paints `[Skill] ` with
 * `customMessageLabel`; `create` paints `[NewSkill] ` with `success`;
 * `query` paints `[SkillInfo] ` with `muted`.
 */
export function skillMarker(
	kind: "call" | "create" | "query",
	options: ToolCallLineOptions = {},
): string {
	const theme = options.theme ?? plainTheme;
	if (kind === "create") {
		return theme.fg("success", "[NewSkill] ");
	}
	return kind === "query"
		? theme.fg("muted", "[SkillInfo] ")
		: theme.fg("customMessageLabel", "[Skill] ");
}

/**
 * Retained for the tools that still render name+args on one line
 * (list_skills, list_skill_tags, view_skill, create_skill); new call rows
 * compose the primitives (formatToolTitle / formatToolArgs / skillMarker)
 * so layout — args on their own line — no longer forces the second
 * parameter to be skipped with undefined.
 */
export function formatToolCallLine(
	name: string,
	args?: string,
	options: ToolCallLineOptions = {},
): string {
	const renderedArgs =
		args === undefined || args === "" ? "" : formatToolArgs(args, options);
	const title = formatToolTitle(name, options);
	return renderedArgs === "" ? title : `${title} ${renderedArgs}`;
}

/**
 * Cap a collapsed result at `maxLines` (default 15). Up to the cap the
 * input is returned unchanged; beyond it the first 15 lines are kept and
 * pi's official overflow line is appended (design.md §6.1, grep.js:58):
 * `... ({n} more lines, {keyHint}...)`.
 */
export function clampLines(
	lines: readonly string[],
	options: ClampLineOptions = {},
): readonly string[] {
	const maxLines = options.maxLines ?? DEFAULT_MAX_OUTPUT_LINES;
	if (lines.length <= maxLines) {
		return lines;
	}
	const theme = options.theme ?? plainTheme;
	const keyHint = options.keyHint ?? defaultKeyHint;
	const remaining = lines.length - maxLines;
	const overflow =
		theme.fg("muted", `... (${remaining} more lines,`) +
		` ${keyHint(EXPAND_KEY, "to expand")}` +
		theme.fg("muted", ")");
	return [...lines.slice(0, maxLines), overflow];
}

/**
 * OSC 8 hyperlink around styled text; falls back to the plain `styled` text
 * when the terminal does not advertise hyperlink capability. The caller
 * (index.ts) injects pi-tui's `getCapabilities().hyperlinks`.
 */
export function linkPath(
	styled: string,
	absolutePath: string,
	supportsHyperlinks: boolean,
): string {
	if (!supportsHyperlinks) {
		return styled;
	}
	const href = pathToFileURL(absolutePath).href;
	return `\x1b]8;;${href}\x1b\\${styled}\x1b]8;;\x1b\\`;
}
