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

export type CreateResult =
	| {
			readonly ok: true;
			readonly path: string;
			readonly bytes: number;
			readonly lines: number;
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
			/** Every file under the new directory, absolute. */
			readonly files: readonly string[];
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
