/**
 * The system-prompt addition.
 *
 * The host's own guidance teaches the model to load a skill with `read`, which
 * truncates a long file and repeats what the context already holds. A tool
 * description cannot outrank the system prompt, so the correction rides the
 * one channel that can: the appended guidance, in the document's own words.
 */
const SKILL_ID_GUIDANCE = [
	"Skill IDs use `{position}:{skill-name}/{type}/{filename.ext}`.",
	"`{position}:` is optional; add it when skills share one name.",
	"`/{type}/{filename.ext}` is optional; add it when the ID points at a related file instead of the skill's main document."
] as const;

export const GUIDANCE_TEXT = [
	"Load skills with skill tools. Read tool will truncate long files and repeat contents you already have.",
	"A load's result names only the ids it applied to; the body is not in it.",
	"The body is mounted in the system prompts as a `<SKILL id=\"…\" path=\"…\">` block, republished on every change to the loaded set.",
	"Read the skill there before acting on it, and do not open its file again.",
	"",
	"That's why skill tools ensure context uniqueness of skill documents. Feel free to use skill tools.",
	"",
	...SKILL_ID_GUIDANCE,
].join("\n");

export const PREVIEW_GUIDANCE_TEXT = [
	"Read skills with `preview_skill`.",
	"This put reading range in precise control, avoiding partially lost.",
	"",
	"Read related skills before acting on it.",
	"Preview heading tree to check what you need.",
	"",
	...SKILL_ID_GUIDANCE,
].join("\n");
