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

/** The host surface `installContextHooks` needs. */
export interface EventSource<C> {
	on(event: ContextEvent, handler: (ctx: C) => void): void;
}

/** Register the three context-only handlers on the host. */
export function installContextHooks<C>(
	source: EventSource<C>,
	handlers: ContextHandlers<C>,
): void {
	source.on("session_start", (ctx) => handlers.start(ctx));
	source.on("session_tree", (ctx) => handlers.navigate(ctx));
	source.on("session_shutdown", (ctx) => handlers.shutdown(ctx));
}

/** The guidance appended to every system prompt, on its own lines. */
export function appendGuidance(systemPrompt: string, guidance: string): string {
	if (systemPrompt.length === 0) {
		return guidance;
	}
	return `${systemPrompt}\n\n${guidance}`;
}
