/**
 * The model channel's failure text: the three-line frame.
 *
 * `Reason` is rendered from the evidence, one sentence per evidence kind, so a
 * new failure code that carries known evidence needs no new sentence here.
 * `Suggestion` is the code's recovery text — the same sentence the card and
 * the structured channel use.
 */
import type { Failure, FailureEvidence } from "../failure/types";

/** The failure frame: code, reason, and the next step. */
export function failureText(failure: Failure): string {
	return [
		`ErrorCode: ${failure.code}`,
		`Reason: ${reasonText(failure.evidence)}`,
		`Suggestion: ${failure.recovery}`,
	].join("\n");
}

/** One sentence per evidence kind; the incident's own facts live here. */
export function reasonText(evidence: FailureEvidence): string {
	switch (evidence.kind) {
		case "none":
			return "No further detail was recorded.";
		case "input":
			return `The input "${evidence.input}" is not usable.`;
		case "locations":
			return evidence.locations.length === 0
				? "No discovery location is registered."
				: `The location is not registered; registered locations: ${evidence.locations.join(", ")}.`;
		case "suggestions":
			return evidence.names.length === 0
				? "No skill matches, and no close name exists."
				: `No skill matches; the closest names are: ${evidence.names.join(", ")}.`;
		case "candidates":
			return `Several skills match: ${evidence.ids.join(", ")}.`;
		case "path":
			return `The path "${evidence.path}" cannot be read as requested.`;
		case "pathError":
			return `The path "${evidence.path}" failed: ${evidence.error}`;
		case "section":
			return `The file "${evidence.path}" has no section "${evidence.section}".`;
		case "filter":
			return `The filter "${evidence.key}" has an invalid pattern: ${evidence.pattern}`;
		case "loaded":
			return evidence.loaded.length === 0
				? `"${evidence.id}" is not loaded, and nothing is loaded.`
				: `"${evidence.id}" is not loaded; loaded now: ${evidence.loaded.join(", ")}.`;
		case "location":
			return `The location "${evidence.location}" is read-only.`;
		case "conflict":
			return evidence.target.kind === "id"
				? `"${evidence.target.id}" already exists.`
				: `"${evidence.target.path}" already exists.`;
	}
}
