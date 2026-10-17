/**
 * Frontmatter: the leading YAML block, dotted-path lookup, and the search
 * filter grammar.
 *
 * This is the only file in the tree that imports `js-yaml`. Parsing is
 * fail-closed — a malformed block reads as "no frontmatter" — because a bad
 * document must not take the index down with it. Filter compilation is the
 * one place a user-supplied pattern can fail, and that failure is a `Failure`
 * (`FILTER_INVALID`) rather than a throw.
 */
import yaml from "js-yaml";
import { createFailure } from "../failure/create";
import type { Failure } from "../failure/types";

export interface ParsedFrontmatter {
	readonly data: Record<string, unknown>;
	readonly raw?: string;
	readonly bodyStart: number;
}

/** Parse a leading `---`-delimited YAML block; fail-closed to empty data. */
export function parseFrontmatterBlock(text: string): ParsedFrontmatter {
	const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
	if (lines.length < 3 || lines[0] !== "---") {
		return { data: {}, bodyStart: 0 };
	}

	let closeIndex = -1;
	for (let i = 1; i < lines.length; i++) {
		if (lines[i] === "---") {
			closeIndex = i;
			break;
		}
	}
	if (closeIndex === -1) {
		return { data: {}, bodyStart: 0 };
	}

	const parsed = parseYaml(lines.slice(1, closeIndex).join("\n"));
	if (!isRecord(parsed)) {
		return { data: {}, bodyStart: 0 };
	}

	let bodyStart = 0;
	for (let i = 0; i <= closeIndex; i++) {
		bodyStart += lines[i].length + 1; // +1 for the line break
	}
	return {
		data: parsed,
		raw: lines.slice(0, closeIndex + 1).join("\n"),
		bodyStart,
	};
}

/** Walk a dotted path through plain objects; `undefined` on any miss. */
export function getByPath(
	data: Record<string, unknown>,
	path: string,
): unknown {
	let current: unknown = data;
	for (const segment of path.split(".")) {
		if (!isRecord(current) || !Object.hasOwn(current, segment)) {
			return undefined;
		}
		current = current[segment];
	}
	return current;
}

/** One filter key's value, as the tool's parameter schema states it. */
export type FilterValue = string | readonly string[];

/** One compiled clause: a substring test, or a compiled pattern. */
export type CompiledClause =
	| { readonly key: string; readonly needles: readonly string[] }
	| { readonly key: string; readonly pattern: RegExp };

export type CompiledFilter = readonly CompiledClause[];

export type FilterCompilation =
	| { readonly ok: true; readonly value: CompiledFilter }
	| { readonly ok: false; readonly failure: Failure };

/**
 * Validate and compile a filter once, so matching an entry cannot fail.
 *
 * A value of the form `/pattern/` is a regular expression; any other string
 * is a substring; a list holds substrings, any one of which suffices. The
 * `//` delimiters are the only way to ask for a pattern, so a value that
 * merely contains a slash stays a literal.
 */
export function compileFilter(
	filters: Readonly<Record<string, FilterValue>>,
): FilterCompilation {
	const clauses: CompiledClause[] = [];
	for (const [key, value] of Object.entries(filters)) {
		if (typeof value !== "string") {
			clauses.push({ key, needles: value.map(String) });
			continue;
		}
		const source = regexSource(value);
		if (source === undefined) {
			clauses.push({ key, needles: [value] });
			continue;
		}
		try {
			clauses.push({ key, pattern: new RegExp(source) });
		} catch {
			return {
				ok: false,
				failure: createFailure("FILTER_INVALID", {
					kind: "filter",
					key,
					pattern: source,
				}),
			};
		}
	}
	return { ok: true, value: clauses };
}

/**
 * Match one document's frontmatter against a compiled filter. Keys are ANDed;
 * a missing key matches nothing, and so does a value that is not a scalar.
 */
export function matchesFrontmatter(
	data: Record<string, unknown>,
	filter: CompiledFilter,
): boolean {
	for (const clause of filter) {
		const value = getByPath(data, clause.key);
		if (value === undefined) {
			return false;
		}
		const values = scalarStrings(value);
		if ("pattern" in clause) {
			if (!values.some((text) => clause.pattern.test(text))) {
				return false;
			}
			continue;
		}
		if (clause.needles.length === 0) {
			return false;
		}
		if (
			!values.some((text) =>
				clause.needles.some((needle) => text.includes(needle)),
			)
		) {
			return false;
		}
	}
	return true;
}

const loadOptions = {
	// The core schema keeps YAML tags (!!js/...) out of reach; depth and alias
	// amplification stay bounded by js-yaml's own limits.
	schema: yaml.CORE_SCHEMA,
} as yaml.LoadOptions;

function parseYaml(text: string): unknown {
	try {
		return yaml.load(text, loadOptions);
	} catch {
		return undefined; // fail closed: invalid YAML is "no frontmatter"
	}
}

/** The source between `/` delimiters, or undefined for a plain string. */
function regexSource(value: string): string | undefined {
	if (value.length >= 2 && value.startsWith("/") && value.endsWith("/")) {
		return value.slice(1, -1);
	}
	return undefined;
}

/** The strings a document value offers to a filter: array elements, or itself. */
function scalarStrings(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.flatMap(scalarStrings);
	}
	if (typeof value === "string") {
		return [value];
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return [String(value)];
	}
	return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
