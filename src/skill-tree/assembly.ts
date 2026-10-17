/**
 * The session assembly: the loaded set in memory, its commit log on the
 * session tree, its copy in session state, and its one mount segment.
 *
 * The write order is log first, copy second, republish third. A refused copy
 * write leaves memory and the log advanced; the next successful write closes
 * the gap. While the history switch is off nothing is appended, the copy's
 * marker is cleared, and the copy alone governs; the first entry after the
 * switch returns is a baseline.
 *
 * `importSkills` and `cancelSkills` are the only load/cancel use case: the
 * tools and the commands both call them. A batch is atomic — every identity
 * resolves and every body reads before the first change lands.
 */
import {
	displaySkillId,
	formatSkillId,
	parseSkillId,
	resolveSkillId,
} from "../discovery/skill-id";
import type { Index } from "../discovery/types";
import { createFailure } from "../failure/create";
import { renderMount } from "./block";
import { buildReplacement } from "./delta";
import { fold } from "./log";
import {
	cascadeTargets,
	decodeCopy,
	distinctLocations,
	encodeCopy,
	loadEntry,
	removeIds,
} from "./state";
import type {
	ChangeReport,
	ChangeResult,
	CommitEntry,
	CommitOperation,
	LoadedSet,
	PathCommit,
	SkillTree,
	SkillTreePorts,
	StateEntry,
} from "./types";

export function createSkillTree(ports: SkillTreePorts): SkillTree {
	let state: LoadedSet = [];
	/** A gap means the log does not cover the copy; the copy governs. */
	let gap = false;
	let historyOffReported = false;
	const reported = new Set<string>();

	function publish(): void {
		ports.registerSegment(renderMount(state));
	}

	function writeCopy(next: LoadedSet, marker: string): void {
		try {
			ports.writeCopy(encodeCopy(next, marker));
		} catch {
			// Memory and the log have advanced; the next successful write repairs.
		}
	}

	function reportFoldAborted(error: string): void {
		if (reported.has("fold-aborted")) {
			return;
		}
		reported.add("fold-aborted");
		ports.report({ kind: "fold-aborted", error });
	}

	function reportHistoryOff(): void {
		if (historyOffReported) {
			return;
		}
		historyOffReported = true;
		ports.report({ kind: "history-off" });
	}

	function lastId(path: readonly PathCommit[]): string {
		return path.at(-1)?.id ?? "";
	}

	function foldedOrEmpty(path: readonly PathCommit[]): LoadedSet {
		const folded = fold(path.map((commit) => commit.entry));
		if (folded.ok) {
			return folded.state;
		}
		reportFoldAborted(folded.error);
		return [];
	}

	/**
	 * Settle against the session tree. `start` may trust a copy whose marker
	 * names the path's last entry; `navigate` always folds to the new leaf.
	 */
	function settle(mode: "start" | "navigate"): void {
		const path = ports.readPath();
		const copy = decodeCopy(ports.readCopy());

		if (!ports.historyEnabled()) {
			gap = true;
			if (copy !== undefined) {
				state = copy.entries;
				if (copy.marker !== "") {
					writeCopy(state, "");
				}
			} else {
				state = foldedOrEmpty(path);
			}
			publish();
			return;
		}

		// A cleared marker over a non-empty path is a gap from an earlier
		// session: the copy holds what the log never recorded.
		if (copy !== undefined && copy.marker === "" && path.length > 0) {
			gap = true;
			state = copy.entries;
			publish();
			return;
		}

		if (gap) {
			if (copy !== undefined) {
				state = copy.entries;
			}
			publish();
			return;
		}

		if (mode === "start" && path.length === 0) {
			state = copy?.entries ?? [];
			publish();
			return;
		}

		const baselinePresent = path.some(
			(commit) => commit.entry.kind === "baseline",
		);
		if (
			mode === "start" &&
			copy !== undefined &&
			!baselinePresent &&
			copy.marker === lastId(path)
		) {
			state = copy.entries;
			publish();
			return;
		}

		const folded = fold(path.map((commit) => commit.entry));
		if (folded.ok) {
			state = folded.state;
			writeCopy(state, lastId(path));
		} else {
			state = copy?.entries ?? state;
			reportFoldAborted(folded.error);
		}
		publish();
	}

	/**
	 * Land a change: append the entry (or the baseline a gap needs), write the
	 * copy, then republish. Nothing is appended while history is off.
	 */
	function commit(
		next: LoadedSet,
		operations: readonly CommitOperation[],
		results: readonly ChangeReport[],
	): ChangeResult {
		if (operations.length === 0) {
			return { ok: true, results };
		}
		if (ports.historyEnabled()) {
			if (gap) {
				ports.appendEntry({ kind: "baseline", entries: next });
				gap = false;
				historyOffReported = false;
			} else {
				ports.appendEntry({ kind: "change", operations });
			}
			writeCopy(next, ports.leafId());
		} else {
			gap = true;
			writeCopy(next, "");
			reportHistoryOff();
		}
		state = next;
		publish();
		return { ok: true, results };
	}

	function importSkills(index: Index, ids: readonly string[]): ChangeResult {
		if (ids.length === 0) {
			return emptyBatch();
		}

		// Resolve and read every identity before the first change lands: a
		// batch is atomic.
		const planned: Array<{
			id: string;
			displayId: string;
			path: string;
			text: string;
		}> = [];
		for (const raw of ids) {
			const resolved = resolveSkillId(index, raw);
			if (!resolved.ok) {
				return { ok: false, failure: resolved.failure };
			}
			const body = ports.readBody(resolved.entry, resolved.refPath);
			if (!body.ok) {
				return { ok: false, failure: body.failure };
			}
			planned.push({
				id: formatSkillId(
					resolved.entry.location,
					resolved.entry.name,
					resolved.refPath,
				),
				displayId: displaySkillId(
					index,
					resolved.entry,
					resolved.refPath,
				),
				path: body.path,
				text: body.text,
			});
		}

		let next = state;
		const operations: CommitOperation[] = [];
		const results: ChangeReport[] = [];
		for (const item of planned) {
			const before = next.find((entry) => entry.id === item.id);
			const entry: StateEntry = {
				id: item.id,
				path: item.path,
				body: item.text,
			};
			const loaded = loadEntry(next, entry);
			next = loaded.state;
			results.push({ displayId: item.displayId, action: loaded.outcome });
			if (loaded.outcome === "Loaded") {
				operations.push({ kind: "load", entry });
			} else if (loaded.outcome === "Refreshed" && before !== undefined) {
				operations.push({
					kind: "replace",
					id: item.id,
					payload: buildReplacement(before.body, item.text),
				});
			}
		}
		return commit(next, operations, results);
	}

	function cancelSkills(index: Index, ids: readonly string[]): ChangeResult {
		if (ids.length === 0) {
			return emptyBatch();
		}
		const locations = index.locations.map((location) => location.id);
		const doomed = new Set<string>();
		const results: ChangeReport[] = [];
		for (const raw of ids) {
			const parsed = parseSkillId(raw, locations);
			if (!parsed.ok) {
				return { ok: false, failure: parsed.failure };
			}
			const matches = cascadeTargets(state, parsed.value);
			if (matches.length === 0) {
				return {
					ok: false,
					failure: createFailure("NOT_LOADED", {
						kind: "loaded",
						id: raw,
						loaded: state.map((entry) => entry.id),
					}),
				};
			}
			if (
				parsed.value.location === undefined &&
				distinctLocations(matches).length > 1
			) {
				return {
					ok: false,
					failure: createFailure("ID_AMBIGUOUS", {
						kind: "candidates",
						ids: distinctLocations(matches).map((location) =>
							formatSkillId(location, parsed.value.name),
						),
					}),
				};
			}
			const location = distinctLocations(matches)[0];
			for (const match of matches) {
				doomed.add(match.id);
			}
			results.push({
				displayId: displaySkillId(
					index,
					{ location, name: parsed.value.name },
					parsed.value.refPath,
				),
				action: "Unloaded",
			});
		}

		const removed = state.filter((entry) => doomed.has(entry.id));
		const next = removeIds(state, [...doomed]);
		const operations: CommitOperation[] = removed.map((entry) => ({
			kind: "remove",
			id: entry.id,
		}));
		return commit(next, operations, results);
	}

	return {
		get state() {
			return state;
		},
		start: () => settle("start"),
		navigate: () => settle("navigate"),
		importSkills,
		cancelSkills,
	};
}

function emptyBatch(): ChangeResult {
	return {
		ok: false,
		failure: createFailure("BATCH_EMPTY", { kind: "none" }),
	};
}
