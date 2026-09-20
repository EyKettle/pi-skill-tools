# skill-tools 插件

[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-1.0.0-%23FE5196?logo=conventionalcommits&logoColor=white)](https://conventionalcommits.org) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[English](README.md) | 中文

> [!note]
> AI 生成产物，可能包含低质量代码。

一个优化技能调用体验的 [Pi](https://github.com/earendil-works/pi) 拓展插件。
功能涵盖：

- 列出所有已知技能
- 根据条件检索技能
- 完整加载技能全文
- 窥探技能适用范围
- 预防 ID 冲突地创建技能

Pi 的原生 `read` 会截断超出 2000 行 / 50KB 的内容。如果要保证完整阅读一个技能，
`view_skill` 可以原封不动地返回 `SKILL.md` 的正文 (包括 Frontmatter)。

## 工具

| 工具               | 作用                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| `list_skills`      | 列出已加载技能 (全局—global / 项目级—project / 包级—package / 临时级—temp)，并标明遮蔽与冲突的情况 |
| `list_skill_tags`  | 列出已索引技能的所有已用标签 (源于 `metadata.tags`)                                                     |
| `search_skills`    | 通过过滤 Frontmatter 检索技能                                                                           |
| `list_skill_files` | 列出一个技能的相关文件，展示为 `{type/file-name}`                                                       |
| `view_skill`       | 不截断地加载技能主文档 (`SKILL.md`) 的完整内容                                                          |
| `peek_skill`       | 在不加载全文的情况下，预览 `## When to Use` 章节的内容                                                  |
| `create_skill`     | 具有 ID 冲突防护的技能创建工具                                                                          |

## 安装

克隆到 Pi 的用户扩展路径 (如 `~/.pi/agent/extensions`)。

```bash
git clone https://github.com/EyKettle/pi-skill-tools.git ~/.pi/agent/extensions/skill-tools
cd ~/.pi/agent/extensions/skill-tools
npm install
```

Pi 会自动加载 `~/.pi/agent/extensions/` 下的 `index.ts` 作为用户插件。
安装后重启 Pi 即可。

## 文档

- [系统架构总纲](docs_zh-CN/architecture.md)
- [TUI 渲染规范](docs_zh-CN/tui-render.md)
- [模型通道规范](docs_zh-CN/model-channel.md)

## 开发

```bash
npm install
npm test
npm run typecheck
```

`private: true` 是有意为之。该插件尚未做好发布准备。
