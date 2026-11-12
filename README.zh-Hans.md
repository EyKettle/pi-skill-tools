# skill-tools 插件

[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-1.0.0-%23FE5196?logo=conventionalcommits&logoColor=white)](https://conventionalcommits.org) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[English](README.md) | 中文

> [!NOTE]
> AI 生成产物，可能包含低质量代码。

一个优化技能调用体验的 [Pi](https://github.com/earendil-works/pi) 拓展插件。
功能特性如下：

- 自定义技能发现路径，不受 Pi 技能遮蔽影响
- 查询技能文件信息与浏览章节
- 根据 Frontmatter 检索技能
- 批量加载与卸载技能
- 完全移除特定技能
- 安全管理技能，预防 ID 冲突

Pi 与上游均可能设有工具输出限制，长技能需要分块阅读才能完整消费。
同时代理可能重复阅读技能，造成 Token 浪费。

使用加载树功能时，插件保证工具输出限制不再约束技能完整度，技能正文唯一，多次加载不会重现文本。

> [!IMPORTANT]
> 技能加载树的兼容性不佳。
> 如果默认情况下，AI 会在加载技能后重复阅读，请考虑[关闭技能加载树](./docs_zh-Hans/configuration.md#配置项)。

## 可用工具

| 需求 | 工具 |
| --- | --- |
| 清点技能文件与信息 | `list_skills`、`list_skill_files`、`list_skill_tags` |
| 搜索技能 | `search_skill` |
| 查看技能信息、预览技能章节 | `preview_skill` |
| 加载卸载技能 | `import_skill`、`cancel_skill` |
| 管理技能文档 | `create_skill`、`remove_skill`、`rename_skill` |

## 文档

- [使用说明](docs_zh-Hans/usage.md)
- [配置指南](docs_zh-Hans/configuration.md)
- [系统架构总纲](docs_zh-Hans/architecture.md)

## 安装

克隆到 Pi 的用户扩展路径 (如 `~/.pi/agent/extensions`)。

```bash
git clone https://github.com/EyKettle/pi-skill-tools.git ~/.pi/agent/extensions/skill-tools
cd ~/.pi/agent/extensions/skill-tools
pnpm install
```

Pi 会自动加载 `~/.pi/agent/extensions/` 下的 `index.ts` 作为用户插件。
安装后重启 Pi 即可。

## 开发

```bash
pnpm install
pnpm test
pnpm run typecheck
```

`private: true` 是有意为之，该插件尚未做好发布准备。

## 贡献

如果要提交贡献，遵循[贡献文档](CONTRIBUTING.zh-Hans.md)要求。
