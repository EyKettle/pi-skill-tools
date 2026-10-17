/**
 * Shape predicates shared across modules.
 *
 * A predicate here answers a question about a value's shape and nothing else:
 * no imports, no policy, no domain meaning. Two modules that both read
 * untrusted JSON need the same answer, and this file is where it is written
 * once.
 */

/** Whether `value` is a plain object: not null, not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
