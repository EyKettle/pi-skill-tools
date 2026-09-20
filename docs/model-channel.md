# Model Channel

English | [中文](../docs_zh-CN/model-channel.md)

This document defines the information specification for agent consumption. For tool card row formats and color schemes, see [TUI Render Standard](tui-render.md).

The model channel is carried by the tool result's `content`: `content` enters the model context, while `details` is consumed by cards and structured telemetry.
Failures are thrown from `execute`; the thrown text enters the model channel with `isError: true`; returned result objects carry no error flag. Model-channel text is written in English.

**MP#SelfContained** — The model channel has no shell.

Cards express pending, success, and failure through shell background colors (*RP#Shell*). The model channel has no background colors; results are read once as plain text.
What cards can omit (carried by color and position) is missing here if omitted: status, identity, and outcomes must prove themselves in text.

## Attribution

**MP#SingleOwner** — One type of information, one exit.

| Exit | Carries | Consumption timing |
| --- | --- | --- |
| Tool descriptions (`description` and parameter schemas) | Capability, domain objects, parameters, result format | Before call: selection and argument passing |
| Success result text | The result itself: identity, terminal state, payload, guarantees, continuation | Success path: trust and usage |
| Failure result text (thrown `error:` / `suggestions:`) | Failed operation, category, and recovery | Failure path: correction and alternatives |
| System prompt addition | Direction correction: when to switch to tools in this extension | Entire session: direction correction |

The same fact is stated in only one of the above exits; appearing in two leads to independent drift. Capability facts belong in descriptions; direction rationale belongs in guidance (see "Guidance").
Cards and their information do not enter the model channel, nor does model-channel text enter cards (`RP#Data`).

`{dynamic-skill-id}`: Identical meaning to `tui-render.md`; prefixed when positions conflict (e.g. `global:name`).

## Capability Declarations

**MP#Capability** — Descriptions must allow the model to choose tools and pass parameters based on them alone.

Descriptions state four things: capability, object domain, parameter meanings, and result format. Domain nouns lead; trigger enumerations ("Use when …") spend the context window on verbs and truncate before domain nouns survive.

## Results

**MP#Complete** — Results must answer six questions.

A reader receiving only the result text has a complete understanding only when able to answer these six questions:

| # | Question | Required information | Consequence of absence |
| --- | --- | --- | --- |
| Q1 | What object was operated on? | Identity: skill ID and absolute path | Cannot follow up |
| Q2 | What happened — success, failure, or empty? | Action and terminal state; empty must be stated explicitly | Silent ambiguity: empty, failure, and missing data indistinguishable |
| Q3 | What was obtained, and how much? | Minimal complete payload statement (entries, stream, text, write confirmation) | Guesswork or redundant queries |
| Q4 | Why should the result be trusted, and where do guarantees end? | Guarantees and boundaries: no truncation, absolute paths, scope limits | Misuse: mistaking truncation for completeness or subsets for the whole set |
| Q5 | On failure — why, and what next? | Failure context: failed operation, category, agent-executable recovery | Repeating the same failing call |
| Q6 | How should the result be used next? | Continuation: next actionable path, ref ID, or skill ID | Extra queries or guesswork |

Seven tool formats:

| Tool | Success payload | Empty state |
| --- | --- | --- |
| `list_skills` | One line per skill: `- {dynamic-skill-id} [{state}] {absolute-path}`; appends `— {description}` when `detail: true` | `no skills` |
| `list_skill_tags` | Comma-separated tag stream in alphabetical order | `no tags` |
| `search_skills` | Blank-line-separated entries: first line `{dynamic-skill-id} {absolute-path}`, followed by matched parameters per line; asterisks mark multi-value hits (`*{value}*`) | `no matches` |
| `list_skill_files` | One line per file: `- {type/file-name} {absolute-path}` | `no files` |
| `create_skill` | `created skill '{id}' at {absolute-path}` | Writing zero bytes is still a success |
| `view_skill` | Full file text wrapped in `<SKILL name="…" location="…">`; wraps frontmatter block when `frontmatterOnly: true` | Empty file: empty content inside the wrapper is the answer |
| `peek_skill` | `## When to Use` section content wrapped in `<SKILL_PEEK name="…" location="…">` | None (throws failure when section is missing) |

Empty-state rule: Empty states are a form of success, stated explicitly with `no {object}`; blank text cannot serve as an empty state. Empty states are distinct from failures — failures throw with an `error:` prefix.

Guarantees cannot be verified at the call site and must be stated in the channel. Guarantees in this project: `view_skill` and `peek_skill` never truncate; all locator lines supply absolute paths; tag queries inspect `metadata.tags` only, ignoring other sources.

## Failures

**MP#Failure** — Failures carry operation, category, and recovery.

Failures throw from `execute`, entering the model channel within a standard two-line frame:

```text
error: {failed operation and target}
suggestions: {agent-executable recovery}
```

`error` states the failed operation and target. `suggestions` provides the agent's next step: rollback, correction, or an alternative path. Actions requiring human intervention (restarts, authorization, external steps) are framed as reminders to prompt the user.
Each failure code has exactly one recovery text — the model channel's `suggestions` and the structured channel's recovery sentence are identical. Codes and evidence are for structured consumption and do not appear in model text.

Example (`INDEX_EMPTY`, human action):

```text
error: skill index is not yet populated; the before_agent_start cache has not captured any skills
suggestions: Ask the user to restart pi or run /reload so the before_agent_start hook fires before the next prompt.
```

## Guidance

**MP#Guidance** — Guidance corrects direction only; it does not restate capabilities.

Pi's native guidance instructs the model to load skills using `read`, but `read` truncates long files. Tool descriptions cannot override native instructions in the system prompt; appending to the system prompt is the channel that can. The addition does only one thing: provide redirection and rationale — `read`'s truncation. Tool catalogs and capabilities belong in descriptions and are not restated here.

Appended prompt text:

```text
Load skills with view_skill: pi's read tool truncates long files, so a skill would arrive incomplete.
```
