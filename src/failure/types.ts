/**
 * The failure vocabulary's shapes.
 *
 * A failure is data, not an exception: a code from the closed set, the fixed
 * recovery text that code owns, and typed evidence. Evidence is
 * machine-readable — the card and the structured channel read it — never a
 * preformatted sentence.
 */

/** The closed set's members; `codes.ts` owns the values. */
export type FailureCode =
	| "ID_NAME_INVALID"
	| "ID_LOCATION_UNKNOWN"
	| "ID_NOT_FOUND"
	| "ID_AMBIGUOUS"
	| "REF_PATH_INVALID"
	| "PATH_NOT_FOUND"
	| "READ_FAILED"
	| "FILE_NOT_TEXT"
	| "SECTION_NOT_FOUND"
	| "FILTER_INVALID"
	| "BATCH_EMPTY"
	| "NOT_LOADED"
	| "LOCATION_READ_ONLY"
	| "TARGET_EXISTS"
	| "WRITE_FAILED";

/** The object a management conflict collides with. */
export type ConflictTarget =
	| { readonly kind: "id"; readonly id: string }
	| { readonly kind: "path"; readonly path: string };

/**
 * The evidence shape each code carries, one row per code in the architecture
 * table. The map is the mechanism that keeps a code from carrying another
 * code's evidence: `createFailure` accepts only the row of the code given.
 */
export interface EvidenceByCode {
	ID_NAME_INVALID: { readonly kind: "input"; readonly input: string };
	ID_LOCATION_UNKNOWN: {
		readonly kind: "locations";
		readonly locations: readonly string[];
	};
	ID_NOT_FOUND: {
		readonly kind: "suggestions";
		readonly names: readonly string[];
	};
	ID_AMBIGUOUS: {
		readonly kind: "candidates";
		readonly ids: readonly string[];
	};
	REF_PATH_INVALID: { readonly kind: "input"; readonly input: string };
	PATH_NOT_FOUND: { readonly kind: "path"; readonly path: string };
	READ_FAILED: {
		readonly kind: "pathError";
		readonly path: string;
		readonly error: string;
	};
	FILE_NOT_TEXT: { readonly kind: "path"; readonly path: string };
	SECTION_NOT_FOUND: {
		readonly kind: "section";
		readonly section: string;
		readonly path: string;
	};
	FILTER_INVALID: {
		readonly kind: "filter";
		readonly key: string;
		readonly pattern: string;
	};
	BATCH_EMPTY: { readonly kind: "none" };
	NOT_LOADED: {
		readonly kind: "loaded";
		readonly id: string;
		readonly loaded: readonly string[];
	};
	LOCATION_READ_ONLY: { readonly kind: "location"; readonly location: string };
	TARGET_EXISTS: {
		readonly kind: "conflict";
		readonly target: ConflictTarget;
	};
	WRITE_FAILED: {
		readonly kind: "pathError";
		readonly path: string;
		readonly error: string;
	};
}

/** Every evidence shape, as the union of the per-code rows. */
export type FailureEvidence = EvidenceByCode[FailureCode];

/** A structured failure: its code, that code's recovery, its evidence. */
export interface Failure<C extends FailureCode = FailureCode> {
	readonly code: C;
	readonly recovery: string;
	readonly evidence: EvidenceByCode[C];
}
