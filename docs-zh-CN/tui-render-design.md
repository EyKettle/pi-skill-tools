# TUI 渲染设计

## 标识说明

- `{Position}`: 技能位置，如 `Global`, `Project`, `Package`.
- `{skill-id}`: 仅技能 ID
- `{dynamic-skill-id}`: 在物理位置没有冲突的情况下是纯技能 ID，
  冲突时则包含位置前缀，如 `global:github`。判定条件不受筛选结果的影响
- `{type/file-name}`: 技能引用文件后缀，如 `references/trailers.md`

> 括号内部的形式代表显示的命名风格

## 工具渲染

### `list_skills`

```text
list_skills · Ctrl+O to expand
listed {n} skills
```

> 收起

```text
list_skills · Ctrl+O to expand
listed {n} skills in {Position}
```

> 指定位置

```text
list_skills ({n})

- {dynamic-skill-id} {/absolute/path/to/SKILL.md}
- ...
```

> 展开

```text
list_skills ({n} in {Position})

- {dynamic-skill-id} {/absolute/path/to/SKILL.md}
- ...
```

> 展开 + 指定位置

使用标准的工具提示：

- 使用默认的 Shell
- 标题是正常文本颜色
- 提示信息 (包含 `· Ctrl+O to expand`，括号信息) 是次级文本色
- 简短的特别信息 (如 `{Position}`) 和标题同级
- 使用列表渲染技能条目

### `list_skill_tags`

```text
list_skill_tags · Ctrl+O to expand
listed {n} skill tags
```

> 收起

```text
list_skill_tags · Ctrl+O to expand
listed {n} skill tags in {Position}
```

> 指定位置

```text
list_skill_tags ({n})

{tag-name}, {tag-name}, ...
```

> 展开

```text
list_skill_tags ({n} in {Position})

{tag-name}, {tag-name}, ...
```

> 展开 + 指定位置

使用标准的工具提示：

- 使用默认的 Shell
- 标题是正常文本颜色
- 提示信息 (包含 `· Ctrl+O to expand`，括号信息) 是次级文本色
- 简短的特别信息 (如 `{Position}`) 和标题同级

### `list_skill_files`

```text
[Skill] {dynamic-skill-id} · Ctrl+O to expand
listed {n} related files
```

> 收起

```text
[Skill] {dynamic-skill-id} ({n})

- {type/file-name} {/absolute/path/to/file}
- ...
```

> 展开

使用标准的工具提示：

- 使用默认的 Shell
- 标题是正常文本颜色
- 前缀 `[Skill]` 显示为紫色
- 提示信息 (包含 `· Ctrl+O to expand`，括号信息) 是次级文本色
- 使用列表渲染文件条目

### `search_skills`

```text
search_skills · Ctrl+O to expand
matched {n} skills
```

> 收起

```text
search_skills · Ctrl+O to expand
matched {n} skills in {Position}
```

> 指定位置

```text
search_skills ({n})

{frontmatter-kv-list}

- {dynamic-skill-id} {/absolute/path/to/SKILL.md}
- ...
```

> 展开

```text
search_skills ({n} in {Position})

{frontmatter-kv-list}

- {dynamic-skill-id} {/absolute/path/to/SKILL.md}
- ...
```

> 展开 + 指定位置

使用标准的工具提示：

- 使用默认的 Shell
- 标题是正常文本颜色
- Frontmatter 参数列表显示为蓝色
- 提示信息 (包含 `· Ctrl+O to expand`，括号信息) 是次级文本色
- 简短的特别信息 (如 `{Position}`) 和标题同级
- 使用列表渲染技能条目

### `create_skill`

```text
[NewSkill] {dynamic-skill-id}
Wrote {n} lines ({m}B) · Ctrl+O to expand
```

> 收起

```text
[NewSkill] {dynamic-skill-id} ({/absolute/path/to/SKILL.md})

{full-content}

{n} lines ({m}B) in total
```

> 展开

使用标准的工具提示：

- 使用默认的 Shell
- 标题是正常文本颜色
- 前缀 `[NewSkill]` 显示为绿色
- 提示信息 (包含 `· Ctrl+O to expand`，括号信息) 是次级文本色
- 显示完整的文本内容

### `view_skill`

```text
[Skill] {dynamic-skill-id} · Ctrl+O to expand
```

> 收起

```text
[Skill] {dynamic-skill-id} ({/absolute/path/to/SKILL.md})

{full-content}
```

> 展开

使用自定义的工具提示：

- `renderShell: "self"`
- 标题是正常文本颜色
- 前缀 `[Skill]` 显示为紫色
- 背景显示为淡紫色
- 提示信息 (包含 `· Ctrl+O to expand`，括号信息) 是次级文本色
- 显示完整的文本内容

## 错误处理

TUI 只消费桥接里、且与当前 `toolCallId` + 工具名完全匹配的 issue。
不读模型 `content`，不从 `error:` / `suggestions:` 恢复字段。

默认壳已经用背景区分 pending / success / error。错误行不再刷一层红色。
`view_skill` 成功/进行中仍用淡紫色；错误态改用错误背景。

收起只留一句人能看懂的结果。展开只加已经在 issue 里、且人需要当场看见的东西：
近邻名、歧义候选、已核实路径。不展示 issue code，不展示 `recovery:` 标签，
不把 facts 拆成 `label: value`。模型通道继续走原来的 `error:` / `suggestions:`。

没有属于这次调用的 issue，或 details 损坏：固定文案，不再猜测。

- 未知 / 畸形错误 → `Tool execution failed`
- 畸形成功 details → `Result details unavailable`（成功壳，不是错误壳）

没有更多内容时不要画 `· Ctrl+O to expand`。标题只出现一次，颜色规则与成功态相同。

### `view_skill` — 已知：找不到

```text
[Skill] {dynamic-skill-id} not found
```

> 收起 + 没有相似名称的技能

```text
[Skill] {dynamic-skill-id} not found
Found {n} similar skills · Ctrl+O to show
```

> 收起 + 有相似名称的技能

```text
[Skill] {dynamic-skill-id} not found

{n} similar skills:

- {dynamic-skill-id} {/absolute/path/to/SKILL.md}
- ...
```

> 展开 + 有相似名称的技能

沿用自定义的工具提示：

- `renderShell: "self"`
- 标题是正常文本颜色
- 前缀 `[Skill]` 显示为次级文本色
- 背景显示为淡红色 (同标准 Shell 的错误态)
- 提示信息 (包含 `· Ctrl+O to show`) 是次级文本色
- 使用列表渲染技能条目

### `view_skill` — 已知：歧义

```text
[Skill] {dynamic-skill-id} is ambiguous
{n} same skills in different position · Ctrl+O to show
```

> 收起

```text
[Skill] github is ambiguous

There's {n} versions:

- global:github {/absolute/path/to/global/SKILL.md}
- project:github {/absolute/path/to/project/SKILL.md}
```

> 展开 (假设目标是 `github` 技能)
>
> 候选用与成功列表相同的 `- {dynamic-skill-id} {/abs/path}`

沿用自定义的工具提示：

- `renderShell: "self"`
- 标题是正常文本颜色
- 前缀 `[Skill]` 显示为次级文本色
- 背景显示为淡红色 (同标准 Shell 的错误态)
- 提示信息 (包含 `· Ctrl+O to show`) 是次级文本色
- 使用列表渲染技能条目

### 未知或畸形错误

```text
list_skills · Tool execution failed
```

> 已知错误同一套句式 `{tool-name} · {Error info}`

```text
create_skill · notes already exists
```

> 含有变量的工具提示

沿用标准的工具提示：

- 标准的 Shell 错误态样式
- 简略信息不分成多行纯文本
- 技能名称显示为蓝色
- 工具名称使用普通文本色，错误信息使用错误文本色

## 进行中

结果未结算时只有调用行，没有结果行。状态由壳背景表达：默认壳用自带的进行中背景，
`view_skill` 用淡紫色（与成功态相同）。不另写“运行中”之类的字样。

这一行就是该工具成功态的标题行本身，去掉展开提示与结果短语。判据是「不提供无价值的信息」：
结果短语描述的是已结算的结果，进行中还没有；没有更多内容时也不该画 `· Ctrl+O to expand`。

反过来，进行中已经存在、且人需要当场看见的信息应当显示。`create_skill` 的内容随流式输出
累积，字节与行数是「可观察可追踪」的信息，因此进行中就显示；这类信息在成功态与展开态
同样保留——看得见的信息不应中途消失。

`{dynamic-skill-id}` 的判定条件不受筛选结果影响，进行中即可确定，
所以标题在结算前后形态一致，不会跳变。

### 默认 Shell 的五个工具

```text
list_skills
```

> 进行中（`list_skill_tags`、`search_skills` 同形）

```text
[Skill] {dynamic-skill-id}
```

> 进行中（`list_skill_files`）

```text
[NewSkill] {dynamic-skill-id} ({n} lines · {m} B)
```

> 进行中（`create_skill`）
> 括号内数据随流式输出实时更新
> 括号信息配色不降级

沿用标准的工具提示：

- 使用默认的 Shell，进行中背景由 Shell 提供
- 标题是正常文本颜色
- 前缀色与成功态相同：`[Skill]` 紫色，`[NewSkill]` 绿色
- 不画 `· Ctrl+O to expand`
- 不显示 `{Position}`、Frontmatter 参数列表
- 只有 `create_skill` 显示流式累积的行数与字节数；其余四个此时没有可显示的价值信息

### `view_skill`

```text
[Skill] {dynamic-skill-id}
```

> 进行中

沿用自定义的工具提示：

- `renderShell: "self"`
- 标题是正常文本颜色
- 前缀 `[Skill]` 显示为紫色
- 背景显示为淡紫色
- 不画 `· Ctrl+O to expand`

### 目标身份尚不可知

```text
view_skill
```

> 参数尚未完整时只画工具名，不猜测身份

## 空态

展开后的结果区必须让人看出「答案已经到达」。答案为空时用一句话写明，
而不能留下空白——空白无法区分「答案是空的」和「什么都没取到」，也无法区分成功与失败。

生成规则：已结算且结果为空时，展开态的结果区不画列表或正文，只画该工具的空态句；
收起态的结果短语仍用「工具渲染」里的 `{n}` 句式（此时 `{n}` 为 0）。空态句本身就是
展开所揭示的内容，因此收起态必须画 `· Ctrl+O to expand`。

展开提示的不变量：提示恰好在「展开会揭示更多内容」时出现。空态句是更多内容，
所以每一条已结算行都带提示。进行中没有结果，不画提示。错误态仅在 issue 里确有
当场可见的额外信息时才画提示。

查询类工具的结果区是结构化列表，空态句不加括号，以免被当成列表条目。
内容类工具的结果区是文件原文，空态句加括号，标明这是状态说明而不是文件里的字。

空态是成功态，不是错误态。`view_skill` 找不到技能见「错误处理」；空文件与找不到是两回事。
配色与壳沿用该工具在「工具渲染」中的成功态规则。

### `list_skills`

```text
list_skills (0)

No skills found
```

> 展开 + 空结果

```text
list_skills (0 in {Position})

No skills found
```

> 展开 + 空结果 + 指定位置

### `list_skill_tags`

```text
list_skill_tags (0)

No tags found
```

> 展开 + 空结果

```text
list_skill_tags (0 in {Position})

No tags found
```

> 展开 + 空结果 + 指定位置

### `list_skill_files`

```text
[Skill] {dynamic-skill-id} (0)

No related files
```

> 展开 + 空结果

### `search_skills`

```text
search_skills (0)

{frontmatter-kv-list}

No matches
```

> 展开 + 空结果
>
> 无 Frontmatter 参数时省略 `{frontmatter-kv-list}` 及其上下空行

```text
search_skills (0 in {Position})

{frontmatter-kv-list}

No matches
```

> 展开 + 空结果 + 指定位置

### `create_skill`

```text
[NewSkill] {dynamic-skill-id} ({/absolute/path/to/SKILL.md})

(empty file)

0 lines (0B) in total
```

> 展开 + 空内容

### `view_skill`

```text
[Skill] {dynamic-skill-id} ({/absolute/path/to/SKILL.md})

(empty file)
```

> 展开 + 空内容

查询类空态句：`No skills found`、`No tags found`、`No related files`、`No matches`。
内容类空态句：`(empty file)`。
