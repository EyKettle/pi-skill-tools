# skill-tools

[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-1.0.0-%23FE5196?logo=conventionalcommits&logoColor=white)](https://conventionalcommits.org)

> [!note]
> AI-generated artifacts. May include low-quality code.

A [Pi](https://github.com/earendil-works/pi) extension that registers six
tools for managing skills: list, search, view (untruncated), and create.

Pi's native `read` truncates at 2000 lines / 50KB. A skill has to reach the
model whole. `view_skill` returns `SKILL.md` verbatim — frontmatter included —
wrapped in an attributed `<SKILL>` block.

## Tools

| Tool | Purpose |
| --- | --- |
| `list_skills` | List loaded skills (global / project / package), with shadow and conflict state |
| `list_skill_tags` | List `metadata.tags` values across the skill index |
| `search_skills` | Filter skills by frontmatter fields |
| `list_skill_files` | List files under a skill directory as `{type/file-name}` refs |
| `view_skill` | Load a skill's `SKILL.md` untruncated |
| `create_skill` | Scaffold a new skill with id-conflict interception and no-overwrite |

Row layout for the interactive TUI is specified by
[`docs-zh-CN/tui-render-design.md`](docs-zh-CN/tui-render-design.md). That
document is the layout authority.

## Install

Clone into Pi's user-extension directory, then install this package's own
runtime dependency. `js-yaml` is a real runtime dependency the host does
not provide or alias.

```bash
git clone https://github.com/EyKettle/pi-skill-tools.git ~/.pi/agent/extensions/skill-tools
cd ~/.pi/agent/extensions/skill-tools
npm install
```

Pi loads `index.ts` from each directory under `~/.pi/agent/extensions/`.
Reload Pi after installing. Host-provided packages
(`@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, `typebox`)
are declared as optional peers so a live load shares the host TUI instance.

## Develop

```bash
npm install
npm test
npm run typecheck
```

`private: true` is intentional. This extension is not ready to publish.
