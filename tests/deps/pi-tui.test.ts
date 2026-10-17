/**
 * The pi-tui accessor: the named bindings the TUI channel builds with, and
 * the component contract pi drives without a guard.
 */
import { describe, expect, it } from "vitest";
import {
	Box,
	Container,
	Text,
	sliceByColumn,
	visibleWidth,
} from "../../src/deps/pi-tui";
import type { PiComponent } from "../../src/deps/pi-tui";

describe("the pi-tui accessor", () => {
	it("constructs the three components", () => {
		const box = new Box(1, 0);
		box.addChild(new Text("hi"));
		const container = new Container();
		container.addChild(new Text("stacked"));

		expect(box.render(20).join("\n")).toContain("hi");
		expect(container.render(20).join("\n")).toContain("stacked");
	});

	it("returns components whose render stays inside the width and carries the text", () => {
		const box = new Box(1, 0);
		box.addChild(new Text("a long line that must wrap inside the width"));
		const container = new Container();
		container.addChild(new Text("stacked"));
		const components: PiComponent[] = [
			new Text("hello"),
			box,
			container,
		];

		for (const component of components) {
			const lines = component.render(12);
			expect(lines.length).toBeGreaterThan(0);
			for (const line of lines) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(12);
			}
		}
		expect(new Text("hello").render(20).join("\n")).toContain("hello");
	});

	it("invalidates without a guard, the way pi's alt screen drives children", () => {
		const components: PiComponent[] = [
			new Text("x"),
			new Box(),
			new Container(),
		];
		for (const component of components) {
			expect(() => component.invalidate()).not.toThrow();
		}
	});

	it("measures and slices by visible column, not by code unit", () => {
		expect(visibleWidth("abc")).toBe(3);
		expect(visibleWidth("技能")).toBe(4);
		expect(sliceByColumn("abcdef", 1, 3)).toBe("bcd");
		expect(sliceByColumn("a技b", 1, 2)).toBe("技");
	});
});
