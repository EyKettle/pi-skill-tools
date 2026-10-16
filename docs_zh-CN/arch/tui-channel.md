# TUI 通道规范

[回到总纲](../architecture.md)

- [模型通道规范](model-channel.md)
- [工具设计](tools.md)
- [技能加载机制](skill-tree.md)

## 状态栏

当技能加载树不为空时，状态栏中会显示 `Skills Loaded ({n})`。

## 工具卡片

### 结构拆解

**收起状态**的卡片结构：

```text
{title} {args}
{answer} {extra}
```

**展开状态**的卡片结构：

```text
{title} {info}
{full-args}
{output}
```

| 要素 | 配色 | 展示 |
| --- | --- | --- |
| `{title}` | `toolTitle` | 工具动作：`List`、`Preview`、`Search`、`Create`、`Remove`、`Rename` |
| `{args}` | `customMessageLabel` | 操作对象与参数值，如 `test-driven-development "When to Use"` |
| `{full-args}` | `customMessageLabel` | 完整的参数键值对列表，格式为：`{key}: {value}` |
| `{info}` | `text` | 简短的信息 |
| `{extra}` | `muted` | 展开提示：`• {hotkey} to expand` |
| `{answer}` | `toolOutput` | 动作的结果 |
| `{output}` | `toolOutput` | 工具输出结果 |

> [!IMPORTANT]
> `{output}` 默认同步模型通道信息。
> 若 `{output}` 无输出，展开时仍然显示 `{answer}`。

### 特殊行为

发生错误时，`{answer}` 回答错误原因，`{info}` 不展示。

### 加载、卸载工具样式

`import_skill`、`cancel_skill` 没有壳，仅罗列文本标签 `Skill::{skill-id}`。
批量操作列表显示在一排，通过空格分割，空间不足时换行到下一行。

加载时标签颜色取 `success`，卸载时取 `error`。

### 清点工具样式

`{args}` 头部会追加显示操作对象：`skills` / `skill refs` / `skill tags`。

`{answer}` 回答清点情况：`Listed {n} skills/files/tags`。
兼容单数显示。

空态时 `{answer}` 为：`No skill/file/tag found`。

展开时出现 `{info}`，显示清点数量：`({n})`。

### 预览工具样式

`{answer}` 回答阅读量：`Viewed {n}/{m} lines`。

空态时 `{answer}` 为：`Nothing to view`。

### 搜索工具样式

`{answer}` 回答检索数量：`Found {n} skills`。
兼容单数显示。

空态时 `{answer}` 为：`No matches`。

展开时 `{info}` 显示检索数量：`(n)`。

### 增删改工具样式

#### `create_skill`

`{answer}` 回答写入量：`Wrote {n} lines ({m} B)`。
兼容单数显示。

空态时 `{answer}` 为：`Nothing to write`。

展开时 `{info}` 显示写入量：`({n} B, {m} L)`。
`{output}` 展示实际创建路径与输入的正文：

```text
Path: {/path/to/filename.ext}
======
{content}
======
```

`create_skill` 支持流式响应，写入途中 `{info}` 显示积累写入量：`({n} bytes, {m} lines)`。

#### `remove_skill`

`{answer}` 回答结果：`Removed {skill-id}`。
`{info}` 显示删除的文件数量（含主文档）：`({n} files)`。

#### `rename_skill`

`{answer}` 回答命名结果：`{skill-id} → {skill-id}`。
`{args}` 隐藏 `id` 与 `name` 两个参数。

`{info}` 显示移动的文件数量（含主文档）：`({n} files)`。
