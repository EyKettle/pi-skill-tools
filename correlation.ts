/**
 * Per-call failure correlation (plan Task 4).
 *
 * Execute-time store of structured `Failure` values. A failure is associated
 * with exactly one tool call and retrievable only by that call's own tool.
 * Isolation is by call identity (`toolCallId`); a claim additionally requires
 * an exact tool-name match so no failure crosses a call boundary.
 *
 * This store is not the render-time path. Pi dispatches `tool_execution_end`
 * (which calls `release`) before the UI paints, so a renderer that `claim`s
 * always sees an empty store. The render-time authority is the thrown-failure
 * stash in `tools/shared.ts` (`recoverThrownFailure`): it holds a
 * `FailurePayload` and is cleared on `session_shutdown`, not on release.
 * `claim` remains the reader of THIS store — tests, and any execute-time
 * consumer that runs before release. Production renderers do not call it.
 *
 * Collision: a second `associate` for one unclaimed call deletes the entry
 * so neither failure remains retrievable. Two unclaimed Failures for one
 * call is a programming error; fail-closed is the only honest answer to
 * "which unique Failure belongs to this call?". The stash answers a
 * different question ("what payload did this call throw?") and overwrites;
 * the two policies legitimately differ. See `stashThrownFailure`.
 *
 * Lifecycle: associate on failure, release at `tool_execution_end`, clear at
 * `session_shutdown`.
 */
import type { Failure } from "./failure";

/** One association: the owning tool name plus the structured failure. */
interface Association {
 toolName: string;
 failure: Failure;
}

/** callId → association. Execute-time singleton; renderers do not read it. */
const store = new Map<string, Association>();

/**
 * Associate a structured failure with its originating call. A second
 * association for one unclaimed call is a collision: the entry is cleared so
 * neither failure remains retrievable.
 */
export function associate(
 callId: string,
 toolName: string,
 failure: Failure,
): void {
 if (store.has(callId)) {
  store.delete(callId);
  return;
 }
 store.set(callId, { toolName, failure });
}

/**
 * Read the failure for the owning call and tool. Returns the failure only
 * when the call identity AND the tool name match exactly; any other caller
 * gets undefined. Idempotent-safe: repeated claims return the same failure;
 * the association is removed by `release`, not by claiming.
 *
 * Not the render-time path — `release` has already run by the time a
 * renderer paints. Renderers call `recoverThrownFailure`.
 */
export function claim(callId: string, toolName: string): Failure | undefined {
 const entry = store.get(callId);
 if (entry === undefined || entry.toolName !== toolName) {
  return undefined;
 }
 return entry.failure;
}

/** Release the association when the tool execution ends. */
export function release(callId: string): void {
 store.delete(callId);
}

/** Clear every association at session shutdown. */
export function clear(): void {
 store.clear();
}
