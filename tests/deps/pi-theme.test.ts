/**
 * The theme accessor: a named re-export of the host `Theme`, and the
 * painted-role function the render path takes by injection. The fixture that
 * builds a real theme lives under tests/support, not in the production tree.
 */
import { describe, expect, it } from "vitest";
import { Theme } from "../../src/deps/pi-theme";
import type { ThemeFg } from "../../src/deps/pi-theme";
import { testTheme } from "./theme";

describe("the theme accessor", () => {
	it("re-exports the host Theme the tests construct with", () => {
		expect(typeof Theme).toBe("function");
		expect(testTheme("dark")).toBeInstanceOf(Theme);
	});

	it("builds a real Theme that paints a role with ANSI, not a stub", () => {
		const theme = testTheme("dark");
		const paint: ThemeFg = (role, text) => theme.fg(role, text);

		const painted = paint("success", "ok");
		expect(painted).toContain("ok");
		expect(painted).not.toBe("ok");
	});

	it("distinguishes dark from light so a restyle assertion can see the change", () => {
		const dark = testTheme("dark");
		const light = testTheme("light");

		for (const role of ["success", "error", "text", "muted"] as const) {
			expect(dark.fg(role, "x")).not.toBe(light.fg(role, "x"));
		}
	});
});
