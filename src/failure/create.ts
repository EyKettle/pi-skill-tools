/**
 * Failure construction: the only way a `Failure` comes into being.
 *
 * The code-to-evidence pairing is enforced by the type system; the shape of
 * the evidence is enforced here, because a `Details` payload is a runtime
 * boundary. An unexpected internal throw stays an exception — a `Failure` is
 * for an exception class the tools own.
 */
import { isFailureCode, recoveryFor } from "./codes";
import type {
	ConflictTarget,
	EvidenceByCode,
	Failure,
	FailureCode,
	FailureEvidence,
} from "./types";

/**
 * The message of an unknown thrown value. Node throws `Error` almost always,
 * but a caught value is `unknown`, so every caller that reports one needs the
 * same narrowing.
 */
export function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Thrown by `createFailure` when it refuses a malformed argument. */
export class FailureGuardError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "FailureGuardError";
	}
}

/**
 * Build a structured failure. The recovery is always the code's fixed text:
 * two channels read one sentence, so a caller cannot restate it differently.
 */
export function createFailure<C extends FailureCode>(
	code: C,
	evidence: EvidenceByCode[C],
): Failure<C> {
	if (!isFailureCode(code)) {
		throw new FailureGuardError(
			`unknown failure code '${String(code)}' is not in the closed set`,
		);
	}
	assertWellFormedEvidence(code, evidence);
	return { code, recovery: recoveryFor(code), evidence };
}

/** Reject evidence that does not carry what its kind promises. */
function assertWellFormedEvidence<C extends FailureCode>(
	code: C,
	evidence: EvidenceByCode[C],
): void {
	if (typeof evidence !== "object" || evidence === null) {
		throw new FailureGuardError(`failure '${code}' requires an evidence object`);
	}
	const value = evidence as FailureEvidence;
	switch (value.kind) {
		case "none":
			return;
		case "input":
			assertText(code, "input", value.input);
			return;
		case "locations":
			// No registered location is reachable: every built-in may be disabled.
			assertStrings(code, "locations", value.locations, 0);
			assertStrings(code, "disabled", value.disabled, 0);
			return;
		case "suggestions":
			// No suggestion is reachable: an empty index has no close name.
			assertStrings(code, "suggestions", value.names, 0);
			return;
		case "candidates":
			assertStrings(code, "candidates", value.ids, 1);
			return;
		case "path":
			assertText(code, "path", value.path);
			return;
		case "pathError":
			assertText(code, "path", value.path);
			assertText(code, "error", value.error);
			return;
		case "section":
			assertText(code, "path", value.path);
			assertSelector(code, value.selector);
			return;
		case "sectionAmbiguous":
			assertText(code, "path", value.path);
			assertSelector(code, { kind: "name", name: value.name });
			assertCandidates(code, value.candidates);
			return;
		case "filter":
			assertText(code, "key", value.key);
			assertText(code, "pattern", value.pattern);
			return;
		case "location":
			assertText(code, "location", value.location);
			return;
		case "loaded":
			assertText(code, "id", value.id);
			// An empty loaded list is the real case: nothing is loaded yet.
			assertStrings(code, "loaded", value.loaded, 0);
			return;
		case "conflict":
			assertConflictTarget(code, value.target);
			return;
		default:
			throw new FailureGuardError(
				`unsupported evidence kind '${String((value as { kind: unknown }).kind)}' for '${code}'`,
			);
	}
}

function assertText(code: FailureCode, field: string, value: unknown): void {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new FailureGuardError(
			`failure '${code}' requires a non-empty '${field}' evidence field`,
		);
	}
}

function assertStrings(
	code: FailureCode,
	field: string,
	values: unknown,
	minEntries: number,
): void {
	if (!Array.isArray(values)) {
		throw new FailureGuardError(
			`failure '${code}' requires '${field}' to be a list`,
		);
	}
	if (values.length < minEntries) {
		throw new FailureGuardError(
			`failure '${code}' requires '${field}' to hold at least ${minEntries} entr${minEntries === 1 ? "y" : "ies"}`,
		);
	}
	for (const entry of values) {
		assertText(code, field, entry);
	}
}

function assertSelector(code: FailureCode, selector: unknown): void {
	if (typeof selector !== "object" || selector === null) {
		throw new FailureGuardError(`failure '${code}' requires a section selector`);
	}
	const value = selector as { kind?: unknown; name?: unknown; line?: unknown };
	if (value.kind === "name") {
		if (typeof value.name !== "string") {
			throw new FailureGuardError(
				`failure '${code}' requires a section selector with a string name`,
			);
		}
		return;
	}
	if (value.kind === "line") {
		if (typeof value.line !== "number" || !Number.isFinite(value.line)) {
			throw new FailureGuardError(
				`failure '${code}' requires a section selector with a finite numeric line`,
			);
		}
		return;
	}
	throw new FailureGuardError(
		`failure '${code}' requires a section selector of kind 'name' or 'line'`,
	);
}

function assertCandidates(code: FailureCode, candidates: unknown): void {
	if (!Array.isArray(candidates)) {
		throw new FailureGuardError(`failure '${code}' requires 'candidates' to be a list`);
	}
	if (candidates.length === 0) {
		throw new FailureGuardError(
			`failure '${code}' requires 'candidates' to hold at least one entry`,
		);
	}
	for (const candidate of candidates) {
		if (typeof candidate !== "object" || candidate === null) {
			throw new FailureGuardError(`failure '${code}' requires a candidate object`);
		}
		const value = candidate as { heading?: unknown; line?: unknown };
		assertText(code, "candidate heading", value.heading);
		if (typeof value.line !== "number" || !Number.isInteger(value.line)) {
			throw new FailureGuardError(
				`failure '${code}' requires a candidate with an integer line`,
			);
		}
	}
}

function assertConflictTarget(code: FailureCode, target: ConflictTarget): void {
	const kind = (target as { kind?: unknown } | null)?.kind;
	switch (kind) {
		case "id":
			assertText(code, "conflict id", (target as { id?: unknown }).id);
			return;
		case "path":
			assertText(code, "conflict path", (target as { path?: unknown }).path);
			return;
		default:
			throw new FailureGuardError(
				`failure '${code}' requires a conflict target of kind 'id' or 'path'`,
			);
	}
}
