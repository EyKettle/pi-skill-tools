# skill-tools — Design Document v1

Pi extension providing six read-only/create-only skill management tools:
`list_skills`, `list_skill_tags`, `search_skills`, `view_skill`,
`list_skill_files`, `create_skill`.

The extension exists because pi's native `read` truncates output at 2000 lines /
50KB, while a skill must reach the model complete. `view_skill` returns SKILL.md
verbatim — frontmatter included, no truncation — wrapped in an attributed
`<SKILL name location>` block on the model channel.

**Target runtime:** pi 0.84.2 (`@earendil-works/pi-coding-agent`). Every
runtime claim below is cited to that version's `dist/`.

---

## 1. Scope

### 1.1 In scope

Skills that pi has loaded from the three managed locations: global, project,
package.

### 1.2 Out of scope

- **Editing skills.** No `write_skill` / `edit_skill` / `update_skill`.
  Section-level Markdown editing is already solved by `edit_md` and `edit`;
  duplicating it would only add maintenance surface. Every tool in this
  extension therefore emits the **absolute path** of the file it describes, so
  an editing tool can take over directly.
- **Skills outside pi's managed locations.** Skills reaching pi through
  `--skill <path>` or a `settings.skills` entry pointing outside the standard
  roots carry `sourceInfo.scope === "temporary"`
  (`dist/core/resource-loader.js:616,646`). They are excluded from every tool.
  The model decides for itself how to read those files.
- **Skill lifecycle operations.** Rename, move, and delete are write operations
  and share the editing exclusion above. A skill directory is removed with
  `bash rm -r` against the absolute path this extension emits; `edit_md` and
  `edit` operate on file content and cannot perform directory-level operations.

---

## 2. Architecture

```text
skill-tools/
├── package.json        # name, type: module, scripts.test = "vitest run"
├── tsconfig.json       # bundler resolution; types from local node_modules
├── .gitignore          # node_modules/, .pi/
├── index.ts            # Controller: 6 × registerTool + before_agent_start hook
├── registry.ts         # Skill index: active set + shadow scan + classification
├── skill-id.ts         # id grammar: parse / format / resolve
├── skill-file.ts       # SKILL.md verbatim read, frontmatter split, path guard
├── skill-files.ts      # list_skill_files directory walk
├── skill-create.ts     # create_skill: conflict check + verbatim write
├── frontmatter.ts      # YAML frontmatter parse + dotted-path filter
├── render.ts           # TUI: pi official skill style + path helpers
├── docs/design.md      # this document
└── tests/
```

Dependency direction:
`index → {registry, skill-id, skill-file, skill-files, skill-create, render}`;
`registry → {frontmatter, skill-id}`; `skill-file → frontmatter`;
`skill-files → skill-id`; `skill-create → {skill-id, frontmatter, registry}`;
`render → {skill-id, registry}`. No cycles.

`index.ts` is a Controller: schema definition, parameter validation, path
resolution, output assembly. No business logic.

**Runtime dependency:** `js-yaml ^4.3.1` is declared in `dependencies` because
the host does not alias it. Host-provided packages (`@earendil-works/pi-coding-agent`,
`@earendil-works/pi-tui`, `typebox`) are optional peers plus matching
devDependencies so tests resolve locally while live load shares the host
instance. `vitest` and `typescript` are local devDependencies. A clone runs
`npm install` in this directory; there is no shared-layer hoist.

**Import discipline.** Value imports of the three host packages stay dynamic
inside the default export so jiti aliases the host instance. Type-only imports
and test accessors may resolve from this package's `node_modules`.

### 2.1 Testability — dependency injection at the pi boundary

Value imports of `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui`
must go through the host loader (jiti virtualModules / alias) so the extension
does not evaluate a vendored copy. The boundary is therefore inverted:

| Module | pi dependency | Injection shape |
| --- | --- | --- |
| `registry.ts` | `loadSkillsFromDir`, `getAgentDir`, `CONFIG_DIR_NAME` | takes a `RegistryDeps` object: `{scanDir, readFrontmatter, agentDir, configDirName, cwd, homeDir, isProjectTrusted, activeSkills}` |
| `render.ts` | `theme`, `keyText`, `keyHint` | takes a minimal `ThemeLike` (`{fg, bg, bold}`) and hint functions |
| `skill-create.ts` | `withFileMutationQueue` | takes the queue wrapper as a parameter, defaulting to a pass-through |
| `frontmatter.ts` | `js-yaml` | declared runtime dependency; imported normally |

`index.ts` is the only production module that value-imports the host packages,
and it does so via dynamic import inside the default export. It constructs the
dependency objects and hands them to the pure modules. Every other module is plain TypeScript over `node:fs`
and `node:path`, unit-testable with fakes and temporary directories.

This keeps the Controller thin (§2) and makes the whole test suite runnable
without a pi runtime.

---

## 3. Skill Index (`registry.ts`)

### 3.1 The active set — where the skill list comes from

Three candidate sources exist; only one works inside a tool:

| Source | Provides | Verdict |
| --- | --- | --- |
| `ctx.getSystemPromptOptions().skills` | authoritative list with `sourceInfo` | **Unavailable.** Declared on `ExtensionCommandContext` (`dist/core/extensions/types.d.ts:254-256`), not on `ExtensionContext` (`:209-253`); `runner.js:543` attaches it to the command context only. Tool `execute` receives `ExtensionContext` (`types.d.ts:371`). |
| `before_agent_start` event → `event.systemPromptOptions.skills` | same list, plain event handler | **Chosen.** |
| `loadSkills()` called directly | raw scan | Rejected: it cannot reproduce package-manager metadata, so `origin: "package"` would be lost. |

`before_agent_start` fires after the user submits a prompt and before the agent
loop (`dist/core/agent-session.js:885`, passing `_baseSystemPromptOptions`,
whose `skills` field is populated at `:729-737`; the event field is declared at
`dist/core/extensions/types.d.ts:533`). Tools execute only inside that
loop, so **the cache is populated before the first tool call in the agent
loop** (the one exception — a first-turn `sendMessage` path — is guarded by
the explicit empty-index error, §11). The
handler overwrites the cache each turn, so a `/reload` is picked up on the next
prompt.

The cached array is pi's own `Skill[]`
(`dist/core/skills.d.ts:9-16`):
`{name, description, filePath, baseDir, sourceInfo, disableModelInvocation}`.

Skills with `disableModelInvocation: true` are **included** — they remain
invocable via `/skill:name`, so a management tool must show them. Mark them
`hidden` in output.

### 3.2 Location classification

| Storage | Criterion | Physical roots covered |
| --- | --- | --- |
| `global` | `scope === "user" && origin === "top-level"` | `~/.pi/agent/skills/`, `~/.agents/skills/` |
| `project` | `scope === "project" && origin === "top-level"` | `<cwd>/.pi/skills/`, ancestor `.agents/skills/` |
| `package` | `origin === "package"` | each package's `skills/` |

Verified in `dist/core/package-manager.js:1931-2009`: `~/.agents/skills` is
registered with `userMetadata` (`scope:"user"`, `origin:"top-level"`) and
ancestor `.agents/skills` with `projectMetadata` — only `baseDir` differs. A
skill matching none of the three criteria is dropped (§1.2).

**Terminology.** `storage` is the name of this concept throughout the design and
the implementation. The tools expose it under the parameter name `location`
(§5.1-5.3), which reads better at a call site; the two words denote the same
three values and nothing else.

### 3.3 Shadow scan — why the active set is not enough

`loadSkills()` collapses skills into a `Map` keyed by name
(`dist/core/skills.js:311,324,383`). On a name collision the **loser is dropped from the
returned array** and survives only as a `collision` diagnostic that extensions
cannot read. Reporting conflicts therefore requires the extension's own scan.

**Algorithm** (run per tool call — ~20 scan directories, no cache needed; 18
skill dirs on this machine):

1. Derive the scan roots:
   - global: `join(getAgentDir(), "skills")`, `join(homedir(), ".agents/skills")`
   - project: `join(cwd, CONFIG_DIR_NAME, "skills")`, plus each existing
     `<ancestor>/.agents/skills` walking from `cwd` up to the git repo root, or
     the filesystem root when not in a repo. **Skipped entirely when
     `ctx.isProjectTrusted()` is false** — pi does not load untrusted project
     skills, so neither does this extension.
   - package: for each active skill with `origin === "package"`, take
     `dirname(dirname(filePath))`; accept it only when its basename is
     `skills`. This derives package roots without reimplementing
     package-manager resolution.
2. Run `loadSkillsFromDir({dir, source})` on each root. This function is a
   **public export** of the pi package, so name resolution (frontmatter `name`
   with parent-directory fallback), `SKILL.md` recursion, ignore-file handling,
   and description validation match pi exactly.
3. Canonicalize every `filePath` with `fs.realpathSync`; drop entries whose
   realpath equals an active skill's realpath (this is how pi silently skips
   symlinked duplicates) and entries duplicated within the scan.
4. Classify each surviving scan entry:
   - name **is** in the active set → `shadowed`, annotated with the winning
     skill's prefixed id.
   - name **is not** in the active set → **dropped.** Such a skill was disabled
     by a settings `-` pattern, rejected for a missing description, or excluded
     by an ignore file. It is not shadowed, and the chosen view scope is
     "pi's loaded set, plus shadowed duplicates" — not "everything on disk".

**Output contract:** every listing marks each entry `active`, `shadowed`, or
`hidden`. When any name has more than one entry, a `conflicts:` block lists all
participants by full prefixed id.

**Declared limitation — skills with no description are invisible.**
`loadSkillsFromDir` refuses to load a skill whose frontmatter has no description
(`dist/core/skills.js:227-230`), so a skill broken that way is absent from pi's
active set AND undetectable by the shadow scan, which runs the same loader. The
count line therefore reports what pi loaded, not what exists on disk. Closing
this would require a parallel discovery path that contradicts §3.3's premise of
matching pi's semantics exactly, so it stays a declared limitation.

### 3.4 Frontmatter attachment

`list_skill_tags` (§5.2) and `search_skills` (§5.3) filter on frontmatter, which
pi's `Skill` type discards — it keeps `name`, `description`, and
`disable-model-invocation` and nothing else (§3.1). The registry therefore
attaches the parsed frontmatter itself; without this the two filtering tools have
no data source.

`RegistryDeps.readFrontmatter(filePath)` returns the parsed frontmatter record
for one `SKILL.md`, defaulting to `frontmatter.ts`'s `parseFrontmatterBlock` and
inheriting its fail-closed behavior: an unreadable or malformed file yields `{}`.
Each `Registry` entry carries the result as `frontmatter: Record<string, unknown>`.

Parsing is lazy per tool call and bounded by the entry count — the same
~20-directory budget as the shadow scan (§3.3). No cache.

---

## 4. Skill ID Grammar (`skill-id.ts`)

```text
{storage}:{name}/{ref_path}
```

Both `{storage}:` and `/{ref_path}` are optional. Minimal form:
`pre-commit-verification`. Full form:
`global:skill-authoring/references/frontmatter.md`.

**Parsing:**

1. Split on the **first** `:`. If the prefix is exactly `global`, `project`, or
   `package`, it is the storage marker and is consumed. Otherwise the whole
   string starts at `{name}`.
2. Split the remainder on the **first** `/`. The head is `{name}`, the tail (if
   present) is `{ref_path}`.

The grammar is unambiguous: pi validates skill names against `/^[a-z0-9-]+$/`
(`dist/core/skills.js:66`, `validateName`), so a name can contain neither `:` nor
`/`.

**Resolution without a storage prefix:**

| Matches | Behavior |
| --- | --- |
| 0 | Error naming the ~3 nearest skill names by edit distance |
| 1 | Resolve |
| ≥2 | Error listing every candidate as a **full prefixed id** |

An explicit prefix restricts the lookup to that location and never reports an
ambiguity.

---

## 5. Tool Contracts

All tools return `{content: [{type:"text", text}], details}`. **Errors are signaled by
dthrowing from `execute`** (pi extensions.md "Signaling errors"): the thrown
message becomes `content[0].text` with `isError: true`, so `error:` /
`suggestions:` framing lives **inside** the thrown message to stay on the LLM
channel; the TUI marks the result red (`toolErrorBg`) via `isError`, and
`renderResult` branches on `context.isError`. This replaces an earlier
markdown-tools-inherited "never throw" convention, which never set `isError`.

Every output line that identifies a skill or a skill file carries its
**absolute path** (§1.2). Tag output in §5.2 is the exception: it lists bare
tag names only, since a tag can reference many skills at once — the skills
behind a tag are one `search_skills` call away.

### 5.1 `list_skills(location?, detail?)`

- `location`: `"global" | "project" | "package"` — omit for all three.
- `detail`: boolean, default `false`. Default output is one line per skill:
  bare name, state marker, absolute path. A name that also exists in another
  location is disambiguated with its prefixed id (e.g. `global:alpha`);
  an unconflicted name stays bare. `detail: true` appends the description.

The output is the list rows only — no `conflicts:` block and no count line.
The row count travels in `details.count` (alongside `details.location`) and is
what the TUI's collapsed result renders (§6.2).

### 5.2 `list_skill_tags(location?)`

Tags are read from the registry's `frontmatter` attachment (§3.4) —
**`metadata.tags` only**. This is a deliberate convergence:
pi's frontmatter spec and the `skill-authoring` standard define no `tags` field,
and this machine currently carries two incompatible conventions
(`metadata.tags` on 2 skills, `metadata.hermes.tags` on 3, neither on the other 13).
`metadata.tags` is the single supported location; `metadata.hermes.tags` skills
need a separate frontmatter migration and will report no tags until then.

Output: an alphabetically sorted comma-separated list of tags, useful for
discovering searchable tags and spotting duplicate or near-synonym tags.
Skills without `metadata.tags` never appear; an empty result states so
explicitly. The tag count travels in `details.tags` alongside
`details.location`.

### 5.3 `search_skills(frontmatter, location?)`

- `frontmatter`: required record of filters. Keys accept **dotted paths**
  (`metadata.tags`) — required, since tags are nested.

Each candidate's filters run against its registry `frontmatter` attachment
(§3.4), parsed once by `readFrontmatter` and carried on the registry entry.

Filter semantics reuse `markdown-tools/frontmatter.ts`:

- scalar: both sides stringified, compared for equality
- array: non-empty intersection after stringification
- multiple keys: AND
- missing key, unparseable YAML, or absent frontmatter: **no match** (fail
  closed)

YAML is parsed with `CORE_SCHEMA`. Amplification is bounded by js-yaml 4's
shared-node alias resolution (aliases reuse the anchor node, never a
re-expanded copy) and the `maxDepth` default of 100.

Output: a **headerless list** — no `-` bullets; entries are separated by
blank lines. Line one of each entry is the display id plus the absolute path:
the bare name unless that name is in the conflict set, which comes from the
full registry rather than the filtered result (the same global set `view_skill`
resolves ids against), in which case the location-prefixed id is used.
Following lines render each matched filter parameter with its complete value;
asterisks mark which items matched when a parameter has multiple values. An
explicit `no matches` line when empty.

### 5.4 `view_skill(id, frontmatterOnly?)`

The core tool. Returns the file **verbatim and untruncated** — `truncateHead` is
never applied.

- `id` without a ref path → the skill's `SKILL.md`.
- `id` with a ref path → that file under the skill directory.
- `frontmatterOnly`: boolean, default `false`. When `true`, wraps the
  frontmatter text the same way as a full-file read.

**Model channel.** The complete file (or the frontmatter text when
`frontmatterOnly` is true) is wrapped in an attributed
`<SKILL name="..." location="...">` block. The wrapper is model-channel only —
the TUI strips it before painting.

**TUI.** `renderShell: "self"` paints a self-drawn three-state card that
mimics the native skill card; it does **not** use
`SkillInvocationMessageComponent`. `renderCall` returns an empty `Container`
so the title is not drawn twice — the label lives only on the result card.

| State | Background | Card contents |
| --- | --- | --- |
| pending | `toolPendingBg` | label |
| error | `toolErrorBg` | label + error text + dim presumed path |
| success | `customMessageBg` (purple) | label; full content (wrapper stripped) only when expanded |

The success label is the `[Skill]` marker in `customMessageLabel` followed
by the bare id, plus a muted
ref suffix when the id has a ref path: `" > {file}"` for a file-only path,
or `" > {PathName}({file-name})"` for a nested ref (each directory segment
title-cased: `scripts` → `Scripts`).

`details` reports `{name, storage, path, bytes, lines, content}` so the
renderer can recover the wrapped payload and the caller can see the volume
it received. A NUL-byte sniff rejects binary files with a structured error.

### 5.5 `list_skill_files(id)`

Walks the skill's `baseDir` and lists every file except `SKILL.md`, each
rendered as a **skill-id suffix** — the `{storage}:{name}/` prefix and the id
itself are omitted — plus its absolute path. Recombining the suffix with the
requested id yields the full ref id (e.g. `global:git-utils` +
`references/GUIDE.md` = `global:git-utils/references/GUIDE.md`); byte size is
no longer shown.

Conventional directories (`references/`, `scripts/`, `templates/`) are listed
first, in that order; everything else follows. The directory names are a display
ordering only — the walk is not restricted to them, so unconventional layouts
are still fully listed. Note the plural `references/`: that is the actual
convention across 9 of the 18 skill directories on this machine.

`node_modules/`, `.git/`, and dot-directories are skipped. Symlinks are not
followed.

### 5.6 `create_skill(id, content)`

Writes `<root>/<name>/SKILL.md` with the model-supplied `content` verbatim —
frontmatter included, no generated skeleton. The parameters are `id` and
`content` only (no description/license/version/metadata).

| Storage marker | Write root |
| --- | --- |
| `global` (default when omitted) | `join(getAgentDir(), "skills")` |
| `project` | `join(cwd, CONFIG_DIR_NAME, "skills")` |
| `package` | **Rejected.** Package directories are npm-managed; a write there is erased by the next install. |

**Explicit location (user-confirmed 2026-08-08).** The storage marker is carried
ONLY by the id's prefix — `create_skill` takes no separate location parameter.
An id with a `project:` prefix writes project; a bare name defaults to `global`
(above). The return value states the storage written and the absolute path, so
the effective location is always explicit in the output.

**Conflict interception** — before writing, check the name against the active
set **and** the shadow scan. Any hit is an error listing every existing
occurrence by full prefixed id and absolute path. An existing target directory
is likewise an error; the tool never overwrites.

**Empty-index guard.** An empty index (the `before_agent_start` cache never
fired) rejects the skill with the same explicit error as the read tools —
conflict interception cannot run against an index that does not exist yet.

Writes go through `withFileMutationQueue` with `executionMode: "sequential"`,
are atomic (temp file in the same directory, then rename), and are verified by a
post-write re-read.

### 5.7 Adoption mechanism — system-prompt append (user-approved 2026-08-08)

`formatSkillsForPrompt` (`dist/core/skills.js:264`) hardcodes *"Use the read tool to
load a skill's file"* into every system prompt — pi actively teaches the model
the behavior this extension replaces. A tool description cannot outrank the
system prompt; the correction must therefore be injected into the system
prompt itself.

**The `promptGuidelines` field is inert on this machine — abandoned.** The
field exists (`dist/core/extensions/types.d.ts:353`) and is plumbed through
`agent-session.js:713-737`, but `buildSystemPrompt` (`dist/core/system-prompt.js:13-34`)
takes an early return when `customPrompt` is set: it emits customPrompt +
append + contextFiles + skills + cwd and never reaches the Guidelines block at
`:80-81`. `customPrompt` is fed by `discoverSystemPromptFile()`
(`dist/core/resource-loader.js:373-387`) → `~/.pi/agent/SYSTEM.md`, which
EXISTS here (63648 bytes). Every promptGuidelines entry is silently discarded
on this machine.

**The extension-reachable mechanism: append via `before_agent_start`.** The
literal appendSystemPrompt (CLI/SDK option or `APPEND_SYSTEM.md`) is consumed
by the customPrompt branch (`system-prompt.js:15-17`) but extensions have no
registration channel for it. The extension-side equivalent — verified
end-to-end: `before_agent_start` may return
`{systemPrompt: event.systemPrompt + appendedText}`; runner.js:864-867
chained-merges the result into `agent.state.systemPrompt`
(`runner.js:860-867` → `agent-session.js:901-903` applied). The chain restarts
from `_baseSystemPrompt` each round, so the append never accumulates. The
same handler shape — returning a modified system prompt from
`before_agent_start` — is the precedent tail-prompt uses (`tail-prompt/index.ts:247-257`);
and this extension already registers `before_agent_start` for the skill cache, so
the same handler gains a return value, zero new mechanism.

Appended text (English, matching the Behavior Contract's language):

```text
Load skills with view_skill — it returns the full SKILL.md untruncated
(frontmatter included), unlike the read tool which truncates. list_skills /
list_skill_tags / search_skills / list_skill_files manage the skill index;
create_skill scaffolds new skills with id-conflict interception.
```

### 5.8 Side effects and verification of the append

- The append runs every `before_agent_start`; the cache handler already fires
  then, so there is no new event subscription — only a return value.
- `tail-prompt` modifies its own system-prompt text via the same event; both
  handlers chain through the runner's per-handler rebuild. Risk: Appending is a permanent-prompt change visible to the user in
  the TUI. Verify on the user's machine: `/reload`, then inspect the expanded
  system prompt once to confirm the guidance renders and reads naturally.
- If the user later removes `~/.pi/agent/SYSTEM.md` (customPrompt gone), the
  promptGuidelines field would work — but the early return is a *permanent*
  property of this setup (SYSTEM.md exists and is maintained), so the append
  is the durable choice.

---

## 6. TUI Rendering

**Layout authority is `docs-zh-CN/tui-render-design.md`.** That document
owns every composed row (collapsed, expanded, location variants, known
errors). This section does not duplicate those fences and must not be
read as a second recipe.

Live rows are projected in `presentation.ts` from a versioned transport
payload and call args. Display never reads model-channel `content` and
never recovers fields from thrown `error:` / `suggestions:` text.
`render.ts` still holds path helpers (`shortenPath`, `linkPath`) and the
15-line `clampLines` overflow helper; those are not the row layout.

pi has an official visual identity for skills, implemented identically in two
places:

- `dist/core/tools/read.js:90-103` (`formatCompactReadCall`, skill branch at `:92-93`) — the collapsed row
  when native `read` targets a `SKILL.md`
- `dist/modes/interactive/components/skill-invocation-message.js:14,34`
  (`SkillInvocationMessageComponent`) — the `/skill:name` message

The recipe:

```ts
theme.fg("customMessageLabel", "\x1b[1m[skill]\x1b[22m ")
  + theme.fg("customMessageText", <name>)
  + theme.fg("dim", ` (${keyText("app.tools.expand")} to expand)`)
```

`view_skill` borrows those colour roles (`customMessageBg` success,
`toolErrorBg` error) via `renderShell: "self"`. The other five tools use
the default tool-execution shell. Exact title, summary, and body lines
are in the frozen TUI document, not here.

### 6.1 Projection, not `displayResult`

The pre-calibration helpers `displayResult`, `resultTextOf`,
`formatRefSuffix`, and the `(listed {n} X in total)` / `(wrote {n} lines
in total)` summary lines are gone. Collapsed phrases now come from
`presentation.ts` (`listed {n} skills`, `Wrote {n} lines ({n}B)`, and
the other fences in the frozen document).

### 6.2 Model channel (unchanged)

**The model channel is the complete file wrapped in `<SKILL name location>`.**
The wrapper is model-channel only; `frontmatterOnly: true` wraps just the
frontmatter text the same way. The no-truncation guarantee belongs to the
model channel — the tool's `content` result is the full untruncated file
inside the attributed block. The terminal card stays compact until expanded.

### 6.3 Reimplemented helpers

`dist/core/tools/render-utils.js` is **not** a public export. `shortenPath`
(home prefix → `~`) and `linkPath` (OSC 8 hyperlink via pi-tui's `hyperlink` +
`getCapabilities`, degrading to plain text when unsupported) are reimplemented
in `render.ts`. Both are a few lines.

Public exports used as-is: `keyHint`, `keyText`, `getMarkdownTheme`,
`getAgentDir`, `CONFIG_DIR_NAME`, `loadSkillsFromDir`, `parseFrontmatter`,
`withFileMutationQueue`.

---

## 7. Security

| Control | Mechanism |
| --- | --- |
| Path traversal | A ref path is joined to the skill's `baseDir`, canonicalized, and required to remain under the canonicalized `baseDir`. `..` escapes and symlinks pointing outside are rejected with a structured error. |
| Binary content | NUL-byte sniff before any read returns content. |
| YAML amplification | `CORE_SCHEMA`; js-yaml 4 shared-node aliases + `maxDepth` default 100. |
| Write containment | `create_skill` writes only under the two permitted roots, refuses `package`, and never overwrites an existing path. |
| Untrusted projects | The project shadow scan is gated on `ctx.isProjectTrusted()`. |

---

## 8. Duplication Control

- Frontmatter parsing and filtering exist once, in `frontmatter.ts`, and follow
  `markdown-tools/frontmatter.ts` semantics rather than inventing a second
  dialect.
- Skill discovery reuses pi's exported `loadSkillsFromDir` rather than
  reimplementing directory rules.
- Skill rendering mimics the native skill card with a self-drawn three-state
  `Box` (`renderShell: "self"`); it does not import
  `SkillInvocationMessageComponent`.
- No editing machinery: `edit_md` and `edit` own that surface (§1.2).

---

## 9. Tests

`npm test` → `vitest run`.

- `skill-id`: prefix present/absent, ref path present/absent, first-`:`/first-`/`
  splitting, 0/1/≥2 match resolution, nearest-name suggestions.
- `frontmatter`: dotted-path lookup, scalar stringification, array
  intersection, AND across keys, fail-closed on missing key and malformed YAML.
- `registry`: location classification for all three markers, `temporary`
  exclusion, shadow detection, realpath dedup, untrusted-project gating,
  package-root derivation including the non-`skills` grandparent guard.
- `skill-file`: verbatim read with no truncation, frontmatter split,
  `frontmatterOnly`, traversal rejection, binary rejection.
- `skill-files`: conventional-directory ordering, unconventional files still
  listed, `node_modules`/dot-dir skipping.
- `skill-create`: verbatim content write with no skeleton/frontmatter
  generation, name conflict against active and shadowed sets, `package`
  rejection, existing-directory rejection.
  against active and shadowed sets, `package` rejection, existing-directory
  rejection.
- Integration: a temporary skills tree exercised end-to-end through all six
  tools.

---

## 10. Principle Mapping

| Principle | Where applied |
| --- | --- |
| SRP | one module per concern; `registry` owns the index, `skill-file` owns file access |
| Information Expert | `registry` owns skill identity and location; `skill-id` owns the grammar |
| Pure Fabrication | `frontmatter.ts`, `render.ts` |
| Controller | `index.ts` coordinates only |
| High cohesion / low coupling | acyclic dependencies; no module reaches past its neighbor |
| Isolate external deps | js-yaml parse + serialize confined to `frontmatter.ts`; pi/pi-tui imports confined to the default export |
| KISS / YAGNI | no editing tools, no cache layer, no fourth location, single tag source |
| Reuse over reimplementation | `loadSkillsFromDir`, `withFileMutationQueue` |
| Defensive | fail-closed filters, traversal guard, binary guard, atomic write + re-read, conflict interception |
| Least surprise | fixed output shapes, explicit empty results, absolute paths everywhere |
| Mechanism over documentation | `before_agent_start` system-prompt append redirects the model instead of a description note |

---

## 11. Decision Record

### Design

Decisions taken by the user during design:

1. **View scope: hybrid.** pi's loaded list is the active set; a supplementary
   scan surfaces same-name shadowed copies; conflicts report every participant
   with location prefixes.
2. **Tags: `metadata.tags` only.** `metadata.hermes.tags` is out of spec and
   requires a separate migration.
3. **`create_skill`: full contract** — frontmatter parameters plus the
   `skill-authoring` skeleton; `global` → `~/.pi/agent/skills/`, `project` →
   `<cwd>/.pi/skills/`.
4. **`scope: "temporary"` skills: excluded entirely.**
5. **No editing tools.** Editing belongs to `edit_md` / `edit`; every output
   carries the absolute file path.
6. **TUI follows pi official skill style.**
7. **Adoption mechanism: system-prompt append.** User approved the direction
   "switch to appendSystemPrompt" (2026-08-08). The literal appendSystemPrompt is not
   extension-reachable; the equivalent is `before_agent_start` returning
   `{systemPrompt: event.systemPrompt + text}` (§5.7). Replaces the inert
   `promptGuidelines` field (customPrompt early return).

Decisions converged during design without user input: `package` writes rejected
(npm-managed), `view_skill` never truncated, path-traversal guard,
`disable-model-invocation` skills listed, `references/` plural, shadow-scan
project gating.

Residual risks: `before_agent_start` is the sole active-set source, so a tool
called in a session where that event never fired would see an empty index — not
reachable through the agent loop, but worth an explicit empty-index error
message rather than a silent empty list. The system-prompt append changes what
users see in every session prompt; it is visible on inspection and trivially
revertible. Shadow-scan cost is linear in the
number of skill directories and unbounded in principle; acceptable at the
current scale (~20).

### Stage 1 render calibration

1. **Render evidence goes through real components.** A composed-row assertion
   builds the row with the real pi-tui `Text`/`Container` and a real `Theme`,
   call slot then result slot. A stub renderer or fake theme voids the evidence,
   so `tests/composed-row-boundary.test.ts` is the cross-tool sentinel: a
   refactor must leave it green WITHOUT editing it, and that untouched green
   state is the behaviour-preservation proof.
2. **Two stores, one for each question.** `correlation` answers "which unique
   unclaimed failure belongs to this call?" and fails closed — a second write
   deletes both entries. The `tools/shared.ts` stash answers "what payload did
   this call throw?" and overwrites, because the latest write is what the
   renderer paints. They cannot merge: `release()` runs on `tool_execution_end`
   before the UI paints, so render-time recovery must outlive it, and
   correlation holds a `Failure` while the renderer needs a `FailurePayload`.
3. **`correlation.claim` stays exported with no production caller.** Renderers
   recover through `recoverThrownFailure`; `claim` remains because the sentinel
   calls it, and removing the export would turn the sentinel red for a compile
   reason.
4. **`search_skills` echoes the filter it was given.** A zero-match expanded row
   showing the caller's own filter values is correct behaviour, not tool output
   to be corrected. `projectSearchSkills` stays as written.
5. **`ID_AMBIGUOUS` is covered by tests only.** Reaching it live needs the same
   skill name in two storages; test coverage exists and the live gap is recorded
   rather than presented as verified.
