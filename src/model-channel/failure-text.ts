/**
 * The model channel's failure text: the three-line frame.
 *
 * `Reason` is rendered from the evidence, one sentence per evidence kind, so a
 * new failure code that carries known evidence needs no new sentence here.
 * `Suggestion` is the code's recovery text — the same sentence the card and
 * the structured channel use.
 */
import type {
	EvidenceByCode,
	Failure,
	FailureEvidence,
	SectionCandidate,
	SectionSelector,
} from "../failure/types";

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
		case "locations": {
			const registered =
				evidence.locations.length === 0
					? "none"
					: evidence.locations.join(", ");
			if (evidence.disabled.length === 0) {
				return evidence.locations.length === 0
					? "No discovery location is registered."
					: `The location is not registered; registered locations: ${registered}.`;
			}
			return `The location is not registered or is disabled; registered locations: ${registered}; disabled locations: ${evidence.disabled.join(", ")}.`;
		}
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
			return sectionReason(evidence);
		case "sectionAmbiguous":
			return ambiguousReason(evidence);
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

/** The reason a selector reached no heading. */
function sectionReason(evidence: EvidenceByCode["SECTION_NOT_FOUND"]): string {
	if (evidence.selector.kind === "name") {
		return `The file "${evidence.path}" has no section "${evidence.selector.name}".`;
	}
	return `Line ${evidence.selector.line} of "${evidence.path}" is not a heading.`;
}

/** The reason a name reached several headings. */
function ambiguousReason(evidence: EvidenceByCode["SECTION_AMBIGUOUS"]): string {
	return `The name "${evidence.name}" matches ${evidence.candidates.length} headings in "${evidence.path}": ${candidateList(evidence.candidates)}.`;
}

/**
 * One line of a preview's warning list: the selector that reached no heading,
 * the code that says why, and the recovery that says what to do next. The
 * recovery is the code's own text, so the list and the failure frame cannot
 * drift apart.
 */
export function sectionIssueText(failure: Failure): string {
	const evidence = failure.evidence;
	switch (evidence.kind) {
		case "section":
			return `"${selectorLabel(evidence.selector)}": ${failure.code}; ${failure.recovery}`;
		case "sectionAmbiguous":
			return `"${evidence.name}": ${failure.code}; matches ${candidateList(evidence.candidates)}. ${failure.recovery}`;
		default:
			throw new Error(
				`failure '${failure.code}' carries no section evidence to report`,
			);
	}
}

/** The selector as the caller gave it: a name, or the line it named. */
function selectorLabel(selector: SectionSelector): string {
	return selector.kind === "name" ? selector.name : String(selector.line);
}

/** The candidate headings, with the lines they stand at. */
function candidateList(candidates: readonly SectionCandidate[]): string {
	return candidates
		.map((candidate) => `"${candidate.heading}" (${candidate.line})`)
		.join(", ");
}
