/**
 * The status bar's skill segment.
 *
 * The segment reports the loaded set's size and disappears when nothing is
 * loaded: a cleared tree leaves no text behind, so the bar cannot keep saying
 * a skill is loaded after it was cancelled.
 */

/** The segment's text for a loaded-set size; empty when nothing is loaded. */
export function renderStatus(loadedCount: number): string {
	if (!Number.isInteger(loadedCount) || loadedCount <= 0) {
		return "";
	}
	return `Skills Loaded (${loadedCount})`;
}
