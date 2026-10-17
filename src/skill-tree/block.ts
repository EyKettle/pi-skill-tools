/**
 * The mount text: one `<SKILL/>` block per loaded entry, in load order.
 *
 * The block is the loaded body's only reader in the prompt: the id addresses
 * the entry, the path is where it was read from, and the body rides verbatim.
 * Blocks sit on consecutive lines — a blank line between them would read as
 * part of the previous skill.
 */
import type { LoadedSet, StateEntry } from "./types";

/** The mount text for a state; empty for an empty set. */
export function renderMount(state: LoadedSet): string {
	return state.map(renderBlock).join("\n");
}

function renderBlock(entry: StateEntry): string {
	const content = entry.body.endsWith("\n")
		? entry.body.slice(0, -1)
		: entry.body;
	return `<SKILL id="${entry.id}" path="${entry.path}">\n${content}\n</SKILL>`;
}
