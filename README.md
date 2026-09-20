# skill-tools extension

[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-1.0.0-%23FE5196?logo=conventionalcommits&logoColor=white)](https://conventionalcommits.org) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

English | [中文](README.zh-CN.md)

> [!note]
> AI-generated artifacts. May include low-quality code.

A [Pi](https://github.com/earendil-works/pi) extension that improves the skill
usage experience. Key features:

- List all known skills
- Search skills with filters
- View skills without truncation
- Peek a skill's scope via 'When to Use' preview
- Create skill with id-conflict protection

Pi's native `read` truncates at 2000 lines / 50KB. A skill has to reach the
model whole. `view_skill` returns `SKILL.md` verbatim (frontmatter included).

## Tools

| Tool               | Purpose                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------- |
| `list_skills`      | List loaded skills (global / project / package / temp), with shadow and conflict state |
| `list_skill_tags`  | List `metadata.tags` values across the skill index                                          |
| `search_skills`    | Filter skills by frontmatter fields                                                         |
| `list_skill_files` | List files under a skill directory as `{type/file-name}` refs                               |
| `view_skill`       | Load a skill's `SKILL.md` untruncated                                                       |
| `peek_skill`       | Preview a skill's `When to Use` section without loading the full file                       |
| `create_skill`     | Scaffold a new skill with id-conflict interception and no-overwrite                         |

## Docs

- [Architecture Blueprint](docs/architecture.md)
- [TUI Render Standard](docs/tui-render.md)
- [Model Channel Standard](docs/model-channel.md)

## Install

Clone into Pi's user-extension directory.

```bash
git clone https://github.com/EyKettle/pi-skill-tools.git ~/.pi/agent/extensions/skill-tools
cd ~/.pi/agent/extensions/skill-tools
npm install
```

Pi loads `index.ts` from each directory under `~/.pi/agent/extensions/`.
Reload Pi after installing.

## Develop

```bash
npm install
npm test
npm run typecheck
```

`private: true` is intentional. This extension is not ready to publish.
