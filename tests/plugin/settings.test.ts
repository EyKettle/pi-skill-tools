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
			skillTreeEnabled: true,
			historyEnabled: true,
			disable: [],
			defaultLocation: "global",
			paths: {},
		});
	});

	it.each([
		{ label: "false", value: false, expected: false },
		{ label: "true", value: true, expected: true },
		{ label: "false string", value: "false", expected: true },
		{ label: "true string", value: "true", expected: true },
		{ label: "zero", value: 0, expected: true },
		{ label: "one", value: 1, expected: true },
		{ label: "null", value: null, expected: true },
		{ label: "array", value: [false], expected: true },
		{ label: "object", value: { enabled: false }, expected: true },
		{ label: "missing", value: undefined, expected: true },
	] as const)("validates the skill-tree switch: $label", ({ value, expected }) => {
		const i = input();
		write(globalFile(i), { skills: { skillTree: { enabled: value } } });
		expect(resolveConfig(i).skillTreeEnabled).toBe(expected);
	});

	it.each([
		{
			label: "project disables",
			agent: true,
			project: { skills: { skillTree: { enabled: false } } },
			expected: false,
		},
		{
			label: "project enables",
			agent: false,
			project: { skills: { skillTree: { enabled: true } } },
			expected: true,
		},
		{
			label: "project supplies a missing agent value",
			agent: undefined,
			project: { skills: { skillTree: { enabled: false } } },
			expected: false,
		},
		{
			label: "project overrides an invalid agent value",
			agent: "false",
			project: { skills: { skillTree: { enabled: false } } },
			expected: false,
		},
		{
			label: "project omits enabled",
			agent: false,
			project: { skills: { skillTree: {} } },
			expected: false,
		},
		{
			label: "project changes another section",
			agent: false,
			project: { skills: { history: { enabled: false } } },
			expected: false,
		},
		{
			label: "project enabled is a string",
			agent: false,
			project: { skills: { skillTree: { enabled: "false" } } },
			expected: true,
		},
		{
			label: "project enabled is null",
			agent: false,
			project: { skills: { skillTree: { enabled: null } } },
			expected: true,
		},
		{
			label: "project skillTree is null",
			agent: false,
			project: { skills: { skillTree: null } },
			expected: false,
		},
		{
			label: "project skillTree is an array",
			agent: false,
			project: { skills: { skillTree: [false] } },
			expected: false,
		},
		{
			label: "project skills is not an object",
			agent: false,
			project: { skills: false },
			expected: false,
		},
		{
			label: "project file is not an object",
			agent: false,
			project: [],
			expected: false,
		},
		{
			label: "project file is not JSON",
			agent: false,
			project: "{not json",
			expected: false,
		},
		{
			label: "project file is missing",
			agent: false,
			project: undefined,
			expected: false,
		},
	] as const)("merges the skill-tree switch: $label", ({ agent, project, expected }) => {
		const i = input();
		if (agent !== undefined) {
			write(globalFile(i), { skills: { skillTree: { enabled: agent } } });
		}
		if (project !== undefined) write(projectFile(i), project);
		expect(resolveConfig(i).skillTreeEnabled).toBe(expected);
	});

	it("inherits the agent skill-tree switch when the project file cannot be read", () => {
		const i = input();
		write(globalFile(i), { skills: { skillTree: { enabled: false } } });
		mkdirSync(projectFile(i), { recursive: true });
		expect(resolveConfig(i).skillTreeEnabled).toBe(false);
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
			skillTreeEnabled: true,
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
			skillTreeEnabled: true,
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
