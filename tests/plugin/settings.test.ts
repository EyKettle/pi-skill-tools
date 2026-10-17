/**
 * `settings.ts`: the defaults, the two-file merge, and the type checks that
 * keep a bad value from stopping the extension.
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readSettings, resolveConfig } from "../../src/plugin/settings";
import type { SettingsInput } from "../../src/plugin/settings";

const tmpDirs: string[] = [];

afterAll(() => {
	for (const dir of tmpDirs) {
		rmSync(dir, { recursive: true, force: true });
	}
});

function input(): SettingsInput {
	const root = mkdtempSync(path.join(tmpdir(), "settings-"));
	tmpDirs.push(root);
	return {
		agentDir: path.join(root, "agent"),
		cwd: path.join(root, "project"),
		configDirName: ".pi",
	};
}

/** Write one settings file, making its directory. */
function write(file: string, value: unknown): void {
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(
		file,
		typeof value === "string" ? value : JSON.stringify(value),
	);
}

function globalFile(i: SettingsInput): string {
	return path.join(i.agentDir, "settings.json");
}

function projectFile(i: SettingsInput): string {
	return path.join(i.cwd, i.configDirName, "settings.json");
}

describe("resolveConfig", () => {
	it("takes the defaults when no settings file exists", () => {
		expect(resolveConfig(input())).toEqual({
			historyEnabled: true,
			disable: [],
			defaultLocation: "global",
			paths: {},
		});
	});

	it("reads the history switch", () => {
		const i = input();
		write(globalFile(i), { skills: { history: { enabled: false } } });
		expect(resolveConfig(i).historyEnabled).toBe(false);
	});

	it("reads disable, the default location, and the extra paths", () => {
		const i = input();
		write(globalFile(i), {
			skills: {
				registry: {
					disable: ["package", "temp"],
					default: "extra",
					paths: {
						extra: { writable: true, path: "/skills/extra" },
						borrow: { writable: false, path: "/skills/borrow" },
					},
				},
			},
		});

		expect(resolveConfig(i)).toEqual({
			historyEnabled: true,
			disable: ["package", "temp"],
			defaultLocation: "extra",
			paths: {
				extra: { writable: true, path: "/skills/extra" },
				borrow: { writable: false, path: "/skills/borrow" },
			},
		});
	});

	it("lets the project file win over the agent file", () => {
		const i = input();
		write(globalFile(i), {
			skills: {
				history: { enabled: false },
				registry: { default: "global", disable: ["package"] },
			},
		});
		write(projectFile(i), {
			skills: {
				history: { enabled: true },
				registry: { default: "project", disable: ["temp"] },
			},
		});

		const config = resolveConfig(i);

		expect(config.historyEnabled).toBe(true);
		expect(config.defaultLocation).toBe("project");
		expect(config.disable).toEqual(["temp"]);
	});

	it("takes the default for a value of the wrong type", () => {
		const i = input();
		write(globalFile(i), {
			skills: {
				history: { enabled: "no" },
				registry: {
					disable: "package",
					default: 7,
					paths: { extra: { writable: "yes", path: "/x" } },
				},
			},
		});

		expect(resolveConfig(i)).toEqual({
			historyEnabled: true,
			disable: [],
			defaultLocation: "global",
			paths: {},
		});
	});

	it("drops a configured path that does not name a writable pair", () => {
		const i = input();
		write(globalFile(i), {
			skills: {
				registry: {
					paths: {
						good: { writable: true, path: "/x" },
						noPath: { writable: true },
						noWritable: { path: "/y" },
						notAnObject: 42,
					},
				},
			},
		});

		expect(resolveConfig(i).paths).toEqual({
			good: { writable: true, path: "/x" },
		});
	});

	it("takes the defaults for an unparseable or non-object file", () => {
		const i = input();
		write(globalFile(i), "{not json");
		expect(resolveConfig(i).historyEnabled).toBe(true);

		write(globalFile(i), "[1, 2]");
		expect(resolveConfig(i).defaultLocation).toBe("global");
	});

	it("takes the default for an empty default location", () => {
		const i = input();
		write(globalFile(i), { skills: { registry: { default: "" } } });
		expect(resolveConfig(i).defaultLocation).toBe("global");
	});
});

describe("readSettings", () => {
	it("returns an empty record for a missing file", () => {
		const i = input();
		expect(readSettings(globalFile(i))).toEqual({});
	});

	it("returns the parsed object for a real file", () => {
		const i = input();
		write(globalFile(i), { skills: { history: { enabled: false } } });
		expect(readSettings(globalFile(i))).toEqual({
			skills: { history: { enabled: false } },
		});
	});
});
