/**
 * The session events that carry only a context, and which act each performs.
 *
 * A wrong event name is dead in the host without a diagnostic, so the names
 * live here with a test. `before_agent_start` is not among them: its handler
 * reads the prompt the host already built, so it is registered in the plugin,
 * where the event type is real.
 */

/** The events whose handler needs nothing but the context. */
export type ContextEvent = "session_start" | "session_tree" | "session_shutdown";

export interface ContextHandlers<C> {
	/** Settle the loaded set against the session tree. */
	readonly start: (ctx: C) => void;
	/** Recompute after the tree's leaf moved. */
	readonly navigate: (ctx: C) => void;
	/** Drop every piece of per-session state. */
	readonly shutdown: (ctx: C) => void;
}

/**
 * The host surface `installContextHooks` needs.
 *
 * The host calls a handler as `(event, ctx)` for every event, so the shape
 * states both parameters and the installer takes the second. A one-parameter
 * handler would receive the event and use it as the context.
 */
export interface EventSource<C> {
	on(event: ContextEvent, handler: (event: unknown, ctx: C) => void): void;
}

/** Register the three context-only handlers on the host. */
export function installContextHooks<C>(
	source: EventSource<C>,
	handlers: ContextHandlers<C>,
): void {
	source.on("session_start", (_event, ctx) => handlers.start(ctx));
	source.on("session_tree", (_event, ctx) => handlers.navigate(ctx));
	source.on("session_shutdown", (_event, ctx) => handlers.shutdown(ctx));
}

/**
 * `existing` with `guidance` after it, on its own lines. Used on a prompt
 * section, not on a whole prompt: the host appends the section itself.
 */
export function appendGuidance(existing: string, guidance: string): string {
	if (existing.length === 0) {
		return guidance;
	}
	return `${existing}\n\n${guidance}`;
}
