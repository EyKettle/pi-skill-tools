# TUI Tool Cards

English | [中文](../docs_zh-CN/tui-render.md)

This document defines tool cards for end users. For model-channel text and recovery guidance, see [Model Channel Standard](model-channel.md).

**RP#Visible** — Effective information must be presented somewhere.
Valuable and necessary information must have a designated home. Information intended for different audiences may be separated; this rule requires completeness overall.

## Shell

**RP#Shell** — The shell expresses state; lines express content.
Pending, success, and failure are expressed via the shell background color; text lines convey content only, without repeating status or stacking colors.
All tools use the default three-state colors, except `view_skill` (skill mode), whose success state takes a special color emphasis.

**RP#Mode** — A tool's different modes are different identities, each with a different appearance.
`view_skill` reads in one of two modes, split by the id: an id without a ref path reads `SKILL.md` (skill mode); an id with a ref path reads that file inside the skill directory (document mode). Skill mode paints a self-drawn card: the default pending and error backgrounds, purple on success. Document mode keeps the default three-state shell in every state.

## Identity

The call line answers "who was used." It need not be the tool name; take the highest-value identity at coarse granularity (`RP#Granule`). When identity is not yet known, draw the tool name only without guessing.

`{dynamic-skill-id}`: Bare name when no location conflicts exist; prefixed ID like `global:name` when conflicts exist. Conflicts are determined by the index, not by filtered results. While pending, if the entry is not yet resolved, draw the provided ID only without guessing a prefix.

`{Position}`: `Global` / `Project` / `Package` / `Temp`. A compact qualification matching the title level, permissible in collapsed answers.

`{type/file-name}`: Relative path inside the skill directory, e.g. `references/trailers.md`.

| Tool | Pending | Settled call line |
| --- | --- | --- |
| `list_skills` | `list_skills ...` | `list_skills`; expands to `list_skills ({n})` or `list_skills ({n} in {Position})` |
| `list_skill_tags` | `list_skill_tags ...` | Same format as `list_skills` |
| `search_skills` | `search_skills ...` | Same format as `list_skills` |
| `list_skill_files` | `[Skill] {dynamic-skill-id} ...`; if ID unknown, `list_skill_files ...` | Same as left; expands to `[Skill] {dynamic-skill-id} ({n})` |
| `create_skill` | `[NewSkill] {dynamic-skill-id} ({n} lines · {m} B)` | `[NewSkill] {dynamic-skill-id}`; expanded identity appends `({path})` |
| `view_skill` (skill) | `view_skill ...`; id known: `[Skill] {dynamic-skill-id} ...` | `[Skill] {dynamic-skill-id}`; expanded identity appends `({path})` |
| `view_skill` (document) | `view_skill ...`; id known: `[Skill] {dynamic-skill-id} ...`; ref known: `[Skill] {dynamic-skill-id}/{type/file-name} ...` | `[Skill] {dynamic-skill-id}/{type/file-name}`; expanded, the line after the identity line is `({path})` |
| `peek_skill` | `[Skill] {dynamic-skill-id} ...`; if ID unknown, `peek_skill ...` | Same as left; expanded identity appends `({path})` |

## Answer

**RP#Target** — The TUI displays only what the user needs to know; mechanized data uses natural language.

**RP#Result** — Lines show only what the reader needs right now.
Unsettled calls show only the call line; the exception is data already produced that the user needs to see live (streaming lines and bytes in `create_skill`), which persists after settling.
Do not draw unsettled result phrases, machine codes, or recovery tags.

An answer is the minimal complete statement of an outcome. English countable nouns inflect by count.

| Category | Collapsed answer (n ≥ 1) | When empty |
| --- | --- | --- |
| Collections | `listed {n} …` / `matched {n} …` (may include `in {Position}`) | Empty sentence; identical in collapsed and expanded views |
| File content | None (readable only when expanded) | Expanded shows `(empty file)` |
| Writes | `Wrote {n} lines ({m}B)` | Written volume remains the answer; expanded marks `(empty file)` |

Query empty sentences omit parentheses: `No skills found`, `No tags found`, `No related files`, `No matches`.
Content empty sentences include parentheses: `(empty file)`.

| Tool | Collapsed (n ≥ 1) | Empty sentence | Expanded body |
| --- | --- | --- | --- |
| `list_skills` | `listed {n} skills` | `No skills found` | `- {dynamic-skill-id} {path}` |
| `list_skill_tags` | `listed {n} skill tags` | `No tags found` | Comma-separated tag stream |
| `search_skills` | `matched {n} skills` | `No matches` | Filter echo (`key: value` in accent color), then matching list |
| `list_skill_files` | `listed {n} related files` | `No related files` | `- {type/file-name} {path}` |
| `create_skill` | `Wrote {n} lines ({m}B)` | Still uses written volume | Body; footer line `{n} lines ({m}B) in total` |
| `view_skill` | (No result line) | (No result line when collapsed) | Body or `(empty file)` |
| `peek_skill` | `peeked When to Use ({n} lines)` | (Throws failure when missing) | `## When to Use` body |

Empty collection collapsed:

```text
[Skill] {dynamic-skill-id}
No related files
```

Not:

```text
[Skill] {dynamic-skill-id} · Ctrl+O to expand
listed 0 related files
```

The `{n}` pattern for `n ≥ 1` must not be used for 0. Missing a skill is a failure, not an empty file.

## Expansion

**RP#Granule** — One state answers one granularity of question: collapsed gives the answer, expanded gives details.
Collapsed answers "who was used" and "what happened"; the latter is optional when identity itself is the answer.
Expanded answers "who was used," "how it was used," and "what happened." Effective information must have a place.

Expand hints appear if and only if expansion carries content not present in the collapsed view. Do not draw hints when the collapsed view already answers and expansion only repeats it.
Counts as extra content: lists, full body, filter echoes, nearest names, ambiguity candidates, verified paths, and `{Position}` when not yet in the collapsed answer.
`(0)` is a restatement of empty, not extra content.

Hint wording: `to expand` for revealing results, `to show` for revealing failure evidence.

Hint placement (layout shape, not a new constraint): appended to the call line when using default shells with tool-name titles; appended to the write-volume line in `create_skill`; appended to the identity line in `list_skill_files`, `view_skill`, and `peek_skill`.

| Tool | Draw hint on empty | Reason |
| --- | --- | --- |
| `list_skills` / `list_skill_tags` | Only when collapsed omitted `in {Position}` and expanded includes it | Position is extra content |
| `search_skills` | When filter echo is present, or `{Position}` as above | Filter is extra content |
| `list_skill_files` | No | Both sides show the identical empty sentence |
| `create_skill` | Yes | Expanded shows body or `(empty file)` |
| `view_skill` | Yes | Body can only be read expanded |
| `peek_skill` | Yes | Body can only be read expanded |

Do not draw hints while pending. Call lines end with `...`: clarifying that the line is in progress rather than failed, and reserving space when settled lines append ` · {hotkey} to expand`. Exception: `create_skill` streaming lines and bytes already convey progress, and its hint lands on the settled write line.

## Failures

**RP#Data** — Rendering sources only from structured data of that call.
The TUI consumes structured results matching the current `toolCallId` and tool name; model-channel text, `error:` / `suggestions:`, issue codes, and recovery text do not enter the TUI.

When structured evidence must be seen immediately by a human (nearest names, ambiguity candidates, verified paths, conflicting names), draw dedicated layouts; otherwise draw failure shell `Tool execution failed`, or success shell with missing data `Result details unavailable`.
Error messages remain single-line. Do not draw expand hints without evidence.

Dedicated layouts (closed set):

- `view_skill` / `peek_skill` not found: `[Skill] {id} not found`; when neighbors exist, collapse to `Found {n} similar skills · Ctrl+O to show`, expand to list candidates.
- `view_skill` / `peek_skill` ambiguous: `[Skill] {id} is ambiguous`; collapse to `{n} same skills in different position · Ctrl+O to show`, expand to `There's {n} versions:` with candidate list.
- `create_skill` target exists: `create_skill · {name} already exists`.
- `peek_skill` missing section: `[Skill] {id} · no 'When to Use' section`.
- `peek_skill` ref path rejected: `[Skill] {id} · ref path unsupported`.

In failure states, the `[Skill]` prefix drops to muted role. Other failures use `{tool} · {Error info}`, tool name in title color, information in error color.

## Colors

**RP#Color** — Colors are assigned by semantic role.

| Role | Theme key | Used for |
| --- | --- | --- |
| Title | `toolTitle` | Title, identity, compact title-level qualifiers (including `{Position}`) |
| Category | `customMessageLabel` / `success` | `[Skill]` / `[NewSkill]` |
| Muted | `muted` | Hints, bracketed supplementary text, failure prefixes |
| Body | `toolOutput` | Result data, empty sentences, fixed success prose |
| Accent | `accent` | Parameter keys and values, filter echoes |
| Error | `error` | Failure information |

Pending lines carry no hint tier; their data is peer to titles.
Trailing `...` on pending lines takes the muted role matching settled hints.
