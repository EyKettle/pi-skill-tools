# 工具卡片

[English](../docs/tui-render.md) | 中文

本文档描述面向终端用户的工具卡片，模型通道的文本与恢复建议见 [`模型通道`](model-channel.md)。

**RP#Visible** — 有效信息必须在某处展示。
有价值、须知的信息必须存在一处位置盛放。面向不同对象的信息可以分离；
本规则只要求整体齐全。

## 壳

**RP#Shell** — 壳表达状态，行表达内容。
进行中、成功、失败由壳的背景色表达；行文本只承载内容，不重复状态，不因状态叠色。
五个工具用默认壳的三态背景。`view_skill` 自绘壳模仿默认壳：成功淡紫，
失败用与默认壳相同的错误背景，进行中与成功同用淡紫。

## 身份

调用行回答「用了谁」。不必是工具名；粗粒度取最有价值的那个谁
（`RP#Granule`）。身份尚未可知时只画工具名，不猜测。

`{dynamic-skill-id}`：索引无位置冲突时为纯 name，冲突时为 `global:name` 这类带前缀 id。
冲突由索引决定，不由本次筛选结果决定。进行中若尚未解析到登记项，只画已给出的 id，不补前缀。

`{Position}`：`Global` / `Project` / `Package`。它是标题同级的短小限定，可出现在收起答案里。

`{type/file-name}`：技能目录内相对路径，如 `references/trailers.md`。

| 工具 | 进行中 | 已结算调用行 |
| --- | --- | --- |
| `list_skills` | `list_skills ...` | `list_skills`；展开为 `list_skills ({n})` 或 `list_skills ({n} in {Position})` |
| `list_skill_tags` | `list_skill_tags ...` | 同 `list_skills` 形态 |
| `search_skills` | `search_skills ...` | 同 `list_skills` 形态 |
| `list_skill_files` | `[Skill] {dynamic-skill-id} ...`；id 未知则 `list_skill_files ...` | 同左；展开为 `[Skill] {dynamic-skill-id} ({n})` |
| `create_skill` | `[NewSkill] {dynamic-skill-id} ({n} lines · {m} B)` | `[NewSkill] {dynamic-skill-id}`；展开身份行加 `({path})` |
| `view_skill` | `[Skill] {dynamic-skill-id} ...`；id 未知则 `view_skill ...` | 同左；展开身份行加 `({path})` |
| `peek_skill` | `[Skill] {dynamic-skill-id} ...`；id 未知则 `peek_skill ...` | 同左；展开身份行加 `({path})` |

## 答案

**RP#Target** — TUI 只展示用户需要知道的信息，机械化数据用自然语言。

**RP#Result** — 行只画读者当下需要的信息。
未结算时只有调用行；例外是已经产生、且人需要当场看见的数据
（`create_skill` 的流式行数与字节），结算后保留。
不画未结算的结果短语，不画机器码与恢复标签。

答案是结果的最小完整陈述。英语可数名词按 n 变单复数。

| 种类 | n≥1 的收起答案 | 空时 |
| --- | --- | --- |
| 集合 | `listed {n} …` / `matched {n} …`（可带 `in {Position}`） | 空态句；收起与展开写同一句 |
| 文件内容 | 无（只能展开读） | 展开画 `(empty file)` |
| 写入 | `Wrote {n} lines ({m}B)` | 写入量仍是答案；展开另标 `(empty file)` |

查询类空态句不加括号：`No skills found`、`No tags found`、`No related files`、`No matches`。
内容类空态句加括号：`(empty file)`。

| 工具 | n≥1 收起 | 空态句 | 展开体 |
| --- | --- | --- | --- |
| `list_skills` | `listed {n} skills` | `No skills found` | `- {dynamic-skill-id} {path}` |
| `list_skill_tags` | `listed {n} skill tags` | `No tags found` | 逗号分隔的 tag 流 |
| `search_skills` | `matched {n} skills` | `No matches` | 过滤回显（`key: value`，强调色），然后匹配列表 |
| `list_skill_files` | `listed {n} related files` | `No related files` | `- {type/file-name} {path}` |
| `create_skill` | `Wrote {n} lines ({m}B)` | 仍用写入量 | 正文；末行 `{n} lines ({m}B) in total` |
| `view_skill` | （无结果行） | （收起无结果行） | 正文或 `(empty file)` |

空集合收起：

```text
[Skill] {dynamic-skill-id}
No related files
```

不是：

```text
[Skill] {dynamic-skill-id} · Ctrl+O to expand
listed 0 related files
```

`n≥1` 的 `{n}` 句式不得用于 0。找不到技能是失败，不是空文件。

## 展开

**RP#Granule** — 一种状态回答一种粒度的问题：收起给答案，展开给细节。
收起只回答「用了谁」「发生了什么」；后者可选，身份本身已是答案时不另塞。
展开回答「用了谁」「怎么用的」「发生了什么」，有效信息必须有位置。

展开提示当且仅当展开承载收起没有的内容。收起已给出答案、展开只重复同一答案时不画。
算额外内容的：列表、正文、过滤条件回显、近邻名、歧义候选、已核实路径、
以及收起答案里还没有的 `{Position}`。
`(0)` 是空的再陈述，不算额外内容。

提示文案：揭示结果用 `to expand`，揭示失败旁证用 `to show`。

提示位置（形状，不是新约束）：默认壳且调用行是工具名时缀调用行；
`create_skill` 缀写入量行；`list_skill_files`、`view_skill` 缀身份行。

| 工具 | 空态画提示 | 原因 |
| --- | --- | --- |
| `list_skills` / `list_skill_tags` | 仅当收起未带、展开标题将带 `in {Position}` | 位置是额外内容 |
| `search_skills` | 有过滤回显，或同上的 `{Position}` | 过滤是额外内容 |
| `list_skill_files` | 否 | 两侧同一空态句 |
| `create_skill` | 是 | 展开有正文或 `(empty file)` |
| `view_skill` | 是 | 正文只能展开读 |

进行中不画提示。调用行以 `...` 收尾：澄清该行正在进行而非显示出错，并在结算行会缀 ` · {hotkey} to expand` 时占住它的位置。`create_skill` 除外——流式行数与字节已表达进行中，它的提示落在结算后的写入量行，调用行无位可占。

## 失败

**RP#Data** — 渲染只来自该次调用的结构化数据。
TUI 消费与当前 `toolCallId` 和工具名匹配的结构化结果；模型通道文本、
`error:` / `suggestions:`、issue code、recovery 不进入 TUI，也不作字段恢复来源。

当结构化旁证是人必须当场看见的（近邻名、歧义候选、已核实路径、冲突名），画专用形态；
否则失败壳 `Tool execution failed`，成功壳但数据缺失或畸形 `Result details unavailable`。
错误信息保持一行。无旁证时不画展开提示。

专用形态（闭集）：

- `view_skill` 找不到：`[Skill] {id} not found`；有近邻则收起 `Found {n} similar skills · Ctrl+O to show`，展开列出近邻。
- `view_skill` 歧义：`[Skill] {id} is ambiguous`；收起 `{n} same skills in different position · Ctrl+O to show`，展开 `There's {n} versions:` 加候选列表。
- `create_skill` 目标已存在：`create_skill · {name} already exists`。
- `peek_skill` 缺失章节：`[Skill] {id} · no 'When to Use' section`。
- `peek_skill` 传入子路径：`[Skill] {id} · ref path unsupported`。

失败态的 `[Skill]` 前缀降为次级色。其余失败用 `{tool} · {Error info}`，工具名标题色，信息错误色。

## 配色

**RP#Color** — 颜色按信息角色分配。

| 角色 | 主题键 | 用于 |
| --- | --- | --- |
| 标题 | `toolTitle` | 标题、身份、标题同级短小限定（含 `{Position}`） |
| 类别 | `customMessageLabel` / `success` | `[Skill]` / `[NewSkill]` |
| 次级 | `muted` | 提示、括起的补充、失败态前缀 |
| 正文 | `toolOutput` | 结果数据、空态句、固定成功文案 |
| 强调 | `accent` | 参数名与值、过滤回显 |
| 错误 | `error` | 失败信息 |

进行中的行没有提示层级，其数据与标题同级。

进行中行尾的 `...` 按结算后提示的身份着色（次级色）。
