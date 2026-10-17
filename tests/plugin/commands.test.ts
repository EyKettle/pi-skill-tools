/**
 * The event mapping and the four commands, with a recording host instead of pi.
 */
import { describe, expect, it } from "vitest";
import { appendGuidance, installContextHooks } from "../../src/plugin/hooks";
import { runCommand } from "../../src/plugin/commands";
import type { CommandPorts } from "../../src/plugin/commands";
import { changeOk, makeWorld, stubTree, indexOf, writeSkill } from "../tools/support/world";
import { createFailure } from "../../src/failure/create";

describe("installContextHooks", () => {
	it("maps each event to its action and passes the context through", () => {
		const registered: string[] = [];
		const seen: string[] = [];
		const ctx = { name: "ctx" };

		installContextHooks(
			{
				// The host calls a handler as (event, ctx); this recorder does the
				// same, which is what makes a wrong arity visible here.
				on(event: string, handler: (value: unknown, context: typeof ctx) => void) {
					registered.push(event);
					handler({ type: event }, ctx);
				},
			},
			{
				start: (value) => seen.push(`start:${value.name}`),
				navigate: (value) => seen.push(`navigate:${value.name}`),
				shutdown: (value) => seen.push(`shutdown:${value.name}`),
			},
		);

		expect(registered).toEqual([
			"session_start",
			"session_tree",
			"session_shutdown",
		]);
		expect(seen).toEqual(["start:ctx", "navigate:ctx", "shutdown:ctx"]);
	});
});

describe("appendGuidance", () => {
	it("appends the guidance on its own lines", () => {
		expect(appendGuidance("base", "line one\nline two")).toBe(
			"base\n\nline one\nline two",
		);
	});

	it("returns the guidance alone for an empty prompt", () => {
		expect(appendGuidance("", "guidance")).toBe("guidance");
	});
});

function portsFor(
	world: ReturnType<typeof makeWorld>,
	tree: Parameters<typeof runCommand>[0]["tree"],
	overrides: Partial<CommandPorts> = {},
): CommandPorts & { changes: number } {
	const state = { changes: 0 };
	const ports: CommandPorts = {
		tree,
		index: () => indexOf(world),
		historyEnabled: () => true,
		afterChange: () => {
			state.changes += 1;
		},
		...overrides,
	};
	Object.defineProperty(ports, "changes", {
		get: () => state.changes,
	});
	return ports as CommandPorts & { changes: number };
}

describe("/skill:loaded", () => {
	it("reports an empty set and the history state", () => {
		const world = makeWorld();
		const { tree } = stubTree(changeOk([]));
		expect(runCommand(portsFor(world, tree), "loaded", "")).toBe(
			"No skills loaded. History: available.",
		);
	});

	it("lists the loaded entries and their paths", () => {
		const world = makeWorld();
		const dir = writeSkill(world.globalSkills, "git");
		const { tree } = stubTree(changeOk([]));
		Object.defineProperty(tree, "state", {
			get: () => [
				{ id: "global:git", path: `${dir}/SKILL.md`, body: "" },
			],
		});

		expect(runCommand(portsFor(world, tree), "loaded", "")).toBe(
			[
				"Loaded 1:",
				`- global:git (${dir}/SKILL.md)`,
				"History: available.",
			].join("\n"),
		);
	});

	it("says when history is unavailable", () => {
		const world = makeWorld();
		const { tree } = stubTree(changeOk([]));
		const ports = portsFor(world, tree, { historyEnabled: () => false });
		expect(runCommand(ports, "loaded", "")).toContain("History: unavailable");
	});
});

describe("/skill:import", () => {
	it("imports the ids it was given and reports the rows", () => {
		const world = makeWorld();
		const { tree, calls } = stubTree(
			changeOk([{ displayId: "git", action: "Loaded" }]),
		);
		const ports = portsFor(world, tree);

		expect(runCommand(ports, "import", " git ")).toBe("Loaded [git]");
		expect(calls.imported).toEqual([["git"]]);
		expect(ports.changes).toBe(1);
	});

	it("re-reads every loaded entry when no id is given", () => {
		const world = makeWorld();
		const { tree, calls } = stubTree(
			changeOk([{ displayId: "git", action: "Refreshed" }]),
		);
		Object.defineProperty(tree, "state", {
			get: () => [{ id: "global:git", path: "/x/SKILL.md", body: "" }],
		});

		expect(runCommand(portsFor(world, tree), "import", "")).toBe(
			"Refreshed [git]",
		);
		expect(calls.imported).toEqual([["global:git"]]);
	});

	it("answers a failure with its code and recovery", () => {
		const world = makeWorld();
		const failure = createFailure("NOT_LOADED", {
			kind: "loaded",
			id: "git",
			loaded: [],
		});
		const { tree } = stubTree({ ok: false, failure });

		expect(runCommand(portsFor(world, tree), "import", "git")).toBe(
			`NOT_LOADED: ${failure.recovery}`,
		);
	});

	it("answers nothing-to-re-read for an empty set and no ids", () => {
		const world = makeWorld();
		const { tree } = stubTree(changeOk([]));
		expect(runCommand(portsFor(world, tree), "import", "")).toBe(
			"No skills loaded to re-read.",
		);
	});
});

describe("/skill:cancel and /skill:clear", () => {
	it("cancels the ids it was given", () => {
		const world = makeWorld();
		const { tree, calls } = stubTree(
			changeOk([{ displayId: "git", action: "Unloaded" }]),
		);
		const ports = portsFor(world, tree);

		expect(runCommand(ports, "cancel", "git pi")).toBe("Unloaded [git]");
		expect(calls.cancelled).toEqual([["git", "pi"]]);
		expect(ports.changes).toBe(1);
	});

	it("asks for an id when cancel carries none", () => {
		const world = makeWorld();
		const { tree, calls } = stubTree(changeOk([]));
		expect(runCommand(portsFor(world, tree), "cancel", "")).toBe(
			"Provide at least one ID to cancel.",
		);
		expect(calls.cancelled).toEqual([]);
	});

	it("clears everything that is loaded", () => {
		const world = makeWorld();
		const { tree, calls } = stubTree(
			changeOk([{ displayId: "git", action: "Unloaded" }]),
		);
		Object.defineProperty(tree, "state", {
			get: () => [{ id: "global:git", path: "/x/SKILL.md", body: "" }],
		});

		expect(runCommand(portsFor(world, tree), "clear", "")).toBe(
			"Unloaded [git]",
		);
		expect(calls.cancelled).toEqual([["global:git"]]);
	});

	it("says so when clear finds nothing", () => {
		const world = makeWorld();
		const { tree } = stubTree(changeOk([]));
		expect(runCommand(portsFor(world, tree), "clear", "")).toBe(
			"No skills loaded.",
		);
	});
});
