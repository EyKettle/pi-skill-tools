/**
 * Presentation layer (plan Task 5). 5a primitives, 5b row projections,
 * 5c induced-failure fallbacks and rebuild-from-data.
 *
 * Sanitize untrusted text at the terminal-output boundary, measure width
 * with styling sequences stripped and East Asian width (delegated to
 * pi-tui), and bound semantic values before any theme role is applied.
 * Per-tool projections compose those primitives
 * into the row shapes in docs_zh-CN/tui-render.md. Stored semantic
 * data is never rewritten here.
 *
 * The module never claims a correlated failure — it receives a Failure
 * (via the transport FailurePayload) as an input. Tasks 6–11 own the
 * claim call site. Themed children are rebuilt from retained ProjectInput;
 * a component, invalidation, or malformed-model failure degrades to the
 * design's fixed wording instead of escaping.
 */

import type { Failure } from "./failure";
import type {
	CreateSkillData,
	FileRow,
	ListSkillFilesData,
	ListSkillTagsData,
	ListSkillsData,
	Scope,
	SearchSkillsData,
	SkillPosition,
	ToolName,
	TransportPayload,
	ViewSkillData,
} from "./transport";
import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import { sliceByColumn, visibleWidth } from "./deps/pi-tui";
import type { PiComponent } from "./deps/pi-tui";

/** Roles this module paints, taken from Pi's public `ThemeColor` union. */
export type ThemeRole = Extract<
	ThemeColor,
	| "accent"
	| "customMessageLabel"
	| "error"
	| "muted"
	| "success"
	| "toolOutput"
	| "toolTitle"
>;

/**
 * One projected display line. `text` is already sanitized; `role` is
 * applied later by the component builder via `theme.fg(role, text)`.
 * A null role is unstyled body text. Optional `spans` carry mixed roles
 * on one line (title + muted hint); paint prefers spans when present.
 */
export interface RowSpan {
	readonly text: string;
	readonly role: ThemeRole | null;
}

export interface RowLine {
	readonly text: string;
	readonly role: ThemeRole | null;
	readonly spans?: readonly RowSpan[];
	/** Content reaches the terminal whole so pi-tui can wrap it. Values omit this and are bounded before styling. */
	readonly wrap?: true;
}

export type RowPhase = "pending" | "collapsed" | "expanded";

export interface ProjectInput {
	tool: ToolName;
	phase: RowPhase;
	payload?: TransportPayload;
	args?: {
		id?: string;
		location?: SkillPosition;
		frontmatter?: Record<string, unknown>;
	};
	progress?: { lines: number; bytes: number };
	keyHint: (bindingKey: string, fallback: string) => string;
}

export interface ProjectedRow {
	readonly call: readonly RowLine[];
	readonly result: readonly RowLine[];
}

/** Structural mirror of pi's theme: the injected function triple. */
export interface ThemeLike {
	fg(role: string, text: string): string;
	bg(role: string, text: string): string;
	bold(text: string): string;
}

export interface ThemeFg {
	fg(role: ThemeRole, text: string): string;
}

export interface SlotComponents {
	Text: new (
		content: string,
		paddingX?: number,
		paddingY?: number,
	) => { render(width: number): string[] };
	Container: new () => {
		addChild(component: unknown): void;
		render(width: number): string[];
	};
}

/** Semantic presentation data, held apart from themed children. */
export interface RetainedPresentation {
	readonly input: ProjectInput;
}

/** A projected row plus the semantic input it was projected from. */
export interface PresentedRow extends PiComponent {
	readonly retained: RetainedPresentation;
}

/**
 * Wrap a width-driven render closure as the component this boundary hands to
 * pi. A projected row caches nothing between frames, so invalidation is a
 * no-op.
 */
export function renderedComponent(
	render: (width: number) => string[],
): PiComponent {
	return { render, invalidate() {} };
}

/**
 * Every reject category from terminal-display-safety.md. The gap at
 * U+200C–U+200D is deliberate: ZWNJ/ZWJ must survive for emoji clusters.
 */
const HAZARDS =
	/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u061c\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2060-\u206f\ufeff\ufdd0-\ufdef\ufffe\uffff]+/gu;

/** SGR sequences the program itself emitted (`ESC [ … m`). */
const SGR = /\x1b\[[0-9;]*m/g;

const EXPAND_BINDING = "app.tools.expand";

/** Detect SGR; reset lastIndex so a /g `.test` cannot skip the next call. */
function containsSgr(value: string): boolean {
	SGR.lastIndex = 0;
	const found = SGR.test(value);
	SGR.lastIndex = 0;
	return found;
}

/**
 * Replace each rejected run with one U+FFFD. Pure: the input string is
 * not mutated; callers keep stored semantic data as read.
 */
export function sanitizeDisplayText(text: string): string {
	return text.replace(HAZARDS, "\uFFFD");
}

/**
 * Visible column count via pi-tui (SGR stripped, East Asian width). Never use raw
 * string length on a styled line.
 */
export function visibleLength(line: string): number {
	return visibleWidth(line);
}

/**
 * Truncate an unstyled semantic value to `maxVisible` columns. A styled
 * line is returned unchanged — cutting mid-SGR leaves the terminal in
 * whatever state the partial sequence set. A negative cap is clamped to
 * zero. Truncation is by terminal columns, not UTF-16 length.
 */
export function boundDisplayValue(value: string, maxVisible: number): string {
	if (containsSgr(value)) {
		return value;
	}
	const cap = maxVisible < 0 ? 0 : maxVisible;
	if (visibleWidth(value) <= cap) {
		return value;
	}
	return sliceByColumn(value, 0, cap, true);
}

function display(text: string): string {
	return sanitizeDisplayText(text);
}

function span(text: string, role: ThemeRole | null): RowSpan {
	return { text, role };
}

function line(text: string, role: ThemeRole | null): RowLine {
	return { text, role, spans: [span(text, role)] };
}

function contentLine(text: string, role: ThemeRole | null): RowLine {
	return { ...line(text, role), wrap: true };
}

function spanned(...parts: readonly RowSpan[]): RowLine {
	return {
		text: parts.map((part) => part.text).join(""),
		role: parts[0]?.role ?? null,
		spans: parts,
	};
}

function blankLine(): RowLine {
	return line("", null);
}

function stripSgr(text: string): string {
	return text.replace(SGR, "");
}

function expandAffordance(
	keyHint: ProjectInput["keyHint"],
	fallback: string,
): RowSpan {
	const phrase = stripSgr(keyHint(EXPAND_BINDING, fallback));
	return span(` · ${phrase}`, "muted");
}

function positionLabel(location: SkillPosition): string {
	return location.charAt(0).toUpperCase() + location.slice(1);
}

function noun(count: number, singular: string, plural: string): string {
	return count === 1 ? singular : plural;
}

function skillPrefix(kind: "call" | "create" | "error"): RowSpan {
	if (kind === "create") {
		return span("[NewSkill] ", "success");
	}
	return kind === "error"
		? span("[Skill] ", "muted")
		: span("[Skill] ", "customMessageLabel");
}

function namedTitle(
	name: string,
	opts: {
		hint?: RowSpan;
		count?: number;
		location?: Scope;
	} = {},
): RowLine {
	const parts: RowSpan[] = [span(name, "toolTitle")];
	if (opts.hint !== undefined) {
		parts.push(opts.hint);
		return spanned(...parts);
	}
	if (opts.count !== undefined) {
		parts.push(span(" (", "muted"), span(String(opts.count), "muted"));
		if (opts.location) {
			parts.push(
				span(" in ", "muted"),
				span(positionLabel(opts.location), "toolTitle"),
			);
		}
		parts.push(span(")", "muted"));
	}
	return spanned(...parts);
}

/**
 * The tool name as a collapsed call row. The expand hint is drawn only
 * when expansion adds content beyond the answer already shown — a count
 * restatement like `(0)` does not count.
 */
function plainTitle(
	name: string,
	keyHint: ProjectInput["keyHint"],
	hasExtra: boolean,
): RowLine {
	return hasExtra
		? namedTitle(name, { hint: expandAffordance(keyHint, "to expand") })
		: namedTitle(name);
}

/**
 * An empty collection's collapsed row: the identity call plus the tool's
 * empty-state sentence, written here and in the expanded row alike.
 */
function emptyCollapse(call: RowLine, message: string): ProjectedRow {
	return both(call, [line(message, "toolOutput")]);
}

function listedResult(count: number, phrase: string, location: Scope): RowLine {
	const body =
		location === null
			? `listed ${count} ${phrase}`
			: `listed ${count} ${phrase} in ${positionLabel(location)}`;
	return line(body, "toolOutput");
}

function itemLine(id: string, path: string): RowLine {
	return line(`- ${display(id)} ${display(path)}`, "toolOutput");
}

function contentBody(content: string): RowLine[] {
	const trimmed = content.endsWith("\n") ? content.slice(0, -1) : content;
	if (trimmed.length === 0) {
		return [line("(empty file)", "toolOutput")];
	}
	return trimmed
		.split("\n")
		.map((row) => contentLine(display(row), "toolOutput"));
}

function filterLines(filters: Readonly<Record<string, unknown>>): RowLine[] {
	return Object.entries(filters).map(([key, value]) => {
		const rendered = typeof value === "string" ? value : JSON.stringify(value);
		return line(display(`${key}: ${rendered}`), "accent");
	});
}

function identityOf(input: ProjectInput): string {
	if (input.args?.id !== undefined) {
		return display(input.args.id);
	}
	const payload = input.payload;
	if (payload !== undefined && payload.outcome !== "failure") {
		const data = payload.data as { id?: string; targetId?: string };
		if (typeof data.id === "string") {
			return display(data.id);
		}
		if (typeof data.targetId === "string") {
			return display(data.targetId);
		}
	}
	return "";
}

function callOnly(call: RowLine): ProjectedRow {
	return { call: [call], result: [] };
}

function both(call: RowLine, result: readonly RowLine[]): ProjectedRow {
	return { call: [call], result };
}

function looksLikeFailure(
	payload: unknown,
): payload is { outcome: "failure"; failure: Failure } {
	return (
		typeof payload === "object" &&
		payload !== null &&
		(payload as { outcome?: unknown }).outcome === "failure"
	);
}

function projectUnknownFailure(tool: ToolName): ProjectedRow {
	return callOnly(
		spanned(
			span(tool, "toolTitle"),
			span(" · ", "toolTitle"),
			span("Tool execution failed", "error"),
		),
	);
}

function projectUnavailable(tool: ToolName): ProjectedRow {
	return callOnly(
		spanned(
			span(tool, "toolTitle"),
			span(" · ", "toolTitle"),
			span("Result details unavailable", "toolOutput"),
		),
	);
}

export function projectRow(input: ProjectInput): ProjectedRow {
	if (input.phase === "pending") {
		return projectPending(input);
	}
	const payload = input.payload;
	if (payload === undefined) {
		return projectUnavailable(input.tool);
	}
	if (payload.tool !== input.tool) {
		return looksLikeFailure(payload)
			? projectUnknownFailure(input.tool)
			: projectUnavailable(input.tool);
	}
	if (looksLikeFailure(payload)) {
		try {
			return projectFailure(input, payload.failure);
		} catch {
			return projectUnknownFailure(input.tool);
		}
	}
	try {
		return projectSuccess(input);
	} catch {
		return projectUnavailable(input.tool);
	}
}

function projectPending(input: ProjectInput): ProjectedRow {
	switch (input.tool) {
		case "list_skills":
		case "list_skill_tags":
		case "search_skills":
			return callOnly(line(input.tool, "toolTitle"));
		case "list_skill_files":
			return callOnly(
				spanned(skillPrefix("call"), span(identityOf(input), "toolTitle")),
			);
		case "create_skill": {
			const progress = input.progress ?? { lines: 0, bytes: 0 };
			const readout = ` (${progress.lines} ${noun(progress.lines, "line", "lines")} · ${progress.bytes} B)`;
			return callOnly(
				spanned(
					skillPrefix("create"),
					span(identityOf(input), "toolTitle"),
					span(readout, "toolTitle"),
				),
			);
		}
		case "view_skill": {
			const id = input.args?.id;
			if (id === undefined || id.length === 0) {
				return callOnly(line("view_skill", "toolTitle"));
			}
			return callOnly(
				spanned(skillPrefix("call"), span(display(id), "toolTitle")),
			);
		}
	}
}

function projectSuccess(input: ProjectInput): ProjectedRow {
	const payload = input.payload;
	if (payload === undefined || payload.outcome === "failure") {
		return projectUnavailable(input.tool);
	}
	switch (payload.tool) {
		case "list_skills":
			return projectListSkills(input.phase, payload.data, input.keyHint);
		case "list_skill_tags":
			return projectListSkillTags(input.phase, payload.data, input.keyHint);
		case "search_skills":
			return projectSearchSkills(input.phase, payload.data, input.keyHint);
		case "list_skill_files":
			return projectListSkillFiles(input.phase, payload.data, input.keyHint);
		case "create_skill":
			return projectCreateSkill(input.phase, payload.data, input.keyHint);
		case "view_skill":
			return projectViewSkill(input.phase, payload.data, input.keyHint);
	}
}

function projectListSkills(
	phase: RowPhase,
	data: ListSkillsData,
	keyHint: ProjectInput["keyHint"],
): ProjectedRow {
	if (phase === "expanded") {
		const items =
			data.skills.length === 0
				? [line("No skills found", "toolOutput")]
				: data.skills.map((row) => itemLine(row.id, row.filePath));
		return both(
			namedTitle("list_skills", {
				count: data.count,
				location: data.location,
			}),
			[blankLine(), ...items],
		);
	}
	if (data.count === 0) {
		return emptyCollapse(
			plainTitle("list_skills", keyHint, data.location !== null),
			"No skills found",
		);
	}
	return both(
		namedTitle("list_skills", {
			hint: expandAffordance(keyHint, "to expand"),
		}),
		[listedResult(data.count, noun(data.count, "skill", "skills"), data.location)],
	);
}

function projectListSkillTags(
	phase: RowPhase,
	data: ListSkillTagsData,
	keyHint: ProjectInput["keyHint"],
): ProjectedRow {
	if (phase === "expanded") {
		const items =
			data.tags.length === 0
				? [line("No tags found", "toolOutput")]
				: [contentLine(data.tags.map(display).join(", "), "toolOutput")];
		return both(
			namedTitle("list_skill_tags", {
				count: data.count,
				location: data.location,
			}),
			[blankLine(), ...items],
		);
	}
	if (data.count === 0) {
		return emptyCollapse(
			plainTitle("list_skill_tags", keyHint, data.location !== null),
			"No tags found",
		);
	}
	return both(
		namedTitle("list_skill_tags", {
			hint: expandAffordance(keyHint, "to expand"),
		}),
		[
			listedResult(
				data.count,
				noun(data.count, "skill tag", "skill tags"),
				data.location,
			),
		],
	);
}

function projectSearchSkills(
	phase: RowPhase,
	data: SearchSkillsData,
	keyHint: ProjectInput["keyHint"],
): ProjectedRow {
	if (phase === "expanded") {
		const filters = filterLines(data.filters);
		const items = data.matches.map((row) => itemLine(row.id, row.filePath));
		const result: RowLine[] = [blankLine(), ...filters];
		if (filters.length > 0) {
			result.push(blankLine());
		}
		if (items.length === 0) {
			result.push(line("No matches", "toolOutput"));
		} else {
			result.push(...items);
		}
		return both(
			namedTitle("search_skills", {
				count: data.count,
				location: data.location,
			}),
			result,
		);
	}
	if (data.count === 0) {
		const hasExtra =
			Object.keys(data.filters).length > 0 || data.location !== null;
		return emptyCollapse(
			plainTitle("search_skills", keyHint, hasExtra),
			"No matches",
		);
	}
	const matched = `matched ${data.count} ${noun(data.count, "skill", "skills")}${
		data.location === null ? "" : ` in ${positionLabel(data.location)}`
	}`;
	return both(
		namedTitle("search_skills", {
			hint: expandAffordance(keyHint, "to expand"),
		}),
		[line(matched, "toolOutput")],
	);
}

function projectListSkillFiles(
	phase: RowPhase,
	data: ListSkillFilesData,
	keyHint: ProjectInput["keyHint"],
): ProjectedRow {
	const id = display(data.targetId);
	if (phase === "expanded") {
		const items =
			data.files.length === 0
				? [line("No related files", "toolOutput")]
				: data.files.map((file: FileRow) => itemLine(file.refId, file.path));
		return both(
			spanned(
				skillPrefix("call"),
				span(id, "toolTitle"),
				span(" (", "muted"),
				span(String(data.count), "muted"),
				span(")", "muted"),
			),
			[blankLine(), ...items],
		);
	}
	if (data.count === 0) {
		return emptyCollapse(
			spanned(skillPrefix("call"), span(id, "toolTitle")),
			"No related files",
		);
	}
	return both(
		spanned(
			skillPrefix("call"),
			span(id, "toolTitle"),
			expandAffordance(keyHint, "to expand"),
		),
		[
			listedResult(
				data.count,
				noun(data.count, "related file", "related files"),
				null,
			),
		],
	);
}

function projectCreateSkill(
	phase: RowPhase,
	data: CreateSkillData,
	keyHint: ProjectInput["keyHint"],
): ProjectedRow {
	const id = display(data.id);
	if (phase === "expanded") {
		return both(
			spanned(
				skillPrefix("create"),
				span(id, "toolTitle"),
				span(" (", "muted"),
				span(display(data.path), "muted"),
				span(")", "muted"),
			),
			[
				blankLine(),
				...contentBody(data.content),
				blankLine(),
				line(
					`${data.lines} ${noun(data.lines, "line", "lines")} (${data.bytes}B) in total`,
					"toolOutput",
				),
			],
		);
	}
	return both(spanned(skillPrefix("create"), span(id, "toolTitle")), [
		spanned(
			span(
				`Wrote ${data.lines} ${noun(data.lines, "line", "lines")} (${data.bytes}B)`,
				"toolOutput",
			),
			expandAffordance(keyHint, "to expand"),
		),
	]);
}

function projectViewSkill(
	phase: RowPhase,
	data: ViewSkillData,
	keyHint: ProjectInput["keyHint"],
): ProjectedRow {
	const id = display(data.id);
	if (phase === "expanded") {
		return both(
			spanned(
				skillPrefix("call"),
				span(id, "toolTitle"),
				span(" (", "muted"),
				span(display(data.path), "muted"),
				span(")", "muted"),
			),
			[blankLine(), ...contentBody(data.content)],
		);
	}
	return callOnly(
		spanned(
			skillPrefix("call"),
			span(id, "toolTitle"),
			expandAffordance(keyHint, "to expand"),
		),
	);
}

function projectFailure(input: ProjectInput, failure: Failure): ProjectedRow {
	if (input.tool === "view_skill" && failure.code === "ID_NOT_FOUND") {
		return projectNotFound(input, failure);
	}
	if (input.tool === "view_skill" && failure.code === "ID_AMBIGUOUS") {
		return projectAmbiguous(input, failure);
	}
	if (
		input.tool === "create_skill" &&
		(failure.code === "CREATE_NAME_EXISTS" ||
			failure.code === "CREATE_TARGET_EXISTS")
	) {
		const name = identityOf(input);
		return callOnly(
			spanned(
				span("create_skill", "toolTitle"),
				span(" · ", "toolTitle"),
				span(name, "accent"),
				span(" already exists", "error"),
			),
		);
	}
	return projectUnknownFailure(input.tool);
}

/** Path-bearing candidates only; other evidence kinds fail closed as zero. */
function candidateCount(failure: Failure): number {
	if (failure.evidence.kind === "candidates") {
		return failure.evidence.candidates.length;
	}
	return 0;
}

function candidateItems(failure: Failure): RowLine[] {
	if (failure.evidence.kind === "candidates") {
		return failure.evidence.candidates.map((entry) =>
			itemLine(entry.id, entry.path),
		);
	}
	return [];
}

function projectNotFound(input: ProjectInput, failure: Failure): ProjectedRow {
	const id = identityOf(input);
	const title = spanned(
		skillPrefix("error"),
		span(id, "toolTitle"),
		span(" not found", "toolTitle"),
	);
	const n = candidateCount(failure);
	if (n === 0) {
		return callOnly(title);
	}
	if (input.phase === "expanded") {
		return both(title, [
			blankLine(),
			line(`${n} ${noun(n, "similar skill", "similar skills")}:`, "toolOutput"),
			blankLine(),
			...candidateItems(failure),
		]);
	}
	return both(title, [
		spanned(
			span(
				`Found ${n} ${noun(n, "similar skill", "similar skills")}`,
				"toolOutput",
			),
			expandAffordance(input.keyHint, "to show"),
		),
	]);
}

function projectAmbiguous(input: ProjectInput, failure: Failure): ProjectedRow {
	const id = identityOf(input);
	const title = spanned(
		skillPrefix("error"),
		span(id, "toolTitle"),
		span(" is ambiguous", "toolTitle"),
	);
	const n = candidateCount(failure);
	if (input.phase === "expanded") {
		return both(title, [
			blankLine(),
			line(`There's ${n} versions:`, "toolOutput"),
			blankLine(),
			...candidateItems(failure),
		]);
	}
	return both(title, [
		spanned(
			span(`${n} same skills in different position`, "toolOutput"),
			expandAffordance(input.keyHint, "to show"),
		),
	]);
}

function paintLine(row: RowLine, theme: ThemeFg): string {
	const parts = row.spans ?? [span(row.text, row.role)];
	return parts
		.map((part) => part.role === null ? part.text : theme.fg(part.role, part.text))
		.join("");
}

/**
 * Turn a projected row into real pi-tui components: call slot then result
 * slot, matching tool-execution.js updateDisplay() order. Blank separator
 * lines are leading `\n` in the result Text (empty Text renders no lines).
 */
export function paintProjectedRow(
	row: ProjectedRow,
	theme: ThemeFg,
	components: SlotComponents,
): { render(width: number): string[] } {
	const composed = new components.Container();
	if (row.call.length > 0) {
		composed.addChild(
			new components.Text(
				row.call.map((entry) => paintLine(entry, theme)).join("\n"),
				0,
				0,
			),
		);
	}
	if (row.result.length > 0) {
		composed.addChild(
			new components.Text(
				row.result.map((entry) => paintLine(entry, theme)).join("\n"),
				0,
				0,
			),
		);
	}
	return composed;
}

function boundRowLine(entry: RowLine, width: number): RowLine {
	if (entry.wrap === true) {
		return entry;
	}
	const parts = entry.spans ?? [span(entry.text, entry.role)];
	const full = parts.map((part) => part.text).join("");
	const bounded = boundDisplayValue(full, width);
	if (bounded === full) {
		return entry;
	}
	return spanned(span(bounded, parts[0]?.role ?? entry.role));
}

function boundRow(row: ProjectedRow, width: number): ProjectedRow {
	return {
		call: row.call.map((entry) => boundRowLine(entry, width)),
		result: row.result.map((entry) => boundRowLine(entry, width)),
	};
}

function unstyledLine(entry: RowLine): string {
	return (entry.spans ?? [span(entry.text, entry.role)])
		.map((part) => part.text)
		.join("");
}

function fallbackRow(input: ProjectInput): ProjectedRow {
	if (looksLikeFailure(input.payload)) {
		return projectUnknownFailure(input.tool);
	}
	return projectUnavailable(input.tool);
}

function widthSafePlain(
	row: ProjectedRow,
	width: number,
): PiComponent {
	const text = boundDisplayValue(
		sanitizeDisplayText(row.call.map(unstyledLine).join("\n")),
		width,
	);
	return renderedComponent(() => [text]);
}

function paintSafely(
	input: ProjectInput,
	theme: ThemeFg,
	components: SlotComponents,
): PiComponent {
	return renderedComponent((width) => {
		const row = boundRow(projectRow(input), width);
		try {
			return paintProjectedRow(row, theme, components).render(width);
		} catch {
			const fallback = boundRow(fallbackRow(input), width);
			try {
				return paintProjectedRow(fallback, theme, components).render(width);
			} catch {
				return widthSafePlain(fallback, width).render(width);
			}
		}
	});
}

export function retainPresentation(input: ProjectInput): RetainedPresentation {
	return { input };
}

export function presentRow(
	input: ProjectInput,
	theme: ThemeFg,
	components: SlotComponents,
): PresentedRow {
	const retained = retainPresentation(input);
	const painted = paintSafely(input, theme, components);
	return { retained, ...painted };
}

export function rebuildPresentation(
	retained: RetainedPresentation,
	theme: ThemeFg,
	components: SlotComponents,
): PiComponent {
	return paintSafely(retained.input, theme, components);
}
