/**
 * A temporary world for the tool tests: real skill directories, a real index,
 * real management ports, and a loaded-set stub that records what it was asked.
 *
 * The tools are composition, so their tests compose the real domain modules
 * over a temp tree and stub only the session-bound parts.
 */
import { afterAll } from "vitest";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildIndex } from "../../../src/discovery/registry";
import type { Index } from "../../../src/discovery/types";
import { resolveSkillFile } from "../../../src/files/read";
import { walkFiles } from "../../../src/files/list";
import type { ManagementPorts } from "../../../src/management/types";
import type {
	ChangeReport,
	ChangeResult,
	SkillTree,
} from "../../../src/skill-tree/types";
import type { ToolDeps } from "../../../src/tools/types";

const tmpDirs: string[] = [];

afterAll(() => {
	for (const dir of tmpDirs) {
		rmSync(dir, { recursive: true, force: true });
	}
});

/** One world: an agent directory, a project directory, and their skills. */
export interface World {
	readonly root: string;
	readonly agentDir: string;
	readonly cwd: string;
	/** The location a bare id resolves at. */
	readonly globalSkills: string;
	readonly projectSkills: string;
}

export function makeWorld(): World {
	const root = mkdtempSync(path.join(tmpdir(), "tools-"));
	tmpDirs.push(root);
	const agentDir = path.join(root, "agent");
	const cwd = path.join(root, "project");
	const globalSkills = path.join(agentDir, "skills");
	const projectSkills = path.join(cwd, ".pi", "skills");
	mkdirSync(globalSkills, { recursive: true });
	mkdirSync(projectSkills, { recursive: true });
	return { root, agentDir, cwd, globalSkills, projectSkills };
}

/** Write `<root>/<name>/SKILL.md` and return the skill directory. */
export function writeSkill(
	root: string,
	name: string,
	body = `---\nname: ${name}\n---\n`,
): string {
	const dir = path.join(root, name);
	mkdirSync(dir, { recursive: true });
	writeFileSync(path.join(dir, "SKILL.md"), body);
	return dir;
}

/** Write a related file under a skill, making its type directory. */
export function writeRef(
	skillDir: string,
	refPath: string,
	content: string,
): string {
	const target = path.join(skillDir, refPath);
	mkdirSync(path.dirname(target), { recursive: true });
	writeFileSync(target, content);
	return target;
}

/** The world's index, built the way the plugin builds it. */
export function indexOf(world: World): Index {
	return buildIndex({ agentDir: world.agentDir, cwd: world.cwd });
}

/** Management ports over the world, with the real walk and containment. */
export function managementOf(world: World): ManagementPorts {
	return {
		index: indexOf(world),
		defaultLocation: "global",
		listFiles: (root) => {
			const walked = walkFiles(root, {
				skipHidden: false,
				ignoredDirectories: new Set<string>(),
				minDepth: 0,
			});
			return walked.ok
				? { ok: true, files: walked.files.map((file) => file.path) }
				: walked;
		},
		resolveRef: (baseDir, refPath) => resolveSkillFile(baseDir, refPath),
	};
}

/** What the loaded-set stub was asked to do. */
export interface TreeCalls {
	readonly imported: string[][];
	readonly cancelled: string[][];
}

/** A loaded-set stub: records each call and returns a configured result. */
export function stubTree(result: ChangeResult): {
	tree: SkillTree;
	calls: TreeCalls;
} {
	const calls: TreeCalls = { imported: [], cancelled: [] };
	const tree: SkillTree = {
		get state() {
			return [];
		},
		start() {},
		navigate() {},
		importSkills(_index, ids) {
			calls.imported.push([...ids]);
			return result;
		},
		cancelSkills(_index, ids) {
			calls.cancelled.push([...ids]);
			return result;
		},
	};
	return { tree, calls };
}

/** A change result carrying the rows a tool renders. */
export function changeOk(results: readonly ChangeReport[]): ChangeResult {
	return { ok: true, results };
}

/** The deps a tool receives: the world's index, a tree stub, its ports. */
export function depsOf(
	world: World,
	tree: SkillTree,
	overrides: Partial<ToolDeps> = {},
): ToolDeps {
	return {
		index: () => indexOf(world),
		tree,
		management: () => managementOf(world),
		...overrides,
	};
}

/** The names directly under a directory, sorted; useful after a write. */
export function namesIn(dir: string): string[] {
	return readdirSync(dir).sort();
}
