/**
 * Management's shapes: the ports the three write operations read, and the
 * results the two channels consume.
 */
import type { Index } from "../discovery/types";
import type { Failure } from "../failure/types";

/** A path resolved inside a skill directory, or the failure that stopped it. */
export type ResolvedPath =
	| { readonly ok: true; readonly path: string }
	| { readonly ok: false; readonly failure: Failure };

/**
 * What management needs from the world: the current index (locations and
 * entries), the configured default creation location, and the containment
 * rule for related-file references, which lives in `files/` and reaches this
 * module through the port.
 */
export interface ManagementPorts {
	readonly index: Index;
	readonly defaultLocation: string;
	/**
	 * Every regular file under a directory, absolute and sorted; links are
	 * not followed. The walk lives in `files/`, so a removal and a rename
	 * report the same list a listing would.
	 */
	readonly listFiles: (root: string) => Walked;
	/**
	 * Resolve a reference inside a skill directory.
	 *
	 * `PATH_NOT_FOUND` means containment passed and the target does not exist:
	 * that is the free path creation needs. Every other failure — an absolute
	 * reference, an escape, an unreadable target — is a refusal, and creation
	 * passes it through unchanged. The contract holds because `files/` checks
	 * containment before existence.
	 */
	readonly resolveRef: (
		baseDir: string,
		refPath: string,
	) => ResolvedPath;
}

/** The walk's result shape, as `files/` states it. */
export type Walked =
	| { readonly ok: true; readonly files: readonly string[] }
	| { readonly ok: false; readonly failure: Failure };

export type CreateResult =
	| {
			readonly ok: true;
			readonly path: string;
			readonly bytes: number;
	  }
	| { readonly ok: false; readonly failure: Failure };

export type RenameResult =
	| {
			readonly ok: true;
			readonly kind: "skill";
			/** The skill directory before the move. */
			readonly from: string;
			/** The skill directory after the move. */
			readonly to: string;
			/** Every file under the new directory, with the absolute path it moved from. */
			readonly files: readonly {
				readonly from: string;
				readonly to: string;
			}[];
	  }
	| {
			readonly ok: true;
			readonly kind: "file";
			readonly from: string;
			readonly to: string;
	  }
	| { readonly ok: false; readonly failure: Failure };

export type RemoveResult =
	| {
			readonly ok: true;
			readonly kind: "skill";
			/** The skill directory that was removed. */
			readonly path: string;
			/** Every file that was under it, absolute. */
			readonly files: readonly string[];
	  }
	| { readonly ok: true; readonly kind: "file"; readonly path: string }
	| { readonly ok: false; readonly failure: Failure };
