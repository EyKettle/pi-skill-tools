/**
 * Per-call failure correlation (plan Task 4).
 *
 * A structured failure is associated with exactly one tool call and
 * retrievable only by that call's own tool. Isolation is by call identity
 * (`toolCallId`), not tool name; a claim additionally requires an exact
 * tool-name match so no failure crosses a call boundary. The store is a
 * module-level singleton shared across the tool seam (associate on failure),
 * the renderers (claim on render — Task 5), and the entry point (release at
 * tool_execution_end, clear at session_shutdown).
 *
 * Fail closed: a second association for one unclaimed call leaves neither
 * failure retrievable; a claim by a non-owning call or tool discloses
 * nothing.
 */
import type { Failure } from "./failure";

/** One association: the owning tool name plus the structured failure. */
interface Association {
 toolName: string;
 failure: Failure;
}

/** callId → association. Singleton shared by seam, renderers, entry point. */
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
 * Claim the failure for the owning call and tool. Returns the failure only
 * when the call identity AND the tool name match exactly; any other caller
 * gets undefined. Idempotent-safe: repeated claims return the same failure;
 * the association is removed by `release`, not by claiming.
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
