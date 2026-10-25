/**
 * The system-prompt addition.
 *
 * The host's own guidance teaches the model to load a skill with `read`, which
 * truncates a long file and repeats what the context already holds. A tool
 * description cannot outrank the system prompt, so the correction rides the
 * one channel that can: the appended guidance, in the document's own words.
 */
export const GUIDANCE_TEXT = [
	"Load skills with skill tools. Read tool will truncate long files and repeat contents you already have.",
	"Skill tools ensure context uniqueness of skill documents. Feel free to use skill tools.",
	"",
	"Skill IDs use `{position}:{skill-name}/{type}/{filename.ext}`.",
	"`{position}:` is optional; add it when skills share one name.",
	"`/{type}/{filename.ext}` is optional; add it when the ID points at a related file instead of the skill's main document."
].join("\n");
