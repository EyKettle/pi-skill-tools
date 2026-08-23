/**
 * skill-tools extension entry: registers the six skill tools (list_skills,
 * list_skill_tags, search_skills, view_skill, list_skill_files, create_skill)
 * plus a `before_agent_start` hook that caches pi's loaded skill set and
 * appends the view_skill adoption guidance to the system prompt (design §5.7).
 *
 * Thin controller — each tool's `execute`/`renderCall`/`renderResult` and
 * model-channel output builder live in `tools/*.ts` under a `define*`
 * factory (e.g. `defineListSkills` in `tools/list-skills.ts`). This file only
 * owns the dynamic pi-runtime imports, the skill cache + system-prompt
 * append hook, the `registryDeps` wiring, and the assembly that hands those
 * runtime pieces to each factory before registering.
 *
 * Pi-runtime packages (@earendil-works/pi-coding-agent, @earendil-works/pi-tui,
 * typebox) are imported dynamically inside the default export so jiti hands
 * over the host instance rather than a vendored copy. Type-only imports and
 * test accessors may resolve from this package's node_modules. The error
 * signal is pi's throw-from-`execute` contract (extensions.md 2887-2891):
 * failures throw Error messages that carry the `error:` / `suggestions:`
 * framing inside the text, because that message becomes `content[0].text`
 * for the LLM.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import type { ExtensionAPI, Skill } from "@earendil-works/pi-coding-agent";
import { buildRegistry } from "./registry";
import type { Registry } from "./registry";
import { parseFrontmatterBlock } from "./frontmatter";
import { SHADOW_SCAN_SOURCE, clearThrownFailures } from "./tools/shared";
import type { ToolDeps } from "./tools/shared";
import { defineListSkills } from "./tools/list-skills";
import { defineListSkillTags } from "./tools/list-skill-tags";
import { defineSearchSkills } from "./tools/search-skills";
import { defineViewSkill } from "./tools/view-skill";
import { defineListSkillFiles } from "./tools/list-skill-files";
import { defineCreateSkill } from "./tools/create-skill";
import { release, clear } from "./correlation";

export default async function (pi: ExtensionAPI): Promise<void> {
	const piApi = await import("@earendil-works/pi-coding-agent");
	const { Type } = await import("typebox");
	const { Text, Box, Container } = await import("@earendil-works/pi-tui");
	const { keyHint, loadSkillsFromDir, withFileMutationQueue } = piApi;
	const agentDir = piApi.getAgentDir();
	const configDirName = piApi.CONFIG_DIR_NAME;

	// --- Skill cache + adoption-append hook (design §3.1, §5.7) ----------------

	/** pi's loaded skill set, captured on every before_agent_start. */
	let cachedSkills: Skill[] = [];

	/** view_skill adoption guidance (design §5.7; tail-prompt chaining shape). */
	const appendedSystemPrompt =
		"\n\nLoad skills with view_skill — it returns the full SKILL.md untruncated " +
		"(frontmatter included), unlike the read tool which truncates. list_skills / " +
		"list_skill_tags / search_skills / list_skill_files manage the skill index; " +
		"create_skill scaffolds new skills with id-conflict interception.";

	pi.on("before_agent_start", (event) => {
		cachedSkills = event.systemPromptOptions.skills ?? [];
		// The return chains with tail-prompt's own modification through the
		// runner's per-handler systemPrompt rebuild (design §5.7-5.8).
		return { systemPrompt: event.systemPrompt + appendedSystemPrompt };
	});

	// --- Failure-correlation lifecycle (plan Task 4) --------------------------
	// Association state is released when a tool execution ends and cleared
	// when the session shuts down (design.md §错误处理). The thrown-failure
	// stash must outlive tool_execution_end — that is why it exists — so it
	// is cleared here, not on release. Renderers recover through the stash
	// (`recoverThrownFailure`), not through `correlation.claim`.

	pi.on("tool_execution_end", (event) => {
		release(event.toolCallId);
	});

	pi.on("session_shutdown", () => {
		clear();
		clearThrownFailures();
	});

	/** keyHint bound to pi's Keybindings lookup, as a plain string fn. */
	const expandKeyHint = (bindingKey: string, fallback: string): string =>
		keyHint(bindingKey as never, fallback);

	/** Build the skill index for one tool call (design §2.1, §3.3). */
	function registryDeps(ctx: {
		cwd: string;
		isProjectTrusted(): boolean;
	}): Registry {
		return buildRegistry({
			activeSkills: cachedSkills,
			scanDir: (dir) =>
				loadSkillsFromDir({ dir, source: SHADOW_SCAN_SOURCE }).skills,
			readFrontmatter: (filePath) =>
				parseFrontmatterBlock(readFileSync(filePath, "utf8")).data,
			agentDir,
			configDirName,
			cwd: ctx.cwd,
			homeDir: homedir(),
			isProjectTrusted: () => ctx.isProjectTrusted(),
		});
	}

	/** Runtime pieces handed to every per-tool factory. */
	const deps: ToolDeps = {
		registryDeps,
		Type: Type as ToolDeps["Type"],
		Text: Text as ToolDeps["Text"],
		Box: Box as ToolDeps["Box"],
		Container: Container as ToolDeps["Container"],
		expandKeyHint,
		withFileMutationQueue:
			withFileMutationQueue as ToolDeps["withFileMutationQueue"],
	};

	const config = { agentDir, configDirName };

	// --- Register the six tools -----------------------------------------------

	const register = pi.registerTool.bind(pi);
	register(
		defineListSkills(deps) as unknown as Parameters<typeof pi.registerTool>[0],
	);
	register(
		defineListSkillTags(deps) as unknown as Parameters<typeof pi.registerTool>[0],
	);
	register(
		defineSearchSkills(deps) as unknown as Parameters<typeof pi.registerTool>[0],
	);
	register(
		defineViewSkill(deps, config) as unknown as Parameters<
			typeof pi.registerTool
		>[0],
	);
	register(
		defineListSkillFiles(deps) as unknown as Parameters<
			typeof pi.registerTool
		>[0],
	);
	register(
		defineCreateSkill(deps, config) as unknown as Parameters<
			typeof pi.registerTool
		>[0],
	);
}
