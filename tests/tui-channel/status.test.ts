/**
 * The status bar's skill segment: its text, and its disappearance when the
 * loaded set empties.
 */
import { describe, expect, it } from "vitest";
import { renderStatus } from "../../src/tui-channel/status";

describe("renderStatus", () => {
	it("reports the loaded-set size", () => {
		expect(renderStatus(1)).toBe("Skills Loaded (1)");
		expect(renderStatus(7)).toBe("Skills Loaded (7)");
	});

	it("clears when nothing is loaded", () => {
		expect(renderStatus(0)).toBe("");
	});

	it("clears for a value that is not a loaded count", () => {
		expect(renderStatus(-1)).toBe("");
		expect(renderStatus(1.5)).toBe("");
		expect(renderStatus(Number.NaN)).toBe("");
	});
});
