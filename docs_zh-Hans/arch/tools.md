# 工具设计

[回到总纲](../architecture.md)

- [技能加载机制](skill-tree.md)
- [TUI 通道规范](tui-channel.md)
- [模型通道规范](model-channel.md)

[加载树文档]: skill-tree.md#行为
[可写属性]: ../configuration.md#配置项

## 工具分工一览

| 工具 | 职责 |
| --- | --- |
| `list_skills` | 清点可用技能 |
| `list_skill_tags` | 清点可用标签 |
| `list_skill_files` | 清点特定技能相关文件 |
| `preview_skill` | 查看技能文件的信息 |
| `search_skill` | 查找特定技能或相关文件 |
| `import_skill` | 加载特定技能或相关文件 |
| `cancel_skill` | 卸载特定技能或相关文件 |
| `create_skill` | 安全创建技能或相关文件 |
| `rename_skill` | 安全重命名技能或相关文件 |
| `remove_skill` | 安全移除技能或相关文件 |

## 技能 ID

`{position}:{skill-name}/{type}/{filename.ext}`

| 部分 | 表示 |
| --- | --- |
| `{position}` | 技能所在位置，如 `global` |
| `{skill-name}` | 技能名称，如 `test-driven-development` |
| `{type}` | 相关文件类型，取目录名 |
| `{filename.ext}` | 相关文件的文件名，包含扩展名 |

`/{type}/{filename.ext}` 仅在指向技能相关文件时出现， 指向技能主文档的 ID 始终没有该后缀。

`{skill-name}` 受字符集 `/^[a-z0-9-]+$/` 约束。

### 取用规则

在约束参数时，或在 TUI 或模型通道中展示 ID 时，特定部分根据条件折叠。

| 部分 | 折叠条件 |
| --- | --- |
| `{position}:` | 没有同名技能 |
| `/{type}/{filename.ext}` | 指向技能主文档 |

## 清点技能文件

> [!NOTE]
> 该插件不依赖原生技能索引，会扫描所有已注册的发现路径。
> 不受 Pi 技能遮蔽影响，会展示所有可访问技能。

`list_skills` 会列出所有可用技能——可触及即可用。

`list_skill_tags` 会收集 Frontmatter 中 `metadata.tags` 的所有可用值。
可以确认已有标签，方便选择、或检查相似标签。

`list_skill_files` 会遍历技能文档同级路径下的其他目录，找出所有可访问文件（不限于 Markdown）。
不适用单文件技能，清单单文件技能的相关文件会有警告。

## 预览技能信息

`preview_skill` 可提供技能的文件大小、字节数、总行数，以及特定章节的内容。

该工具不会加载技能，信息仅展示在工具输出中。

## 通过 Frontmatter 检索技能

通过在 `search_skill` 参数中构造 Frontmatter 过滤器，可以方便地检索技能。

`search_skill` 的 `filter` 参数需要键值对列表。
值可以是字符串、列表、正则表达式。

| 类型 | 效果 |
| --- | --- |
| 字符串 | 特定键包含该字符串即命中 |
| 列表 | 特定键包含任意一项即命中 |
| 正则表达式（`"/{pattern}/"`） | 特定键正则匹配成功即命中 |

> [!IMPORTANT]
> 键之间是与关系。
> 键缺失或 Frontmatter 不可解析都不命中。

## 加载与卸载

通过 `import_skill` 与 `cancel_skill` 来加载或卸载 **特定技能** / **特定技能相关文件**。

两工具均支持批量操作。

技能加载与卸载的行为详见[加载树文档]。

## 技能管理

> [!NOTE]
> 如要编辑技能文件，请移步其他工具。
> 该插件不提供第二种编辑方式。

通过 `create_skill`、`rename_skill`、`remove_skill` 创建与管理现有技能。
管理工具使用标准的技能 ID，粒度与其相同，即允许管理技能相关文件。

管理工具均可防止 ID 冲突。

管理行为受[可写属性]控制，内置位置的可写性如下：

| 位置 | 可写 |
| --- | --- |
| global | 是 |
| project | 是 |
| package | 否 |
| temp | 否 |
