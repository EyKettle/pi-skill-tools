/**
 * The superseded session assembly, kept only until Task 12 removes it.
 *
 * It used to live in `index.ts`; the entry now wires `src/plugin/`, so the
 * assembly had to move out of the entry's way to keep its own tests running
 * for one more step. Nothing new should call it.
 */
import { diffText } from "./delta";
import { cancel, EMPTY_SET, encode, load, tryDecode } from "./state";
import type {
	CancelFailure,
	EncodedState,
	LoadFailure,
	LoadedSet,
	LoadOutcome,
	StateEntry,
} from "./state";
import { copyIsCurrent, fold } from "./log";
import type { CommitEntry, CommitOperation } from "./log";
import { renderSkillBlock } from "./skill-block";
import { historyEnabled } from "./history-setting";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { FailureCode, FailureEvidence } from "./failure";

export const COMMIT_ENTRY_TYPE = "skill-tools-commit";

/** The stored copy: the state and the marker it was settled at. */
export interface StoredCopy {
	marker?: string;
	state: EncodedState;
}

/** One commit entry with the session entry id it was appended as. */
export interface PathCommit {
	id: string;
	entry: CommitEntry;
}

/** A history-layer report reason; each reports once per session. */
export type ReportReason =
	| "fold-aborted"
	| "baseline-after-gap"
	| "no-log-coverage"
	| "history-off";

/** What the assembly reads and drives; the default export wires it to Pi. */
export interface AssemblyPorts {
	store: {
		read(ctx: ExtensionContext): unknown;
		write(ctx: ExtensionContext, value: StoredCopy): void;
	};
	historyEnabled(): boolean;
	pathCommits(ctx: ExtensionContext, fromId?: string | null): PathCommit[];
	leafId(ctx: ExtensionContext): string | undefined;
	appendCommit(entry: CommitEntry): void;
	registerSegment(text: string): void;
	conflictNames(): ReadonlySet<string>;
	notify(ctx: ExtensionContext, message: string): void;
}

/** One change: entries to load and ids to cancel. */
export interface SkillChangeRequest {
	loads?: readonly StateEntry[];
	cancels?: readonly string[];
}

export type ChangeResult =
	| { ok: true; outcomes: readonly LoadOutcome[]; removed: readonly StateEntry[] }
	| {
			ok: false;
			loadFailures: readonly LoadFailure[];
			cancelFailures: readonly CancelFailure[];
	  };

export interface SkillStateAssembly {
	start(ctx: ExtensionContext): void;
	navigate(ctx: ExtensionContext, newLeafId: string | null): void;
	change(ctx: ExtensionContext, request: SkillChangeRequest): ChangeResult;
	ready(): void;
	shutdown(): void;
	current(): LoadedSet;
}

/** The operations a change lands as, in the commit table's terms. */
function operationsOf(
	previous: LoadedSet,
	loads: readonly StateEntry[],
	outcomes: readonly LoadOutcome[],
	removed: readonly StateEntry[],
): CommitOperation[] {
	const operations: CommitOperation[] = [];
	const working: StateEntry[] = [...previous.entries];
	loads.forEach((entry, index) => {
		const outcome = outcomes[index];
		if (outcome === "added") {
			operations.push({ kind: "load", entry });
			working.push(entry);
			return;
		}
		if (outcome === "replaced") {
			const at = working.findIndex((existing) => existing.id === entry.id);
			operations.push({
				kind: "replace",
				id: entry.id,
				hunks: diffText(working[at].body, entry.body),
			});
			working[at] = entry;
		}
	});
	for (const entry of removed) {
		operations.push({ kind: "remove", id: entry.id });
	}
	return operations;
}

/** The copy a stored value carries, or undefined when it is not one. */
function decodeCopy(
	value: unknown,
): { marker: string | undefined; state: LoadedSet } | undefined {
	if (typeof value !== "object" || value === null) {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	if (record.marker !== undefined && typeof record.marker !== "string") {
		return undefined;
	}
	const state = tryDecode(record.state);
	if (state === undefined) {
		return undefined;
	}
	return { marker: record.marker, state };
}

/**
 * The session assembly: the loaded set in memory, its commit log on the
 * session tree, its copy in session-state, and its one segment on
 * tail-prompt. The write order is log first, copy second, republish third; a
 * refused copy write leaves memory and the log advanced.
 */
export function createAssembly(ports: AssemblyPorts): SkillStateAssembly {
	let state: LoadedSet = EMPTY_SET;
	let gapPending = false;
	const reported = new Set<ReportReason>();

	function notifyOnce(
		ctx: ExtensionContext,
		reason: ReportReason,
		message: string,
	): void {
		if (reported.has(reason)) {
			return;
		}
		reported.add(reason);
		ports.notify(ctx, message);
	}

	function writeCopy(
		ctx: ExtensionContext,
		next: LoadedSet,
		marker: string | undefined,
	): void {
		try {
			ports.store.write(ctx, { marker, state: encode(next) });
		} catch {
			// Memory and the log have advanced; the next successful write repairs.
		}
	}

	function republish(): void {
		ports.registerSegment(renderSkillBlock(state, ports.conflictNames()));
	}

	function start(ctx: ExtensionContext): void {
		const path = ports.pathCommits(ctx);
		const copy = decodeCopy(ports.store.read(ctx));
		const lastId = path.at(-1)?.id;
		if (copy !== undefined && copy.marker === undefined) {
			gapPending = true;
		}
		if (copy !== undefined && copyIsCurrent(copy, lastId)) {
			state = copy.state;
		} else {
			const folded = fold(path.map((commit) => commit.entry));
			if (folded.ok) {
				state = folded.state;
				writeCopy(ctx, state, lastId);
			} else {
				state = copy?.state ?? EMPTY_SET;
				notifyOnce(
					ctx,
					"fold-aborted",
					`skill-tools: the commit log could not be folded (${folded.error}); using the stored copy.`,
				);
			}
		}
		if (path.length === 0 && copy !== undefined) {
			notifyOnce(
				ctx,
				"no-log-coverage",
				"skill-tools: this path has no commit log; the loaded set rests on the stored copy.",
			);
		}
		republish();
	}

	function navigate(ctx: ExtensionContext, newLeafId: string | null): void {
		const path = ports.pathCommits(ctx, newLeafId);
		const folded = fold(path.map((commit) => commit.entry));
		if (folded.ok) {
			state = folded.state;
			writeCopy(ctx, state, path.at(-1)?.id);
		} else {
			const copy = decodeCopy(ports.store.read(ctx));
			state = copy?.state ?? state;
			notifyOnce(
				ctx,
				"fold-aborted",
				`skill-tools: the commit log could not be folded (${folded.error}); using the stored copy.`,
			);
		}
		republish();
	}

	function change(
		ctx: ExtensionContext,
		request: SkillChangeRequest,
	): ChangeResult {
		const loads = request.loads ?? [];
		const cancels = request.cancels ?? [];
		const loaded = load(state, loads);
		if (!loaded.ok) {
			return { ok: false, loadFailures: loaded.failures, cancelFailures: [] };
		}
		const cancelled = cancel(loaded.set, cancels);
		if (!cancelled.ok) {
			return { ok: false, loadFailures: [], cancelFailures: cancelled.failures };
		}
		const next = cancelled.set;
		const operations = operationsOf(state, loads, loaded.outcomes, cancelled.removed);
		if (operations.length === 0) {
			return { ok: true, outcomes: loaded.outcomes, removed: cancelled.removed };
		}
		if (ports.historyEnabled()) {
			if (gapPending) {
				ports.appendCommit({ kind: "baseline", entries: next.entries });
				gapPending = false;
				notifyOnce(
					ctx,
					"baseline-after-gap",
					"skill-tools: history recording resumed; the first commit entry is a baseline.",
				);
			} else {
				ports.appendCommit({ kind: "delta", operations });
			}
			writeCopy(ctx, next, ports.leafId(ctx));
		} else {
			writeCopy(ctx, next, undefined);
			gapPending = true;
			notifyOnce(
				ctx,
				"history-off",
				"skill-tools: history recording is off; changes are not entering the commit log.",
			);
		}
		state = next;
		republish();
		return { ok: true, outcomes: loaded.outcomes, removed: cancelled.removed };
	}

	function ready(): void {
		republish();
	}

	function shutdown(): void {
		state = EMPTY_SET;
		gapPending = false;
		reported.clear();
	}

	return {
		start,
		navigate,
		change,
		ready,
		shutdown,
		current: () => state,
	};
}
