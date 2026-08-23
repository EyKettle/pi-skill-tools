/**
 * YAML frontmatter parsing, filtering, and serialization for skill files.
 *
 * Pure-fabrication module: the ONLY module allowed to import js-yaml in this
 * extension (design §10, review finding R2-1). Fail-closed by design — any
 * parse problem yields `{}`, any filter miss yields `false`, never an
 * exception. Filter semantics follow markdown-tools/frontmatter.ts with one
 * contract extension: filter keys accept dotted paths (`metadata.tags`) and a
 * scalar filter matches array values by membership (design §5.3, plan Task 4).
 * `dumpFrontmatter` is the single js-yaml `dump` call site, serving
 * `create_skill` (Task 8).
 */

import yaml from "js-yaml";

/** Parse a leading `---`-delimited YAML block; fail-closed to `{data: {}}`. */
export function parseFrontmatterBlock(text: string): {
	data: Record<string, unknown>;
	raw?: string;
	bodyStart: number;
} {
	const lines = splitLines(text);
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

	const data = parseYaml(lines.slice(1, closeIndex).join("\n"));
	if (!isRecord(data)) {
		return { data: {}, bodyStart: 0 };
	}

	const raw = lines.slice(0, closeIndex + 1).join("\n");
	let bodyStart = 0;
	for (let i = 0; i <= closeIndex; i++) {
		bodyStart += lines[i].length + 1; // +1 for the line break
	}
	return { data, raw, bodyStart };
}

/** Walk a dotted path through plain objects; `undefined` on any miss. */
export function getByPath(
	data: Record<string, unknown>,
	path: string,
): unknown {
	let current: unknown = data;
	for (const segment of path.split(".")) {
		if (!isRecord(current)) return undefined;
		if (!Object.hasOwn(current, segment)) return undefined;
		current = current[segment];
	}
	return current;
}

/**
 * Match frontmatter data against a filter record. Keys accept dotted paths.
 * All keys must pass (AND). Fail-closed: missing key → false; malformed
 * value (nested record filter) → false; empty array filter → false.
 */
export function matchesFrontmatter(
	data: Record<string, unknown>,
	filters: Record<string, unknown>,
): boolean {
	for (const [key, filterValue] of Object.entries(filters)) {
		const docValue = getByPath(data, key);
		if (docValue === undefined) return false;
		if (!matchesValue(docValue, filterValue)) return false;
	}
	return true;
}

/** One element of a matched frontmatter value under a filter key. */
export interface FrontmatterMatch {
	value: string;
	matched: boolean;
}

/**
 * Read the document value under `path` into per-element match entries, so
 * `search_skills` can show the complete value with the matched items marked.
 * `undefined` → `[]`. An array document value yields one entry per element
 * (doc order), each matched against `filterValue` via the `matchesValue`
 * semantics; a scalar document value yields a single matched entry.
 */
export function matchedValues(
	data: Record<string, unknown>,
	path: string,
	filterValue: unknown,
): FrontmatterMatch[] {
	const docValue = getByPath(data, path);
	if (docValue === undefined) return [];
	if (Array.isArray(docValue)) {
		return docValue.map((element) => ({
			value: stringify(element),
			matched: matchesValue(element, filterValue),
		}));
	}
	return [{ value: stringify(docValue), matched: true }];
}

/**
 * Serialize a frontmatter record for `create_skill`. Top-level scalar keys
 * become `key: value` lines; nested objects / arrays are dumped via js-yaml
 * so structure is preserved. Every emitted string scalar re-parses to the
 * exact original string — plain when provably unambiguous, JSON-quoted
 * otherwise (JSON quoting is valid YAML double-quoted style). With `keys`,
 * only those keys are emitted, in caller order; without it, all keys.
 */
export function dumpFrontmatter(
	data: Record<string, unknown>,
	options: { keys?: string[] } = {},
): string {
	const lines: string[] = [];
	const keys = options.keys ?? Object.keys(data);
	for (const key of keys) {
		if (!Object.hasOwn(data, key)) continue;
		const value = data[key];
		if (isPlain(value)) {
			lines.push(`${key}: ${formatScalar(value)}`);
		} else {
			lines.push(yaml.dump({ [key]: value }, dumpOptions).trimEnd());
		}
	}
	return `---\n${lines.join("\n")}\n---\n`;
}

// ---------------------------------------------------------------------------
// helpers

const loadOptions = {
	// js-yaml 4 implements no maxAliasCount option (absent from loader.js).
	// Amplification is bounded by shared-node alias resolution (an alias reuses
	// the anchor node, never a re-expanded copy) and the maxDepth default of 100.
	schema: yaml.CORE_SCHEMA,
} as yaml.LoadOptions;

const dumpOptions = {
	schema: yaml.CORE_SCHEMA,
} as yaml.DumpOptions;

function splitLines(text: string): string[] {
	return text.replace(/^\uFEFF/, "").split(/\r?\n/);
}

function parseYaml(text: string): unknown {
	try {
		return yaml.load(text, loadOptions);
	} catch {
		return undefined; // fail closed: invalid YAML is "no frontmatter"
	}
}

function isPlain(
	value: unknown,
): value is string | number | boolean | null | undefined {
	return (
		value === null ||
		value === undefined ||
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatScalar(
	value: string | number | boolean | null | undefined,
): string {
	if (typeof value === "string") {
		// A string is emitted plain only when parsing `key: <value>` provably
		// returns that exact string; otherwise it is JSON-quoted (a valid YAML
		// double-quoted scalar). This covers sequence/mapping prefixes ("- ",
		// "? "), YAML type look-alikes ("123", "true", "null"), multiline
		// values, and `: ` — all of which previously broke re-parsing.
		if (canEmitPlain(value)) return value;
		return JSON.stringify(value);
	}
	if (value === null) return "null";
	return String(value);
}

function canEmitPlain(value: string): boolean {
	// Probe the exact scalar position `key: <value>` and require the parsed
	// value to round-trip with string identity, so type drift (number/bool/
	// null) and broken YAML ("- foo", "? x", multiline) both force quoting.
	try {
		const parsed = yaml.load(`k: ${value}`, loadOptions) as unknown;
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			Array.isArray(parsed)
		) {
			return false;
		}
		return (parsed as Record<string, unknown>)["k"] === value;
	} catch {
		return false;
	}
}

function matchesValue(docValue: unknown, filterValue: unknown): boolean {
	if (Array.isArray(filterValue)) {
		// Filter is an array.
		if (filterValue.length === 0) return false; // empty filter → miss
		if (Array.isArray(docValue)) {
			return arraysIntersect(docValue, filterValue);
		}
		// scalar document value: membership in the filter array
		return filterValue.some((item) => stringify(docValue) === stringify(item));
	}
	if (Array.isArray(docValue)) {
		// scalar filter against an array document value → membership
		return docValue.some((item) => stringify(item) === stringify(filterValue));
	}
	if (isRecord(filterValue)) return false; // nested filters unsupported
	return stringify(docValue) === stringify(filterValue);
}

function arraysIntersect(
	docValues: unknown[],
	filterValues: unknown[],
): boolean {
	const filterStrings = new Set(filterValues.map(stringify));
	return docValues.some((value) => filterStrings.has(stringify(value)));
}

function stringify(value: unknown): string {
	// String() normalizes scalar types (42 vs "42"); JSON.stringify would
	// add quotes and defeat the purpose.
	return String(value);
}
