/**
 * Shared infra for the per-tool define modules (tools/*.ts): result shapes,
 * error framing, theme adaptation, and the structural `ToolDeps` the define
 * functions receive (assembled in index.ts from the dynamically imported
 * pi-runtime pieces).
 *
 * Pi-runtime packages resolve only under the pi loader (jiti), not vitest, so
 * nothing here imports @earendil-works/pi-* or typebox at module scope:
 * `ToolDeps` carries structural, minimal construction signatures so tool
 * files can `new deps.Text(...)` without pulling the pi packages in. Pure
 * helpers that only shape strings/objects stay here and are unit-testable
 * without a terminal.
 */
import type { PiComponent } from "../deps/pi-tui";
import type { ThemeLike } from "../presentation";
import type { Registry } from "../registry";
import { buildFailurePayload } from "../transport";
import type {
	FailurePayload,
	ToolName,
	TransportPayload,
	ViewSkillPayload,
} from "../transport";
import { createFailure } from "../failure";
import type { FailureCode, FailureEvidence } from "../failure";
import { associate } from "../correlation";

/** Tool result shape (pi's AgentToolResult with text content). */
export interface ToolTextResult {
	content: { type: "text"; text: string }[];
	details: Record<string, unknown>;
}

/** view_skill `details` consumed by its custom renderer. */
export interface ViewSkillDetails {
	name: string;
	storage: string;
	path: string;
	bytes: number;
	lines: number;
	/** Model-channel payload: wrapSkillBlock(...) of the file (or frontmatter). */
	content: string;
	/** Versioned transport payload for the TUI card (plan Task 3). */
	payload: ViewSkillPayload;
	/** Declared during execute; the renderer must not infer this from content. */
	format: "full" | "frontmatter";
}

/** `source` marker for the registry shadow scan (design §3.3). */
export const SHADOW_SCAN_SOURCE = "skill-tools-shadow-scan";

/**
 * The one seam source: model-facing text and structured failure in one
 * object. Both the thrown `error:` / `suggestions:` lines and the associated
 * `Failure` derive from this single object, so the two channels cannot
 * diverge. `recovery` is derived from `recoveryFor(code)` (failure.ts), not
 * from the suggestions line — the model channel keeps its byte-identical
 * text while the structured channel carries the vocabulary's recovery.
 */
export interface FailureSource {
	/** Model-channel `error:` line (byte-identical to today). */
	error: string;
	/** Model-channel `suggestions:` line (byte-identical to today). */
	suggestions: string;
	/** Closed vocabulary code (structured channel). */
	code: FailureCode;
	/** Typed evidence (structured channel). */
	evidence: FailureEvidence;
}

/**
 * The one seam: raises the structured failure (associates it with this call),
 * stashes the transport payload for the renderer, AND throws the model-facing
 * error from the SAME source object, so the two channels cannot diverge.
 * The Failure's recovery derives from `recoveryFor(code)`; the thrown message
 * keeps the `error:` / `suggestions:` framing byte-identical. Throw from
 * `execute` (extensions.md 1988): the message becomes `content[0].text` with
 * `isError: true`, and Pi discards `details` — the stash is the recoverable
 * payload after correlation.release() has already run.
 */
export function failError(
	toolCallId: string,
	toolName: ToolName,
	source: FailureSource,
): never {
	const failure = createFailure(source.code, { evidence: source.evidence });
	associate(toolCallId, toolName, failure);
	stashThrownFailure(
		toolCallId,
		toolName,
		buildFailurePayload(toolName, failure),
	);
	throw new Error(`error: ${source.error}\nsuggestions: ${source.suggestions}`);
}

/**
 * Adapt a domain error branch to the seam source. Every domain error branch
 * carries `code` + `evidence` alongside `error`; a missing pair is a
 * programming error (deny by default).
 */
export function failureSource(
	result: {
		error?: string;
		code?: FailureCode;
		evidence?: FailureEvidence;
	},
	suggestions: string,
): FailureSource {
	if (
		result.error === undefined ||
		result.code === undefined ||
		result.evidence === undefined
	) {
		throw new Error(`domain failure is missing its error/code/evidence triple`);
	}
	return {
		error: result.error,
		suggestions,
		code: result.code,
		evidence: result.evidence,
	};
}

/** Successful result text with structured details. */
export function textResult(
	text: string,
	details: Record<string, unknown>,
): ToolTextResult {
	return { content: [{ type: "text", text }], details };
}

/** Shared explicit empty-index guard for every read tool (plan Task 10 item 8). */
export function failEmptyIndex(toolCallId: string, toolName: ToolName): never {
	return failError(toolCallId, toolName, {
		error:
			"skill index is not yet populated; the before_agent_start cache has not captured any skills",
		suggestions:
			"restart pi or run /reload so the before_agent_start hook fires before the next prompt",
		code: "INDEX_EMPTY",
		evidence: { kind: "none" },
	});
}

/** One stashed throw: owning tool plus the transport payload the renderer needs. */
interface ThrownFailure {
	toolName: ToolName;
	payload: FailurePayload;
}

/** callId → thrown failure. Render-time authority; survives `release()`. */
const thrownFailures = new Map<string, ThrownFailure>();

/**
 * Record the payload this call threw. A second stash for the same call
 * overwrites: the store answers "what did this call throw?", so the latest
 * payload is what the renderer should paint. Correlation fail-closes on a
 * second `associate` because two unclaimed Failures make the association
 * ambiguous; that question does not apply here. One execute throws at most
 * once (`failError` is `never`); overwrite is the policy for a reused call
 * id (tests, or any later sequential throw of the same id).
 */
function stashThrownFailure(
	callId: string,
	toolName: ToolName,
	payload: FailurePayload,
): void {
	thrownFailures.set(callId, { toolName, payload });
}

/**
 * Recover the payload stashed on the throw path. Returns it only when the
 * call identity AND the tool name match exactly; any other caller gets
 * undefined. Does not consume the entry, so a redraw can recover again.
 * This is the render-time authority: it still works after `release()`.
 */
export function recoverThrownFailure(
	callId: string,
	toolName: ToolName,
): FailurePayload | undefined {
	const entry = thrownFailures.get(callId);
	if (entry === undefined || entry.toolName !== toolName) {
		return undefined;
	}
	return entry.payload;
}

/** Synthesis for an isError result that left no stashed payload. */
export function unknownFailurePayload(tool: ToolName): FailurePayload {
	return buildFailurePayload(
		tool,
		createFailure("ENTRY_UNREACHABLE", { evidence: { kind: "none" } }),
	);
}

/** Inputs a renderer has when recovering this call's transport payload. */
export interface CallPayloadSource {
	tool: ToolName;
	details: unknown;
	retained: TransportPayload | undefined;
	isError: boolean;
	toolCallId: string | undefined;
}

function payloadFromDetails(details: unknown): TransportPayload | undefined {
	if (typeof details !== "object" || details === null) {
		return undefined;
	}
	if (!("payload" in details)) {
		return undefined;
	}
	const payload = details.payload;
	if (typeof payload !== "object" || payload === null) {
		return undefined;
	}
	return payload as TransportPayload;
}

/**
 * Recover this call's transport payload for a renderer.
 *
 * Precedence: `details.payload`, then retained row state, then the
 * thrown-failure stash. Fresh details win: a redraw carries the same
 * details as the first paint, so details-first and state-first agree on
 * every documented call; five of six tools already used this order.
 * When `isError` and nothing was recovered, synthesize the unknown-failure
 * payload so a wiped throw still paints the known-error row.
 */
export function resolveCallPayload(
	source: CallPayloadSource,
): TransportPayload | undefined {
	const found =
		payloadFromDetails(source.details) ??
		source.retained ??
		(source.toolCallId === undefined
			? undefined
			: recoverThrownFailure(source.toolCallId, source.tool));
	if (found !== undefined) {
		return found;
	}
	if (source.isError) {
		return unknownFailurePayload(source.tool);
	}
	return undefined;
}

/** Drop every stashed payload (tests, and later session_shutdown). */
export function clearThrownFailures(): void {
	thrownFailures.clear();
}

/** Adapt pi's Theme instance to the structural ThemeLike the renderer takes. */
export function themeLike(theme: unknown): ThemeLike {
	const t = theme as ThemeLike;
	return {
		fg: (role, text) => t.fg(role, text),
		bg: (role, text) => t.bg(role, text),
		bold: (text) => t.bold(text),
	};
}

/** Compact, deterministic `key: value` summary of tool-call arguments. */
export function compactArgs(args: unknown): string {
	if (typeof args !== "object" || args === null) {
		return args === undefined ? "" : String(args);
	}
	return Object.entries(args as Record<string, unknown>)
		.map(([key, value]) => `${key}: ${compactArgValue(value)}`)
		.join(" ");
}

function compactArgValue(value: unknown): string {
	if (value === undefined) return "undefined";
	if (value === null) return "null";
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
}

export { countTextLines } from "../transport";

/* ---------------------------------------------------------------------- */
/* Structural pi-runtime contracts (ToolDeps)                              */
/* ---------------------------------------------------------------------- */

/** Minimal textual component: enough of pi-tui's Text to set text. */
export interface TextNode extends PiComponent {
	setText(text: string): void;
	setBgFn?(fn?: (text: string) => string): void;
}

/** Constructable pi-tui Text: new Text(content, padX, padY, bgFn). */
export interface TextCtor {
	new (
		content: string,
		paddingX?: number,
		paddingY?: number,
		bgFn?: (text: string) => string,
	): TextNode;
}

/** Minimal boxed component: children + dynamic background (Box has no setText). */
export interface BoxNode extends PiComponent {
	addChild(component: unknown): void;
	clear(): void;
	setBgFn?(fn?: (text: string) => string): void;
}

/** Constructable pi-tui Box: new Box(padX, padY, bgFn). */
export interface BoxCtor {
	new (
		paddingX?: number,
		paddingY?: number,
		bgFn?: (text: string) => string,
	): BoxNode;
}

/** Minimal container: children only (no background). */
export interface ContainerNode extends PiComponent {
	addChild(component: unknown): void;
	clear(): void;
}

/** Constructable pi-tui Container: new Container(). */
export interface ContainerCtor {
	new (): ContainerNode;
}

/**
 * Runtime resources a tool definition needs but that resolve only inside the
 * pi loader (dynamic imports in index.ts). The per-tool `define*` factories
 * receive this object and use the pieces they need, keeping module scope free
 * of pi-runtime imports so vitest can compile tools/*.
 */
export interface ToolDeps {
	/**
	 * Build the skill index for one tool call. index.ts wires the cache + scan
	 * + readFrontmatter and calls buildRegistry, so this returns the BUILT
	 * registry (entries/conflicts/indexEmpty/filter), not the build inputs.
	 */
	registryDeps(ctx: { cwd: string; isProjectTrusted(): boolean }): Registry;
	/** minimal TypeBox builder surface used by the tool schemas. */
	Type: {
		Union(schemas: unknown[]): unknown;
		Literal(value: string): unknown;
		Object(properties: Record<string, unknown>): unknown;
		Optional(schema: unknown): unknown;
		Boolean(desc?: object): unknown;
		String(desc?: object): unknown;
		Record(key: unknown, value: unknown, desc?: object): unknown;
		Unknown(desc?: object): unknown;
	};
	/** pi-tui Text component class. */
	Text: TextCtor;
	/** pi-tui Box component class. */
	Box: BoxCtor;
	/** pi-tui Container class (empty renderCall for view_skill). */
	Container: ContainerCtor;
	/** keyHint bound to pi's keybinding lookup, as a plain string fn. */
	expandKeyHint: (bindingKey: string, fallback: string) => string;
	/** pi's withFileMutationQueue(path, fn) (create_skill only). */
	withFileMutationQueue?: (
		path: string,
		fn: () => Promise<unknown>,
	) => Promise<unknown>;
}
