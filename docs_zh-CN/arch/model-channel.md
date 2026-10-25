# 模型通道规范

[回到总纲](../architecture.md)

- [TUI 通道规范](tui-channel.md)
- [工具设计](tools.md)
- [技能加载机制](skill-tree.md)

[检索方式]: tools.md#通过-frontmatter-检索技能
[失败证据章节]: ../architecture.md#失败携带结构化证据

## 参数定义

### 清点工具参数

| 工具 | 参数 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- | --- |
| `list_skills` | `location` | `global` \| `project` \| `package` \| `temp` \| 自定义发现路径 | 否 | 只清点该位置；省略为全部发现路径 |
| | `detail` | `boolean` | 否 | 每条附上该技能的 description |
| `list_skill_tags` | `location` | 同上 | 否 | 同上 |
| `list_skill_files` | `id` | `string` | 是 | 技能 ID，忽略后缀 `/{type}/{filename.ext}` |

### 预览工具参数

| 参数 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `id` | `string` | 是 | 技能 ID；带 `/{type}/{filename.ext}` 时预览相关文件 |
| `section` | `string` | 否 | 章节名；省略则只给文件统计 |

`section` 只需要输入章节名，不需要前缀 `#`。
点明常见的适用范围章节，如 `When to Use`。

### 检索工具参数

| 参数 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `filter` | `Record<string, string \| string[]>` | 是 | Frontmatter 过滤器，键为点路径 |
| `location` | 同上 | 否 | 同上 |

`filter` 每个键的值取三种写法，详见[检索方式]。

### 加载、卸载工具参数

| 工具 | 参数 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- | --- |
| `import_skill` | `id` | `string` \| `string[]` | 是 | 要加载的技能 ID，或 ID 列表 |
| `cancel_skill` | `id` | `string` \| `string[]` | 是 | 要卸载的技能 ID，或 ID 列表 |

### 管理工具参数

| 工具 | 参数 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- | --- |
| `create_skill` | `id` | `string` | 是 | 技能 ID |
| | `content` | `string` | 是 | 完整 SKILL.md 正文，逐字写入 |
| `rename_skill` | `id` | `string` | 是 | 现有技能 ID |
| | `name` | `string` | 是 | 新名 |
| `remove_skill` | `id` | `string` | 是 | 要移除的技能 ID |

## 工具输出结果

模型通道由工具消息的 `content` 承载：`content` 进入模型上下文，`details` 仅供卡片与结构化消费。
`content` 同时会作为 TUI 通道中的 `{output}` 要素。

失败返回 `isError: true` 不抛出，`details` 同样供失败使用。
失败处理方式详见总纲中的[失败证据章节]。

空态同 TUI 侧 `{answer}`。

### 清点工具输出

展示查找到的文件列表：

| 对象 | 条目格式 |
| --- | --- |
| 技能 | `[{skill-id}] {/path/to/SKILL.md}` |
| 文件 | `[{skill-id}] {/path/to/filename.ext}` |
| 标签 | `{tag}` |

> [!IMPORTANT]
> 标签不会以列表展示，而是合并到同一行，通过 `,` 连接。

### 预览工具输出

展示看到的信息与章节：

```text
Total Lines: {n}
Total Bytes: {m}
Created At: {datetime}
Updated At: {datetime}
======
{section}
======
```

未指定章节时后半部分不展示（含分隔符）。

### 检索工具输出

展示检索到的技能列表，条目格式为：

```text
[{skill-id}]
{frontmatter}
```

> [!IMPORTANT]
> `{frontmatter}` 为 Frontmatter 完整原文

### 加载、卸载工具输出

加载卸载的结果遵循格式：`{action} [{skill-id}]`。
批量处理则显示为 `{action} [{skill-id}][{skill-id}]...`。

所有动作如下：`Loaded`、`Refreshed`、`Unchanged`、`Unloaded`。

### 增删改工具输出

`create_skill` 的结果为实际写入路径：`Actual Wrote Path: {/path/to/filename.ext}`。

对象为**相关文件**时，另两工具的输出格式为：`Removed/Moved: {/path/to/filename.ext}`。
对象为**技能**时，这两工具的输出如下。

`remove_skill` 的结果展示技能路径与删除的文件：

```text
Removed folder: {/path/to/skill}
Removed files:
- {/path/to/SKILL.md}
- {/path/to/file}
- ...
```

`rename_skill` 的结果展示技能路径与移动的文件：

```text
Moved path: {/path/to/skill}
Moved files:
- {/path/to/SKILL.md}
- {/path/to/file}
- ...
```

### 失败时的工具输出

失败时，工具输出遵循如下结构：

```text
ErrorCode: {}
Reason: {}
Suggestion: {}
```

> [!IMPORTANT]
> 若需用户手动操作（重启、授权、外部控制），则在 `Suggestion` 中告知代理上报理由、提醒其上报。

## 追加引导

Pi 的原生指引教模型用 `read` 载入技能，而 `read` 截断长文件。
工具描述无法压过系统提示里的原生指引，系统提示追加是能压过它的通道。

追加提示指明换向理由，原文如下：

```text
Load skills with skill tools. Read tool will truncate long files and repeat contents you already have.
Skill tools ensure context uniqueness of skill documents. Feel free to use skill tools.

Skill IDs use `{position}:{skill-name}/{type}/{filename.ext}`.
`{position}:` is optional; add it when skills share one name.
`/{type}/{filename.ext}` is optional; add it when the ID points at a related file instead of the skill's main document.
```
