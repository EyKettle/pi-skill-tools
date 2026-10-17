/**
 * The host boundary: every host package is named only under `src/deps/`, and
 * each accessor re-exports named bindings (a wildcard re-export leaves the
 * namespace undefined at runtime when the package stays external).
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../../src", import.meta.url));
const DEPS = path.join(SRC, "deps");

function sourceFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(directory, entry.name);
		if (entry.isDirectory()) return sourceFiles(full);
		return entry.name.endsWith(".ts") ? [full] : [];
	});
}

describe("the host boundary", () => {
	it("names host packages only at the two boundaries", () => {
		// `deps/` reaches the host's values; `plugin/` is the only module that
		// imports the host's API at runtime. Every other module must not know it.
		const boundaries = [DEPS, path.join(SRC, "plugin")];
		const offenders = sourceFiles(SRC)
			.filter(
				(file) =>
					!boundaries.some((boundary) =>
						file.startsWith(boundary + path.sep),
					),
			)
			.filter((file) => readFileSync(file, "utf8").includes("@earendil-works/"))
			.map((file) => path.relative(SRC, file));

		expect(offenders).toEqual([]);
	});

	it("re-exports named bindings, never a wildcard", () => {
		for (const file of sourceFiles(DEPS)) {
			expect(readFileSync(file, "utf8")).not.toMatch(/^\s*export\s+\*/m);
		}
	});

	it("imports the host API only from the plugin boundary", () => {
		const plugin = path.join(SRC, "plugin", "plugin.ts");
		const source = readFileSync(plugin, "utf8");
		expect(source).toContain(
			'await import("@earendil-works/pi-coding-agent")',
		);
		for (const file of sourceFiles(path.join(SRC, "plugin"))) {
			if (file === plugin) continue;
			expect(readFileSync(file, "utf8")).not.toContain("@earendil-works/");
		}
	});

	it("routes each host package through its own accessor", () => {
		const specifiers = new Map(
			sourceFiles(DEPS).map((file) => {
				const source = readFileSync(file, "utf8");
				const found = Array.from(
					source.matchAll(/from\s+"(@earendil-works\/[^"]+)"/g),
					(match) => match[1],
				);
				return [path.basename(file), found];
			}),
		);

		expect(specifiers.get("pi-tui.ts")).toEqual(["@earendil-works/pi-tui"]);
		expect(specifiers.get("pi-theme.ts")).toEqual([
			"@earendil-works/pi-coding-agent",
		]);
	});
});
