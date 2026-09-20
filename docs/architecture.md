# skill-tools Architecture Blueprint

English | [中文](../docs_zh-CN/architecture.md)

This document serves as the authoritative architectural blueprint for the `skill-tools` extension, covering system design principles, module topology, core operational mechanisms, and error handling architecture.

---

## 1. Architecture Principles

1. **Thin Controller**:
   `index.ts` serves strictly as a glue layer: dynamically importing Pi runtime dependencies, setting up dependency injection, listening for extension lifecycle events, and registering tools with the host. It contains no business logic, formatting heuristics, or error message assembly.

2. **Pure Fabrication & Dependency Inversion (DIP)**:
   Except for `index.ts`, all business modules (`registry.ts`, `skill-id.ts`, `skill-file.ts`, `skill-section.ts`, `tools/*.ts`) are pure TypeScript modules. They do not statically import `@earendil-works/pi-*` or `typebox` at module scope. Host-provided facilities (TypeBox schemas, TUI component constructors) are injected via the `ToolDeps` interface during tool definition. Core modules are 100% unit-testable in a bare Node.js/Vitest environment without a running Pi agent.

3. **Strict Channel Separation**:
   The extension provides two completely isolated information channels:
   - **Model Channel**: Carried by the tool result's `content` array into the LLM context. It follows the self-contained state principle, using unstyled plain text wrapped in attributed XML blocks (`<SKILL>`, `<SKILL_PEEK>`) with guaranteed untruncated content and normalized absolute paths.
   - **TUI Presentation Channel**: Driven by `details` and versioned `TransportPayload` records. Consumed by `presentation.ts` to project terminal-safe natural-language status lines (with three-state background coloring and column-width constraints), never parsing model text or relying on the model channel.

4. **Deny by Default (Fail-Closed)**:
   All external inputs (IDs, paths, frontmatter structures, Markdown content) are untrusted by default. Malformed inputs, escaping paths, invalid YAML, or missing mandatory sections trigger immediate structural failures in a closed vocabulary, with no implicit fallbacks or silent guesswork.

5. **No-truncation Guarantee & Absolute Paths**:
   Pi's native `read` truncates output exceeding 2000 lines / 50KB, hiding critical rules from the model. This extension guarantees verbatim, untruncated delivery of skill content. Furthermore, all location outputs provide canonical absolute paths on the host, allowing subsequent tools to follow up accurately.

---

## 2. Topology & Responsibilities

### 2.1 Dependency Topology

```text
index.ts (Controller: Dynamic Imports & Tool Registration)
  │
  ├── registry.ts (Skill Index: Cache extraction, 4-tier storage, shadow scan)
  │     ├── frontmatter.ts (YAML parsing, dotted-path filtering, serialization)
  │     └── skill-id.ts (ID grammar parsing, normalization, resolution)
  │
  ├── skill-file.ts (File access: Containment guard, untruncated reads, NUL sniff)
  │     ├── frontmatter.ts
  │     └── failure.ts (Closed failure codes & recovery mapping)
  │
  ├── skill-section.ts (Pure fabrication: Code-fence-aware markdown section extractor)
  │
  ├── skill-files.ts (Directory walk: Safe recursion & refId generation)
  │     └── skill-id.ts
  │
  ├── skill-create.ts (Scaffolding: Conflict detection, frontmatter build, atomic write)
  │     ├── frontmatter.ts
  │     ├── skill-id.ts
  │     └── registry.ts
  │
  ├── tools/*.ts (7 tool factories: Parameter schemas, execution, model output, TUI cards)
  │     └── shared.ts (Common failure helpers, details contracts, seam adapters)
  │
  ├── transport.ts (Transport protocol: Versioned immutable payload family & guards)
  │     ├── failure.ts
  │     └── skill-id.ts
  │
  ├── presentation.ts (Terminal projection: Hazard sanitization, width bounding, row components)
  │     └── transport.ts
  │
  └── correlation.ts (State preservation: toolCallId to structured Failure tracking)
```

### 2.2 Responsibility Matrix

| Module | Responsibility | Primary Public API |
| --- | --- | --- |
| `index.ts` | Extension lifecycle management & wiring controller | Default plugin export `default(pi: ExtensionAPI)` |
| `registry.ts` | Index construction, 4-tier storage classification, shadow duplicate scan | `buildRegistry(deps)`, `collectTags(entries)` |
| `skill-id.ts` | Skill identifier grammar parsing, formatting, ambiguity resolution | `parseSkillId(id)`, `resolveSkillId(entries, storage, name)` |
| `skill-file.ts` | Physical path containment checks & safe untruncated file reads | `resolveSkillFile(baseDir, refPath)`, `readSkillFile(path, opts)` |
| `skill-section.ts` | Pure string algorithm for code-fence-aware markdown section extraction | `extractSection(markdownText, headingTitle)` |
| `skill-files.ts` | Recursive sub-directory walk & relative file listing | `listSkillFiles(storage, name, baseDir)` |
| `skill-create.ts` | Directory scaffolding & collision-free atomic skill writes | `createSkill(params, deps)` |
| `frontmatter.ts` | Sole importer of `js-yaml`: parsing, dotted-path queries, dumping | `parseFrontmatterBlock`, `matchesFrontmatter`, `dumpFrontmatter` |
| `transport.ts` | Versioned immutable payload definitions & runtime validation guards | `build*Payload`, `assertValidPayload(payload)` |
| `presentation.ts` | Terminal sanitization, column measurement, polymorphic row projection | `projectRow(input)`, `paintProjectedRow`, `presentRow` |
| `failure.ts` | Closed failure vocabulary & single-source recovery sentence catalog | `FAILURE_CODES`, `createFailure(code, opts)`, `recoveryFor(code)` |
| `correlation.ts` | Mapping between tool call IDs and structured failure instances | `associate(callId, tool, failure)`, `release(callId)`, `clear()` |
| `tools/shared.ts` | Shared infrastructure, details contracts, seam throwing | `failError`, `resolveCallPayload`, `textResult`, `ToolDeps` |

---

## 3. Core Logic & Lifecycle

### 3.1 Skill Index Discovery & Shadow Scan (`registry.ts`)

Pi collapses discovered skills into a single name-keyed map at startup. When multiple storage locations (e.g. global and project) contain skills with identical names, Pi retains only the winning skill and silently drops the conflicting copies without exposing them to extensions.

To provide an exhaustive view of all skill assets, this extension implements a two-stage discovery mechanism:
1. **Capturing the Active Set**: Inside the `before_agent_start` event handler, skills loaded by Pi are intercepted from `event.systemPromptOptions.skills` and classified into four storage tiers: `global`, `project`, `package`, and `temp`.
2. **Deriving Scan Roots & Shadow Scanning**: Roots are derived from active skill locations (project-level scans strictly obey `isProjectTrusted()`, preventing untrusted code discovery). The extension re-runs Pi's `loadSkillsFromDir` across these roots, canonicalizing paths with `realpathSync`. Discovered skills that collide with an active skill are added to the registry as `shadowed` entries and annotated with `shadowedBy`.

### 3.2 Skill ID Grammar & Resolution (`skill-id.ts`)

Skill IDs adhere to an optional two-segment grammar:
```text
[{storage}:]{name}[/{refPath}]
```
- `{storage}`: One of `global`, `project`, `package`, or `temp`.
- `{name}`: Skill identifier matching `/^[a-z0-9-]+$/`.
- `{refPath}`: Relative file path within the skill root (cannot start with `/` or contain `..`).

**Resolution Logic (`resolveSkillId`)**:
- **With storage prefix**: Matches strictly within that storage namespace.
- **Bare name**: Evaluated across all storage locations:
  - 0 matches: Returns `ID_NOT_FOUND`, attaching nearest neighbor suggestions via Levenshtein edit distance.
  - 1 match: Resolves successfully.
  - ≥ 2 matches: Detects conflict across storages, returning `ID_AMBIGUOUS` with candidate prefixed IDs.

**Sub-path Support Matrix**:
- `view_skill`: Accepts valid `refPath` values to read supplementary files (e.g. `references/GUIDE.md`).
- `peek_skill` / `create_skill`: **Ref paths are rejected outright** with `TOOL_REF_PATH_UNSUPPORTED`. Applicability preview and scaffolding operate exclusively on the root `SKILL.md`.

### 3.3 Security & Containment (`skill-file.ts`)

To defend against symlink escapes and directory traversal:
- `resolveSkillFile` implements `nearestExistingReal`: it inspects existing path components and missing ancestors via `realpathSync` and `lstatSync`, verifying that the canonical path strictly resides under `baseDir + path.sep`.
- Binary sniffing: The first 8000 bytes are inspected for NUL (`\0`) characters. Files containing binary data are rejected with `FILE_NOT_TEXT`.

### 3.4 Code-Fence-Aware Section Extractor (`skill-section.ts`)

`peek_skill` relies on `extractSection` to isolate the `## When to Use` section:
- A line-by-line state machine tracks fenced code blocks (supporting ```` ``` ```` and `~~~`).
- Level-2 headings (`## `) occurring inside code fences are treated as example syntax and ignored.
- Outside code blocks, case-insensitive `^##\s+When to Use\s*$` headings mark the section start.
- Capture terminates when encountering the next un-fenced level-1 (`# `) or level-2 (`## `) heading. Sub-headings (`### `) within the section are preserved.

---

## 4. Failure Architecture & Transport Protocol

### 4.1 Throw-from-Execute & Two-Line Model Channel

To conform to Pi's extension execution model, all tool errors throw from `execute`:
- Failures do not return error objects; they execute `throw new Error(...)`.
- The thrown error message enforces a standard two-line frame:
  ```text
  error: {failing operation and target description}
  suggestions: {actionable recovery guidance for the agent or user}
  ```
- Pi captures this message into `content[0].text` with `isError: true`, providing clean, actionable text directly to the model.

### 4.2 State Preservation Across Rerenders (`correlation.ts` & `thrownFailures`)

In Pi, when a tool throws from `execute`, its structured `details` object is discarded. Without a preservation mechanism, the TUI layer cannot render rich, evidence-backed error cards.

This extension solves this via a dual-layer stash:
1. **Invocation Correlation (`correlation.ts`)**: `associate(toolCallId, toolName, failure)` tracks issues during execution; `tool_execution_end` calls `release(toolCallId)` to prevent memory leaks.
2. **Thrown Failure Stash (`thrownFailures` Map)**: Before throwing, `failError` stashes `buildFailurePayload` in module-scoped memory. When the TUI layer (`presentation.ts`) renders after execution ends, `resolveCallPayload` recovers the stashed payload, ensuring high-fidelity error cards.

### 4.3 Closed Failure Vocabulary (`FAILURE_CODES`)

The extension enforces 23 closed failure codes, each uniquely mapped to an immutable recovery sentence in `RECOVERY_BY_CODE`:

```text
Identity Parsing:
  - ID_EMPTY_NAME
  - ID_INVALID_NAME
  - ID_INVALID_STORAGE
Identity Resolution:
  - ID_AMBIGUOUS (attaches candidates evidence)
  - ID_NOT_FOUND (attaches suggestions evidence)
Path Containment:
  - PATH_ABSOLUTE_REF
  - PATH_ESCAPE
  - PATH_UNRESOLVABLE
File Reading:
  - FILE_UNREADABLE
  - FILE_NOT_TEXT
  - FILE_NO_FRONTMATTER
  - SKILL_NO_WHEN_TO_USE (exclusive to peek_skill missing section)
Directory Listing:
  - DIR_UNREADABLE
Skill Creation:
  - INDEX_EMPTY
  - CREATE_PACKAGE_REJECTED
  - CREATE_TEMP_REJECTED
  - CREATE_NAME_REJECTED
  - CREATE_NAME_EXISTS
  - CREATE_TARGET_EXISTS
  - CREATE_WRITE_FAILED
  - CREATE_VERIFY_FAILED
Tool Seam:
  - TOOL_REF_PATH_UNSUPPORTED
  - ENTRY_UNREACHABLE
```

### 4.4 Versioned Immutable Transport Payloads (`transport.ts`)

Tools transmit execution outcomes to the TUI presentation layer via typed, versioned payloads:
- Fixed version: `TRANSPORT_VERSION = 1`.
- Discriminated union of tool payloads (`ListSkillsData`, `PeekSkillData`, `ViewSkillData`, etc.).
- Runtime guard `assertValidPayload`: Enforces strict key sets, non-negative integers, non-empty strings, and exact line/byte count verification against written content.

---

## 5. Presentation Layer (`presentation.ts`)

Terminal rendering adheres to the [TUI Render Standard](tui-render.md), composing pure data projections into stateless components:
- **Shell vs. Content (RP#Shell)**: Background color indicates execution phase (pending, success, failure); text lines convey semantic content without redundant status words. Except for `view_skill` (custom card), all tools use Pi's default three-state shells.
- **Granularity Splitting (RP#Granule)**:
  - Pending: Call line with progress indicator.
  - Collapsed: Minimal complete summary statement (e.g. item count, byte readout, `peeked When to Use (N lines)`), with expand hints when extra details exist.
  - Expanded: Full list entries, filter echo, or wrapped file bodies.
- **Terminal Safety**: Untrusted text passes through `sanitizeDisplayText` (replacing control and formatting characters with `\uFFFD`) and `boundDisplayValue` (column-width truncation considering East Asian Width).
