/**
 * The loaded set's value shapes: what is loaded, what a commit entry carries,
 * what the stored copy holds, and what the assembly reads from the world.
 */
import type { Index, RegistryEntry } from "../discovery/types";
import type { ChangeRow } from "../model-channel/output";
import type { Failure } from "../failure/types";

/** One loaded file: a skill's main document or one of its related files. */
export interface StateEntry {
	readonly id: string;
	readonly path: string;
	readonly body: string;
}

/** The loaded set in load order; a replaced entry keeps its slot. */
export type LoadedSet = readonly StateEntry[];

/** One block of a line-level replacement, in the old text's coordinates. */
export interface DiffBlock {
	/** 1-based line where the replaced range starts in the old text. */
	readonly start: number;
	/** How many old lines the block replaces. */
	readonly count: number;
	/** The text the block inserts; empty deletes the range. */
	readonly text: string;
}

/**
 * What a replacement carries: a line diff, or the whole body when the diff
 * aborts or would not come out smaller than the body.
 */
export type ReplacePayload =
	| { readonly kind: "diff"; readonly blocks: readonly DiffBlock[] }
	| { readonly kind: "body"; readonly body: string };

/** One operation of a change, as the commit table states it. */
export type CommitOperation =
	| { readonly kind: "load"; readonly entry: StateEntry }
	| {
			readonly kind: "replace";
			readonly id: string;
			readonly payload: ReplacePayload;
	  }
	| { readonly kind: "remove"; readonly id: string };

/** One appended entry: a change's whole effect, or a whole state. */
export type CommitEntry =
	| { readonly kind: "change"; readonly operations: readonly CommitOperation[] }
	| { readonly kind: "baseline"; readonly entries: LoadedSet };

/** A commit entry with the session entry id it was appended as. */
export interface PathCommit {
	readonly id: string;
	readonly entry: CommitEntry;
}

/** The copy's shape version; an unrecognized version decodes closed. */
export const COPY_VERSION = 1;

/** The stored copy: the state and the marker it was settled at. */
export interface StoredCopy {
	readonly version: typeof COPY_VERSION;
	/** The commit entry id the state was settled at; empty during a gap. */
	readonly marker: string;
	readonly entries: LoadedSet;
}

/** What the assembly reports to the human, once per reason. */
export type SkillTreeReport =
	| { readonly kind: "fold-aborted"; readonly error: string }
	| { readonly kind: "history-off" };

/** What a change did to one skill; the model text names it directly. */
export type ChangeOutcome = ChangeRow["action"];

/**
 * One row of a change's report: the display id and the action that happened.
 *
 * This is `model-channel`'s `ChangeRow` under the loaded set's own name, so
 * the tools render a change without translating between two shapes.
 */
export type ChangeReport = ChangeRow;

export type ChangeResult =
	| { readonly ok: true; readonly results: readonly ChangeReport[] }
	| { readonly ok: false; readonly failure: Failure };

/** A body the loader read, or the failure that stopped it. */
export type BodyRead =
	| {
			readonly ok: true;
			readonly path: string;
			readonly text: string;
	  }
	| { readonly ok: false; readonly failure: Failure };

/**
 * Everything the assembly needs from the world: the session tree's commit
 * path and leaf, the copy in session state, the mount registration, the
 * human reports, the current body, and the history switch.
 */
export interface SkillTreePorts {
	/** The stored copy, as the session state holds it; may be malformed. */
	readonly readCopy: () => unknown;
	/**
	 * Persist the copy. A refusal throws; the assembly swallows it, because
	 * memory and the log have already advanced.
	 */
	readonly writeCopy: (copy: StoredCopy) => void;
	/** The commit entries on the current path, root first. */
	readonly readPath: () => readonly PathCommit[];
	/** The current leaf's entry id. */
	readonly leafId: () => string;
	/** Append one commit entry to the session tree. */
	readonly appendEntry: (entry: CommitEntry) => void;
	/** Deliver the mount text to the segment's owner. */
	readonly registerSegment: (text: string) => void;
	readonly report: (report: SkillTreeReport) => void;
	readonly historyEnabled: () => boolean;
	/** Read a skill file, contained in its directory, whole. */
	readonly readBody: (entry: RegistryEntry, refPath?: string) => BodyRead;
}

/** The loaded set and the use cases the tools and commands share. */
export interface SkillTree {
	readonly state: LoadedSet;
	/** Settle against the session tree and publish the mount. */
	start(): void;
	/** Recompute after the session tree's leaf moved. */
	navigate(): void;
	importSkills(index: Index, ids: readonly string[]): ChangeResult;
	cancelSkills(index: Index, ids: readonly string[]): ChangeResult;
}
