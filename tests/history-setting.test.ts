/**
 * The history switch: `skills.history.enabled` read from disk (plan Task 4).
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { historyEnabled } from "../history-setting";

function settingsDir(content?: string): string {
	const dir = mkdtempSync(path.join(os.tmpdir(), "skill-tools-"));
	if (content !== undefined) {
		writeFileSync(path.join(dir, "settings.json"), content);
	}
	return dir;
}

describe("historyEnabled", () => {
	it("is on when the settings file is absent", () => {
		expect(historyEnabled(settingsDir())).toBe(true);
	});

	it("is on when the key is absent", () => {
		expect(historyEnabled(settingsDir(JSON.stringify({ skills: {} })))).toBe(true);
	});

	it("is off only for an explicit false", () => {
		const off = settingsDir(
			JSON.stringify({ skills: { history: { enabled: false } } }),
		);
		const on = settingsDir(
			JSON.stringify({ skills: { history: { enabled: true } } }),
		);

		expect(historyEnabled(off)).toBe(false);
		expect(historyEnabled(on)).toBe(true);
	});

	it("is on when the file is not JSON", () => {
		expect(historyEnabled(settingsDir("{not json"))).toBe(true);
	});

	it("is on when the value is not a boolean", () => {
		expect(
			historyEnabled(
				settingsDir(JSON.stringify({ skills: { history: { enabled: "no" } } })),
			),
		).toBe(true);
	});
});
