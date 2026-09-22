# skill-tools 架构总纲

[English](../docs/architecture.md) | 中文

本文档是 `skill-tools` 扩展插件的系统级权威设计锚点，统摄系统架构原则、模块拓扑、核心业务机制与错误处理体系。

---

## 一、 架构原则 (Architecture Principles)

1. **薄控制器 (Thin Controller)**：
   `index.ts` 作为扩展入口仅承担“粘合剂”角色：负责动态引入 Pi 宿主依赖、初始化注入配置、监听扩展事件以及向宿关注册工具。严禁在控制器中编写业务分支、格式解析或错误拼装逻辑。

2. **纯虚构与依赖倒置 (Pure Fabrication & DIP)**：
   除 `index.ts` 之外的所有业务模块（`registry.ts`, `skill-id.ts`, `skill-file.ts`, `skill-section.ts`, `tools/*.ts`）均为纯净的 TypeScript 模块，不直接在模块作用域静态导入 `@earendil-works/pi-*` 或 `typebox`。运行时依赖（如 TypeBox 实例、TUI 组件构造器等）统一通过 `ToolDeps` 接口在工厂初始化时注入。核心模块在脱离 Pi 宿主环境的裸 Node.js/Vitest 下具备 100% 独立可测性。

3. **双通道彻底隔离 (Strict Channel Separation)**：
   系统存在两个面向不同消费者的信息出口，严禁相互渗透：
   - **模型通道 (Model Channel)**：由工具执行返回的 `content` 承载，进入大模型上下文。遵循自证状态原则，采用无装饰纯文本与属性化 XML 标签包裹（`<SKILL>`、`<SKILL_PEEK>`），保证内容不截断、路径全绝对。
   - **终端交互通道 (TUI Presentation Channel)**：由工具执行返回的 `details` 及版本化 `TransportPayload` 驱动。消费结构化数据并由 `presentation.ts` 投影为符合终端安全的自然语言行（带有三态背景与宽度安全裁剪），不解析模型文本，亦不依赖模型通道。

4. **输入默认拒绝 (Deny by Default / Fail-Closed)**：
   所有外部输入（参数 ID、路径、Frontmatter 结构、Markdown 语法）默认不可信。遇到格式畸形、越界尝试、非法字符或未声明状态时直接阻断，抛出闭集定义的结构化失败，绝不进行静默宽容或隐式猜想。

5. **不截断保证与真实路径透传 (No-truncation & Absolute Paths)**：
   Pi 原生 `read` 工具在输出超出 2000 行 / 50KB 时会发生硬截断，导致大模型无法获得技能完整规则。本插件核心使命之一即提供不截断（Untruncated）读取保证；同时所有输出均透传宿主机规范化绝对物理路径，确保下游工具可精准接续。

---

## 二、 模块拓扑与职责划分 (Topology & Responsibilities)

### 2.1 拓扑关系图

```text
index.ts (Controller: Dynamic Imports & Tool Registration)
  │
  ├── registry.ts (Skill Index: 缓存提取、四级存储分类、阴影扫描)
  │     ├── frontmatter.ts (YAML 解析、点路径匹配、序列化)
  │     └── skill-id.ts (ID 语法解析、规范化、多位置解析)
  │
  ├── skill-file.ts (文件访问: 路径防逃逸守卫、无截断读取、二进制嗅探)
  │     ├── frontmatter.ts
  │     └── failure.ts (闭集错误码与恢复字典)
  │
  ├── skill-section.ts (纯虚构: 代码块感知的 Markdown 二级标题章节抽取)
  │
  ├── skill-files.ts (目录遍历: list_skill_files 深度过滤与 refId 构造)
  │     └── skill-id.ts
  │
  ├── skill-create.ts (技能脚手架: 冲突拦截、Frontmatter 组装、原子写入)
  │     ├── frontmatter.ts
  │     ├── skill-id.ts
  │     └── registry.ts
  │
  ├── tools/*.ts (7 个工具工厂: 参数校验、流程编排、模型输出、TUI 挂载)
  │     └── shared.ts (统一工具错误抛出、Details 接口、Seam 适配)
  │
  ├── transport.ts (传输契约: 版本化不可变 Payload 闭集家族与运行时守卫)
  │     ├── failure.ts
  │     └── skill-id.ts
  │
  ├── presentation.ts (渲染投影: 终端危险字符转义、行宽约束、语义行组件)
  │     └── transport.ts
  │
  └── correlation.ts (状态保全: toolCallId 与结构化 Failure 映射管理)
```

### 2.2 核心模块职责矩阵

| 模块 | 职责定位 | 对外主要暴露接口 |
| --- | --- | --- |
| `index.ts` | 扩展生命周期管理与装配控制器 | 默认插件导出函数 `default(pi: ExtensionAPI)` |
| `registry.ts` | 技能索引构建、四级存储归类、阴影副本探测 | `buildRegistry(deps)`, `collectTags(entries)` |
| `skill-id.ts` | 标识符语法解析、格式化与模糊/歧义决断 | `parseSkillId(id)`, `resolveSkillId(entries, storage, name)` |
| `skill-file.ts` | 物理路径防逃逸验证、无截断安全读取 | `resolveSkillFile(baseDir, refPath)`, `readSkillFile(path, opts)` |
| `skill-section.ts` | 纯字符串算法，带代码块隔离的章节抽取 | `extractSection(markdownText, headingTitle)` |
| `skill-files.ts` | 技能子目录安全遍历与文件列表收集 | `listSkillFiles(storage, name, baseDir)` |
| `skill-create.ts` | 技能物理目录初始化与防覆盖写保护 | `createSkill(params, deps)` |
| `frontmatter.ts` | 唯一被允许引入 `js-yaml` 的纯虚构模块 | `parseFrontmatterBlock`, `matchesFrontmatter`, `dumpFrontmatter` |
| `transport.ts` | 定义跨层传输不可变数据家族与强校验守卫 | `build*Payload`, `assertValidPayload(payload)` |
| `presentation.ts` | 终端输出转义、宽度计算与多态行投影 | `projectRow(input)`, `paintProjectedRow`, `presentRow` |
| `failure.ts` | 闭集错误码体系与单一来源恢复文本映射 | `FAILURE_CODES`, `createFailure(code, opts)`, `recoveryFor(code)` |
| `correlation.ts` | 工具调用 ID 与结构化故障上下文的映射跟踪 | `associate(callId, tool, failure)`, `release(callId)`, `clear()` |
| `tools/shared.ts` | 工具工厂公共基础设施与执行/渲染接缝桥接 | `failError`, `resolveCallPayload`, `textResult`, `ToolDeps` |

---

## 三、 核心逻辑机制 (Core Logic & Lifecycle)

### 3.1 技能索引发现与阴影补扫机制 (Registry & Shadow Scan)

Pi 宿主在运行时对所有技能采用“名称扁平折叠”策略：当不同存储空间（如全局目录与项目目录）存在同名技能时，Pi 仅保留优胜者，将失败者静默丢弃，扩展无法通过宿主上下文读取被遮蔽（Shadowed）的技能。

为还原完整的技能资产全景，本插件采用两阶段发现机制：
1. **捕获活跃集 (Active Set)**：在 `before_agent_start` 事件钩子中，从 `event.systemPromptOptions.skills` 无损截获 Pi 当前已加载的技能列表，并将其分类为 `global`（全局）、`project`（项目）、`package`（包级）与 `temp`（临时）。
2. **派生根目录与就地补扫 (Shadow Scan)**：根据活跃技能的物理来源推导扫描根目录（项目级扫描严格受 `isProjectTrusted()` 信任状态保护，防止非信任项目代码执行）。调用 Pi 导出的 `loadSkillsFromDir` 遍历对应根目录，对扫出的文件路径进行 `realpathSync` 规范化去重。若扫出的技能在活跃集已有同名胜出者，则该技能作为 `shadowed` 状态登记入索引，并明确标注其被谁遮蔽（`shadowedBy`）。

### 3.2 技能标识符语法与寻址裁决 (Skill ID Grammar & Resolution)

技能标识符统一采用两段可选语法：
```text
[{storage}:]{name}[/{refPath}]
```
- `{storage}`：存储空间命名空间，取值仅限 `global`、`project`、`package`、`temp`。
- `{name}`：技能名，严格受字符集 `/^[a-z0-9-]+$/` 约束。
- `{refPath}`：技能根目录内的相对文件子路径（禁止以 `/` 开头，禁止包含 `..`）。

**寻址裁决逻辑 (`resolveSkillId`)**：
- **指定存储前缀**：直接在指定命名空间内精确匹配，不发生跨空间歧义。
- **未指定存储前缀 (Bare Name)**：跨所有空间遍历：
  - 命中 0 项：返回 `ID_NOT_FOUND`，同时利用 Levenshtein 编辑距离算法计算并在证据中附带最相近的候选名称。
  - 命中 1 项：成功解析。
  - 命中 ≥ 2 项：检测到跨空间同名冲突，返回 `ID_AMBIGUOUS`，并附带所有候选者的带前缀限定 ID，阻断并要求调用方显式指定前缀。

**子路径支持差异矩阵**：
- `view_skill`：允许传入合法 `refPath`，用于深度查看技能附带的指南文档（如 `references/GUIDE.md`）。
- `peek_skill` / `create_skill`：**严禁传入 `refPath`**。若检测到包含子路径，直接触发 `TOOL_REF_PATH_UNSUPPORTED` 失败阻断。因为适用范围预览与技能脚手架仅面向技能本体根目录。

### 3.3 物理边界安全与防逃逸守卫 (Security & Containment)

在解析物理文件路径时，系统面临符号链接攻击（Symlink Escape）与跨目录跳跃（Directory Traversal）风险：
- `skill-file.ts` 中的 `resolveSkillFile` 实现了祖先追溯算法 `nearestExistingReal`：不仅对现有目标执行 `realpathSync`，对于尚不存在的路径还会向上回溯至最近存在的祖先目录并逐级探测符号链接，确保最终落点绝对包含在技能根目录（`baseDir + path.sep`）之内，彻底阻断逃逸。
- 二进制内容防护：读取技能前对前 8000 字节执行 NUL byte (`\0`) 嗅探，若发现非文本字节立即抛出 `FILE_NOT_TEXT`，拒绝加载二进制脏数据。

### 3.4 代码块感知的 Markdown 章节切分状态机 (`skill-section.ts`)

`peek_skill` 依托 `extractSection` 纯函数实现对 `## When to Use` 章节的定向抽取：
- 状态机在按行扫描时持续追踪代码块栅栏（支持三反引号 ```` ``` ```` 与三波浪线 `~~~`）。
- 处于代码块内部时，一切以 `## ` 开头的文本均视为代码示例，予以忽略，绝不误触判定为章节标题。
- 处于代码块外部时，匹配不区分大小写的 `^##\s+When to Use\s*$` 标题作为起始点。
- 章节截断边界：在起始行之后，遇到下一个非代码块内的同级标题（`## `）或更高级标题（`# `）即刻停止捕获；处于本章节内的更深层级子标题（如 `### `）会被完整包含并保留。

---

## 四、 错误处理与传输契约 (Failure Architecture & Transport)

### 4.1 异常抛出契约与模型通道双行协议

为保持与 Pi 扩展运行时规范一致，所有工具在遇到异常时采用 **Throw-from-execute** 机制：
- 错误不通过返回对象的属性标记，而是直接通过 `throw new Error(...)` 抛出。
- 抛出的错误信息严格遵循规范的两行式框架：
  ```text
  error: {失败的具体操作与对象描述}
  suggestions: {代理或用户可执行的排错与替代行动指南}
  ```
- Pi 框架会自动将抛出文本赋值给结果的 `content[0].text`，并标记 `isError: true`，使其以纯文本形式准确触达大模型上下文。

### 4.2 跨渲染周期状态保全机制 (Correlation & Stash)

在 Pi 框架设计中，当工具从 `execute` 抛出异常后，其关联的 `details` 对象会被丢弃。若无特殊机制，终端渲染层在重绘错误卡片时将无法获取结构化证据。

本插件通过双层状态保全桥接解决该问题：
1. **调用周期关联 (`correlation.ts`)**：执行初期调用 `associate(toolCallId, toolName, failure)`，并在 `tool_execution_end` 事件触发时调用 `release(toolCallId)` 安全释放，防止长期内存泄漏。
2. **抛出暂存恢复 (`thrownFailures` Map)**：在 `failError` 抛出前，将结构化的 `buildFailurePayload` 同步暂存在模块级 `thrownFailures` 中。即使工具调用已经结束，TUI 渲染层（`presentation.ts`）在重新渲染时依然可以通过 `resolveCallPayload` 优先从暂存区找回原始失败对象，实现错误卡片的高保真自然语言呈现。

### 4.3 闭集错误码体系 (`FAILURE_CODES`)

全系统定义了严格闭合的 23 个错误代码，每个代码在 `RECOVERY_BY_CODE` 中均唯一绑定一条不可更改的标准恢复建议：

```text
Identity Parsing:
  - ID_EMPTY_NAME
  - ID_INVALID_NAME
  - ID_INVALID_STORAGE
Identity Resolution:
  - ID_AMBIGUOUS (附带候选列表 candidates)
  - ID_NOT_FOUND (附带近邻推荐 suggestions)
Path Containment:
  - PATH_ABSOLUTE_REF
  - PATH_ESCAPE
  - PATH_UNRESOLVABLE
File Reading:
  - FILE_UNREADABLE
  - FILE_NOT_TEXT
  - FILE_NO_FRONTMATTER
  - SKILL_NO_WHEN_TO_USE (专属于 peek_skill 章节缺失)
Directory Listing:
  - DIR_UNREADABLE
Skill Creation:
  - INDEX_EMPTY
  - CREATE_PACKAGE_REJECTED
  - CREATE_TEMP_REJECTED
  - CREATE_NAME_REJECTED
  - CREATE_NAME_EXISTS
  - CREATE_TARGET_EXISTS
  - CREATE_WRITE_FAILED
  - CREATE_VERIFY_FAILED
Tool Seam:
  - TOOL_REF_PATH_UNSUPPORTED
  - ENTRY_UNREACHABLE
```

### 4.4 版本化强类型传输载荷 (TransportPayload)

工具的运行结果通过版本化对象与 TUI 渲染层通信：
- 固定版本标识：`TRANSPORT_VERSION = 1`。
- 传输家族采用判别联合（Discriminated Union），对每种工具定义独占的数据载荷（如 `ListSkillsData`, `PeekSkillData`, `ViewSkillData` 等）。
- 严格的类型守卫 `assertValidPayload`：在运行时对字段键集、数值非负性、文本非空性以及载荷行数/字节与正文的一致性进行 fail-closed 校验，杜绝畸形数据导致终端崩溃。

---

## 五、 终端视觉呈现与渲染设计 (Presentation Layer)

终端呈现遵循 [TUI 渲染规范](tui-render.md)，实现基于数据投影的无状态卡片渲染：
- **壳与状态分离 (RP#Shell)**：壳背景表达进行中、成功与失败；文本行仅表达语义内容，不叠加杂乱状态提示。所有工具进行中都用 Pi 默认进行中背景。`view_skill` 按模式区分（`RP#Mode`）：技能模式自绘卡片、成功淡紫；文档模式沿用默认三态壳。
- **收起与展开粒度切分 (RP#Granule)**：
  - 未结算（Pending）：渲染简明调用行及进度。
  - 已结算收起（Collapsed）：给出紧凑的最小完整陈述（如条目数、写入量、或 `peeked When to Use (N lines)`），在有额外未展示内容时附带快捷键提示（`Ctrl+O to expand`）。
  - 已结算展开（Expanded）：完整展示列表条目、过滤条件回显或安全折行的文件正文。
- **终端字符安全**：所有外部字符串在送入组件前必须经过 `sanitizeDisplayText` 过滤（移除非法控制字符、不可见格式字符，替换为 `\uFFFD`），并由 `boundDisplayValue` 结合 East Asian Width 进行精确列宽截断，避免破坏终端布局。
