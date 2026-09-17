# 模型通道

本文档描述面向代理的信息规范，工具卡片的行形与配色见 [`TUI 渲染`](tui-render.md)。

模型通道由工具结果的 `content` 承载：`content` 进入模型上下文，`details` 供卡片与结构化消费。
失败从 `execute` 抛出，抛出文本进入模型通道并置 `isError`；返回对象不置错误标志。模型通道的文本用英文。

**MP#SelfContained** — 模型通道没有壳。

卡片用壳的背景色表达进行中、成功与失败（*RP#Shell*），模型通道没有背景色，结果以纯文本被单次阅读。
卡片可以省略的（由颜色与位置承载的），在这里省略即缺失：状态、身份与结果必须由文本自证。

## 归属

**MP#SingleOwner** — 一种信息一个出口。

| 出口 | 承载 | 消费时机 |
| --- | --- | --- |
| 工具描述（`description` 与参数 schema） | 能力、对象域、参数、结果形态 | 调用前：选择与传参 |
| 成功结果文本 | 结果本身：身份、终态、载荷、保证、接续 | 成功路径：信任与使用 |
| 失败结果文本（抛出的 `error:` / `suggestions:`） | 失败的操作、类别与恢复 | 失败路径：修正与替代 |
| 系统提示追加 | 方向纠正：何时换用本扩展的工具 | 全程：方向纠正 |

同一事实只在上述一处陈述；出现在两处即独立漂移。能力事实归描述，方向理由归引导（见「引导」）。
卡片与其信息不进入模型通道，模型通道的文本也不进入卡片（`RP#Data`）。

`{dynamic-skill-id}`：含义同 `tui-render.md`；位置冲突时带前缀，如 `global:name`。

## 能力声明

**MP#Capability** — 描述须让模型仅凭它选择工具并传参。

描述给出四件：能力、对象域、参数含义、结果形态。领域名词先行；触发枚举（"Use when …"）把窗口花在动词上，
且在名词存活前就被截断。

## 结果

**MP#Complete** — 结果须回答六问。

一个只拿到结果文本的读者，能回答下列六问，理解才算完整：

| # | 问题 | 必须存在的信息 | 缺失后果 |
| --- | --- | --- | --- |
| Q1 | 对什么对象操作？ | 身份：技能 id 与绝对路径 | 无法接续 |
| Q2 | 发生了什么——成功、失败还是空？ | 动作与终态；空必须明说 | 静默歧义：空答、失败与未取到不可区分 |
| Q3 | 得到了什么、多少？ | 载荷的最小完整陈述（计数、行、正文、写入量） | 猜测或重复查询 |
| Q4 | 结果凭什么被信任、保证到哪里？ | 保证与边界：不截断、绝对路径、范围限制 | 误用：截断当完整、限定当全集 |
| Q5 | 失败时——为什么、接下来做什么？ | 失败上下文：失败的操作、类别、代理可执行的恢复 | 重犯同一失败调用 |
| Q6 | 结果接下来怎么用？ | 接续：下一个调用可直接取用的 path、ref id 或 id | 多一次查询或猜测 |

六工具的形态：

| 工具 | 成功载荷 | 空态 |
| --- | --- | --- |
| `list_skills` | 每行 `- {dynamic-skill-id} [{state}] {absolute-path}`；`detail` 为真时附 `— {description}` | `no skills` |
| `list_skill_tags` | 字母序逗号分隔的 tag 流 | `no tags` |
| `search_skills` | 空行分隔的条目：首行 `{dynamic-skill-id} {absolute-path}`，随后每个匹配参数一行；多值时星号标记命中项（`*{value}*`） | `no matches` |
| `list_skill_files` | 每行 `- {type/file-name} {absolute-path}` | `no files` |
| `create_skill` | `created skill '{id}' at {absolute-path}` | 写入零字节仍是成功 |
| `view_skill` | `<SKILL name="…" location="…">` 包裹的全文；`frontmatterOnly` 为真时包裹 frontmatter 段 | 空文件：包裹内为空即答案 |

空态规则：空态是成功的一种，用短句 `no {对象}` 明说；空白文本不可用作空态。空态与失败可辨——失败抛出，
带 `error:`。

保证类信息在此处不可验证，必须在通道里声明。本项目的保证实例：`view_skill` 全文不截断；一切定位行给绝对路径；
tag 检索只认 `metadata.tags`，其余来源不报。

## 失败

**MP#Failure** — 失败携带操作、类别与恢复。

失败从 `execute` 抛出，文本以两行框架进入模型通道：

```text
error: {失败的操作与对象}
suggestions: {代理可执行的恢复}
```

`error` 写明失败的操作与对象。`suggestions` 给出代理可执行的下一步：回退、修正或替代路径；
需要用户动手的行动（重启、授权、外部操作）写成提醒用户，说明请用户做什么。
每个失败码只有一份恢复文本——模型通道的 `suggestions` 与结构化通道的 recovery 是同一句，
不各自维护。code 与 evidence 供结构化消费，不写进模型通道文本。

例（`INDEX_EMPTY`，行动属于用户）：

```text
error: skill index is not yet populated; the before_agent_start cache has not captured any skills
suggestions: Ask the user to restart pi or run /reload so the before_agent_start hook fires before the next prompt.
```

## 引导

**MP#Guidance** — 引导只纠正方向，不复述能力。

pi 的原生指引教模型用 `read` 载入技能，而 `read` 截断长文件；工具描述无法压过系统提示里的原生指引，
系统提示追加是能压过它的通道。追加只做一件事：给出换向与理由——`read` 的截断。工具清单与各工具能力归描述，
不在此复述。

追加文本：

```text
Load skills with view_skill: pi's read tool truncates long files, so a skill would arrive incomplete.
```
