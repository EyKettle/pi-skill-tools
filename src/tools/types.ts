/**
 * The tool layer's shapes.
 *
 * A tool result is the object the host hands back: the model text, the card
 * payload, and the error flag. `content` is what the model reads and what the
 * card shows as `{output}`; `details` is what the card prints as `{answer}`
 * and `{info}`.
 *
 * `ToolDeps` is the whole external surface a tool may touch: the index
 * snapshot, the loaded tree, and the management ports. Domain modules arrive
 * by import — a tool composes them, it does not own them.
 */
import type { Index } from "../discovery/types";
import type { Failure } from "../failure/types";
import type { ManagementPorts } from "../management/types";
import { failureText } from "../model-channel/failure-text";
import { buildFailurePayload } from "../tui-channel/payload";
import type { ToolName, TransportPayload } from "../tui-channel/types";
import type { SkillTree } from "../skill-tree/types";

export interface ToolDeps {
	/** The current index; the plugin rebuilds it before each call. */
	readonly index: () => Index;
	/** The loaded set and its shared load/cancel use case. */
	readonly tree: SkillTree;
	/** The write ports, closed over the same index the call sees. */
	readonly management: () => ManagementPorts;
}

export interface ToolOutcome {
	readonly content: string;
	readonly details: TransportPayload;
	readonly isError: boolean;
}

/** A successful result: both channels state the same facts. */
export function successOutcome(
	content: string,
	details: TransportPayload,
): ToolOutcome {
	return { content, details, isError: false };
}

/**
 * A failure rendered onto both channels from one `Failure`: the model reads
 * the three-line frame, the card reads the same code and recovery.
 */
export function failureOutcome(
	tool: ToolName,
	failure: Failure,
): ToolOutcome {
	return {
		content: failureText(failure),
		details: buildFailurePayload(tool, failure),
		isError: true,
	};
}
