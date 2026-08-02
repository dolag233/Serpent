# 第0023框架规格：脚本自动化与 Agent MCP

> 状态：顶层设计已确认（2026-07-30 对齐 Console/MCP Action 面与 headless 建库）
>
> 日期：2026-07-28
>
> 修订：2026-07-30
>
> 上位决策：[ADR-0025](../adr/0025-automation-core-script-runtime-and-mcp.md)
>
> 相关基础：ADR-0018 Library Worker、ADR-0021 独立客户端写协调

## Problem Statement

Serpent 需要让人类和软件 Agent 自动化资产管理。复杂工作流需要循环、条件、函数、批量计算、事件等待和复杂错误恢复；若为每个工作流不断增加命令行参数，最终会形成一门能力较弱且难维护的流程语言。此前实现过只读 CLI 基础层，但产品已明确撤回它：当前不应再把通用 CLI 作为自动化入口或承诺其兼容性。

直接提供任意 JavaScript、Node.js、SQL 或文件系统访问同样不可接受。Serpent 管理真实文件、资源库数据库、回收站、AI Key 和可恢复后台任务；Agent 生成的代码、用户下载的脚本以及复制粘贴的片段都可能出错或被恶意内容影响。自动化必须保留 Library Worker 的所有权、领域命令、文件操作恢复、日志、能力授权和写入协调。

普通用户需要交互式 Console 或保存脚本，Agent Host 则需要 MCP。Serpent 需要一个公共自动化核心，而不是为 Desktop、脚本和 MCP 分别实现三套能力。

## Solution

建立一个共享 `Automation Command Gateway`，把领域命令注册表、运行时校验、能力、影响等级、预演、幂等、取消、Undo、长任务和错误契约统一起来。Desktop、脚本、MCP 和测试都只调用该 Gateway。

第一等复杂自动化表面是受控 JS/TS：Desktop 自动化中心提供无需先建文件的 Console，并允许把验证过的代码保存为 `.serpent.js` / `.serpent.ts`。同一套脚本也可在 headless 宿主中运行（例如 MCP 连接生命周期内的 process-local host）。脚本运行在独立沙箱执行器中，只获得注入的 `serpent` API。语言提供循环、条件、函数、对象和 Promise；Serpent 负责领域 Action、授权、计划批准、日志和安全边界。

Agent 通过本地 stdio MCP 调用与 Console **同一套**领域 Action 工具（由 Registry 映射）。差别是调用者（人 vs Agent）与 transport，不是能力子集。MCP 不提供任意代码 `eval`、Shell、SQL 或秘密配置；复杂长尾可由 Agent 生成可审查脚本，在人类授权后于受控执行器中运行。

本阶段不提供通用 CLI 或面向用户的 `serpent run`/`repl` 领域命令行。MCP 的 stdio 启动器只承载 MCP 协议。

## User Stories

1. 作为资产管理员，我希望在交互式 Console 中直接运行一段代码，而不必先创建文件，以便快速试验查询和批处理逻辑。
2. 作为资产管理员，我希望把验证过的代码保存为脚本，以便以后重复运行。
3. 作为脚本作者，我希望使用循环、条件、函数、对象和异步调用，以便自然表达复杂资产工作流。
4. 作为脚本作者，我希望获得自动补全和 TypeScript 类型，以便知道 Serpent API 的参数和返回值。
5. 作为脚本作者，我希望显式指定目标资源库，或在尚无资源库时先创建资源库，再继续导入与整理，以便支持 headless 采集工作流。
6. 作为脚本作者，我希望搜索、列出、读取标签、合集和任务状态，以便先理解资源库再采取行动。
7. 作为脚本作者，我希望一次提交批量元数据或标签修改，以免逐资产调用造成低性能和部分失败噪声。
8. 作为脚本作者，我希望每项失败都有稳定代码、对象引用和日志 ID，以便编写可恢复的错误处理。
9. 作为脚本作者，我希望等待、取消和查询长任务，以便编排导入、媒体处理和 AI 分析。
10. 作为脚本作者，我希望 AI 入队仍遵守应用的最大并发请求数，以免脚本绕过全局并发上限。
11. 作为用户，我希望首次运行脚本时看到它请求的能力和目标资源库，以便决定是否授权。
12. 作为用户，我希望脚本代码改变后原授权自动失效，以免修改后的代码继承旧权限。
13. 作为用户，我希望交互式 Console 的授权只在当前会话有效，以免临时代码获得长期权限。
14. 作为用户，我希望脚本无法读取 API Key、环境变量、任意磁盘文件或发起任意网络请求，以保护私有素材和凭据。
15. 作为用户，我希望能够停止死循环、超时或消耗过多内存的脚本，而不影响主窗口和 Library Worker。
16. 作为用户，我希望看到脚本执行历史、耗时、操作摘要和失败原因，以便调试和审计。
17. 作为用户，我希望取消执行后未开始的命令不再运行，已经进入领域命令的操作按其恢复语义收口。
18. 作为用户，我希望移动、重命名、导入和回收站操作在执行前显示影响摘要，以免脚本直接改变大量真实文件。
19. 作为用户，我希望可撤销操作返回 Undo 信息，不可撤销操作被单独标识并要求更高等级批准。
20. 作为 coding agent，我希望通过 stdio MCP 发现少量稳定工具，以便读取和操作 Serpent，而不依赖 GUI。
21. 作为 coding agent，我希望 MCP 返回分页结果和资源引用，以免一次把整个资源库塞进上下文。
22. 作为 coding agent，我希望工具参数使用稳定 ID 或显式资源库路径，以免猜测显示名称。
23. 作为 coding agent，我希望知道工具是否只读、会写入、会操作文件、是否支持预演以及是否需要批准，以便制定安全计划。
24. 作为 coding agent，我希望复杂流程可以落为一个可审查的 Serpent 脚本，以便用一次脚本表达循环，而不是进行数百次工具往返。
25. 作为 MCP Host 用户，我希望未配置写授权时服务端只暴露或只允许只读能力，以免 Agent 自行升级权限。
26. 作为桌面用户，我希望不先创建文件就能在 Console 运行代码，并在确认后保存脚本，以便把试验自然沉淀为可复用工作流。
27. 作为开发者，我希望 Desktop、脚本和 MCP 对同一命令得到相同结果与错误，以免入口之间行为漂移。
28. 作为开发者，我希望新增领域命令时只定义一次 Schema、能力和影响元数据，以便自动生成脚本类型和候选 MCP 工具。
29. 作为开发者，我希望适配层只做协议映射，以便在公共 Gateway 接缝完成大部分测试。
30. 作为跨平台用户，我希望 macOS 和 Windows packaged 版本使用同一 API 版本、权限和日志语义，以便脚本可移植。

## Implementation Decisions

### 1. 唯一公共接缝

`Automation Command Gateway` 是唯一高层测试和执行接缝。它接收带上下文的命令信封，完成：

- 命令 ID 与 API 版本解析。
- Zod 输入校验和稳定资源引用解析。
- 能力、目标资源库和执行模式校验。
- 副作用等级、批准策略、预演和幂等处理。
- 调度到现有 Library Worker 领域命令。
- 结果 Schema 校验、脱敏错误、日志 ID、变更序号或 Job ID 封装。

Renderer、Desktop Console、脚本 API 和 MCP 只负责把各自输入转换为该信封，再把结果转换为各自输出。不得在适配器里直接调用 `LibraryService`、SQLite 或文件系统。

调用方只能提交 `executionId`、API 版本、命令 ID 与命令输入；`source`、目标资源库、能力集合、截止时间和批准凭据由 Main/Execution journal 按 `executionId` 服务端解析。任何脚本或 MCP 客户端传入的资源库 ID、能力或来源字段都必须被拒绝，不能作为 Gateway 的授权依据。

### 2. 通用命令注册表

以现有 Worker request/response schema 为迁移输入，建立与 transport 无关的 Automation Command Registry。每个命令描述至少包含：

- 稳定 `commandId`、API 版本、摘要和弃用信息。
- 输入 Schema、结果 Schema、分页和大结果策略。
- 所需能力与允许的客户端来源。
- 影响等级：`read`、`metadata-write`、`file-write`、`destructive`、`external-effect`。
- 目标范围：资源库级、单实体、集合或 Job。
- 是否支持批量、预演、幂等键、取消、Detach 和 Undo。
- 原子性：单事务、可恢复文件操作或 best-effort 分项结果。
- 默认批准策略：无需批准、每次执行一次、高风险逐计划批准或禁止自动化。
- MCP 是否公开，以及公开时使用的工具分组和输出上限。

Desktop Console 帮助、JSON Schema、TypeScript 声明和 MCP 工具 Schema 从注册表生成或验证，不手写漂移的平行定义。

### 3. 执行上下文与范围

Automation Execution **可以没有当前资源库**（headless）。无库时只能执行不依赖资源库的 Action（例如 `library.create`）；创建后必须完成资源库打开/初始化并显式绑定，后续命令才能绑定到该资源库。已打开 Desktop 时，调用方仍必须显式提供目标库或先建库，不得从当前目录、最近打开记录、GUI 焦点或模型猜测隐式选择。

执行上下文包含：

- `executionId`、来源类型、脚本内容哈希或 MCP client 信息。
- 可选的目标资源库、API 主版本和 locale。
- 已授予能力、执行模式和批准凭据。
- AbortSignal、截止时间、资源预算和日志关联 ID。
- 对当前调用可见的变更序号（已绑定资源库时）。

跨资源库自动化拆为多个独立 Execution，或在同一 Execution 内显式切换目标库。第一版不承诺跨库原子提交或联合搜索。

### 4. Script Runtime

第一版支持 ES2022 JavaScript 和 TypeScript。Desktop 自动化中心是首个脚本入口：它提供 Console、保存/打开脚本、类型提示、执行历史和停止按钮。保存脚本使用 `.serpent.js` / `.serpent.ts`；第一版不提供终端 `run`/`repl` 命令。

保存脚本导出一个异步入口，宿主注入只读的执行上下文和 `serpent` API。REPL 直接提供同一 `serpent` 对象。脚本不得直接 import Serpent 内部模块；开发期提供独立 `.d.ts` 与编辑器提示。

脚本执行器必须：

- 位于独立、可强制终止的进程或同等级隔离单元。
- 默认没有 Node.js built-ins、`process`、环境变量、任意模块加载、文件系统和网络。
- 对 CPU 时间、墙钟时间、内存、输出大小、并发命令数和未完成 Promise 数设置硬上限。
- 支持协作取消和超时后强制终止；执行器崩溃不得带走 Main 或 Library Worker。
- 只通过受 Schema 校验的 RPC 调用 Gateway。

`node:vm` 不能被当作安全沙箱。首个实现任务先验证 QuickJS/WASM 或等价隔离引擎；只有宿主能力泄露、异步 RPC、TypeScript 转换、超时、内存、错误栈和跨平台打包门禁通过后才能确定运行时依赖。

### 5. Script API（领域 Action 面）

脚本 API 按领域组织，不暴露 transport 或数据库概念。Console 与 MCP 共用这一 Action 面。

**属于脚本/MCP Action（示例，非穷尽）：**

- 只读：资源库检查、文件夹/链接文件夹/标签/合集/智能合集列表、搜索与元数据、媒体及 AI Job 状态、Execution 日志引用。
- 低风险写入：评分、喜欢、标签创建/分配/移除、合集整理、空文件夹创建（已授予能力后可直接执行）。
- 高风险 Action：`library.create`、`file.import`、移动、重命名、回收站等——依赖写租约、预检、不可变计划摘要与**本机人类批准**（Console 与 MCP 同等；类比操作系统管理员权限提示）。
- AI：入队、查询、取消和重试；实际请求继续走持久 Job 与全局并发上限。

**不属于脚本/MCP（属插件 Contribution / 宿主，见 0024）：**

- 注册右键菜单、工具栏、面板、自定义工作区 UI。
- 注册领域 Hook、输入捕获、Provider。
- `storage.*` 插件命名空间存储、原始 `net.fetch`、任意 Shell/SQL/Node、永久删除与整库删除（首版仍禁止）。

API 优先提供批量方法。单项方法可作为批量便利包装，但仍经过同一 Gateway。

### 6. Automation Execution

每次运行都形成一个 Automation Execution，状态为：

```text
created
  -> validating
  -> awaiting-authorization?
  -> running
  -> awaiting-approval?
  -> succeeded | partially-succeeded | failed | cancelled | timed-out
```

Execution 记录：

- 来源、代码哈希、API 版本、可选目标资源库和能力集合。
- 开始/结束时间、资源使用和最终状态。
- 已调用命令的稳定 ID、对象数量、结果摘要和日志 ID。
- Job ID、Undo/恢复引用、失败代码和取消阶段。

Execution 记录不保存 API Key、Authorization header、完整秘密配置、任意二进制内容或未经脱敏的绝对外部路径。实现时复用已有 AppLogger；长期历史是否进入独立全局数据库由执行历史切片决定，不在 Library Worker 外复制资源库业务数据。

### 7. 能力与授权

能力名称使用稳定、可组合的领域词汇，例如：

- `library.read`
- `library.create`（或等价资源库生命周期能力，实现时与 Registry 对齐）
- `asset.read`
- `metadata.write`
- `tag.write`
- `collection.write`
- `folder.write`
- `ai.enqueue`
- `job.manage`
- `file.import`
- `file.move`
- `file.rename`
- `trash.write`

保存脚本静态声明最大能力。授权绑定脚本内容哈希、能力集合以及（若已选定）目标资源库；脚本、目标库或能力变化即重新授权。授权记录存放在 Agent 无法通过 Serpent API 修改的本地应用配置中。

REPL 和 Desktop Console 使用会话级授权。非交互 MCP 连接和 CI **不得自行创建或扩大写授权**；写授权与高风险计划批准均由本机人类 UI（或真实 TTY）签发。MCP 不提供“授予自己权限”的工具。

高风险 Action 的计划批准对 Console 用户与 MCP Agent 一视同仁：即使用户亲自运行脚本，导入/建库/批量文件变更仍须展示影响摘要并等待确认，不得静默执行。

能力不是领域校验的替代品。即使拥有 `file.move`，命令仍需执行路径、冲突、实体版本、资源库状态和写租约校验。

### 8. 写入计划与批准

只读、普通元数据写入与真实文件/资源库生命周期操作采用不同策略：

- 只读命令无需批准。
- 已持久/会话授权的元数据、标签、合集、空文件夹创建等低风险写入可直接执行，并返回逐项结果。
- 高风险 Action（含 `file.import`、`library.create`、移动、重命名、回收站等）必须先产生不可变计划摘要，至少包含目标数量、源/目标范围、冲突、不可执行项、可撤销性、undo group 预期范围和预计后台任务；再由本机人类批准（Console 与 MCP 相同交互等级）。
- 计划以内容哈希绑定参数、当前实体版本和资源库变更序号（已绑定库时）；批准后若任一前提变化，计划失效并重新预检。
- 不保证跨多条领域命令全局事务。每个命令按其声明的单事务、可恢复文件操作或 best-effort 语义执行，Execution 明确报告部分成功。
- 可撤销命令以 `undoGroupId` 组织同一用户意图下的一个或多个领域操作。应用级 Undo 以组为边界，不暴露组内半完成状态；部分成功时返回可撤销子集、不可撤销原因和恢复引用。未来桌面快捷键 `Ctrl/Cmd+Z` 复用同一 undo group，不允许另建一套仅 UI 可见的撤销语义。

Agent Host 侧的额外确认不能代替 Serpent 的能力授权和计划前提校验，也不能让 Agent 自行提权。

### 9. MCP Adapter

使用本地 stdio transport，由 Agent Host 以 `serpent mcp`（或等价启动器）启动。它是连接生命周期内的 headless 进程，不注册系统服务，不监听公网，也不要求 Desktop GUI 正在运行。

MCP 工具面与脚本 `serpent` Action 面同源：只读与写入工具均由同一 Registry 的 MCP 元数据映射，结果、错误码与计划批准语义与 Console 一致。大结果必须分页或返回游标 / Resource URI。

MCP **不**公开：

- 任意 JavaScript/TypeScript `eval` 或未授权的脚本执行旁路。
- Shell、SQL、任意文件系统、原始网络请求。
- API Key 或完整 AI 配置。
- 永久删除和整库删除（首版）。
- GUI 鼠标键盘控制、当前选区或隐式“焦点资源库”。
- 插件 Contribution API（注册菜单/Hook/UI）。

复杂工作流仍可由 Agent 生成 `.serpent.ts`，在 Desktop 或受控执行器中审阅授权后运行；不得用通用 `eval` 工具绕过 Gateway。

### 10. Process Architecture

```text
Desktop Renderer ──typed IPC── Main ───────────────┐
                                                   │
Desktop Console ──RPC───┐                          │
Script Sandbox ──RPC────┼── Automation Gateway ────┼── Library Worker
MCP stdio adapter ──────┘                          │   (SQLite/files/jobs owner)
                                                   │
Execution journal / AppLogger ─────────────────────┘
```

Desktop Console 复用现有 Main 与 Library Worker。MCP 在自己的连接生命周期内启动 process-local Library Worker。完整写入沿用 ADR-0021 的跨进程写租约、变更序号和 Job 原子领取；不新增常驻 daemon。

Script Sandbox 不能直接连接 Library Worker。所有调用先到 host 中的 Gateway，以便统一做能力、授权、日志、Schema 和执行状态管理。

### 11. Concurrency、Jobs 与取消

- Script 同时未完成的 Gateway 请求有独立上限，默认值由实现基准确定，不与 AI 并发设置混用。
- 同一资源库写入最终由写租约串行；脚本层并发不能绕过领域协调。
- AI 入队后由现有 AI Job 调度器执行，继续遵守用户设置的最大同时请求数，默认 16。
- 长任务返回 Job handle；脚本可等待、轮询、订阅有限状态或取消。
- Script 取消停止发起新命令，并向可取消的当前命令传播 AbortSignal；不可中断的文件阶段按恢复协议完成或进入可恢复失败状态。

### 12. Versioning

- Automation API 使用独立主版本，首版为 `1`。
- 保存脚本声明目标 API 主版本；不兼容主版本必须明确失败，不能静默改变语义。
- 命令和字段弃用至少保留一个发布周期，并在类型、帮助、MCP 描述和日志中一致标记。
- Script types、MCP server 和 Desktop 随同一 Serpent 版本分发，不允许协议包与应用悄悄漂移。

### 13. Observability

所有入口复用既有日志系统：

- stdout/MCP result 只承载协议结果，诊断进入日志。
- 每次 Execution 和失败命令返回 `logId`。
- 日志包含来源、命令 ID、Execution ID、耗时、重试、取消、能力拒绝和稳定失败原因。
- 日志文件与后台日志窗口可以按 Execution ID 过滤。
- 用户脚本的 `console` 输出单独标记并限量，不与 Serpent 内部诊断混淆。
- 日志脱敏测试覆盖 API Key、Authorization、用户脚本源中的显式 secret 和外部绝对路径。

### 14. Delivery Phases

#### Phase A：共享自动化契约

- 以现有 Worker protocol 为输入建立 Automation Registry。
- 建立 Gateway、执行信封和只读命令适配。
- 生成 TypeScript 声明和 MCP 候选 Schema。

#### Phase B：只读脚本原型与运行时

- 完成沙箱引擎原型门禁。
- 实现 Desktop Console、保存脚本、只读 `serpent` API、超时/取消和 Execution 日志。
- 在真实资源库验证数据库哈希不变。

#### Phase C：MCP 适配器（与脚本同一 Action 面）

- 实现 stdio server；工具由 Registry 映射，与脚本 Action 对照校验。
- 使用至少两个 MCP Host 做连接冒烟，但不宣称 Windows 通过直至实机。
- 证明 MCP 与 Script 对同一命令的结果、错误与计划批准语义一致。
- 实现上可先接通只读工具，但不得把“只读”写成 MCP 产品终态。

#### Phase D：授权与低风险写入

- 依赖 `Serpent-bb56.2` 的写租约、变更序号和 Job 领取。
- 实现能力声明、授权、元数据/标签/合集/空文件夹等批量写入和部分失败报告。
- Desktop 自动化中心显示脚本、授权和执行历史。

#### Phase E：文件计划、导入与建库

- 增加 `file.import`、`library.create`、移动、重命名和回收站预检计划。
- Console 与 MCP 对高风险 Action 使用同等本机批准 UI；禁止 Agent 自提权。
- 支持无当前库的 headless `library.create`，再建库后绑定后续命令。
- 永久删除与整库删除继续后置，直到恢复、Undo 和跨平台证据充分。

#### Phase F：打包、Skills 与扩展

- 将 Desktop 脚本运行时、类型声明与本地 `serpent-mcp` stdio 启动器纳入 macOS/Windows 安装包。`serpent-mcp` 仅为协议启动器，不提供通用 CLI 子命令。
- 从 Registry 生成/维护 Agent Skills。
- 评估 MCP 的受控脚本校验/计划工具、事件触发和计划任务。

## Testing Decisions

### 公共测试接缝

最高且唯一的公共行为接缝是 Automation Command Gateway。测试用真实 Registry 和受控 Worker fixture，验证同一命令在不同来源下的领域结果、错误、能力、日志和副作用一致。不得把 MCP JSON-RPC 或沙箱消息格式作为领域行为的主要测试入口。

### 自动化测试

- Registry 契约测试：ID 唯一、Schema 可生成、能力/影响/批准元数据齐全、公开 MCP 工具受限。
- Gateway 单元/集成：输入和结果校验、资源引用、错误脱敏、幂等、取消、日志 ID。
- 适配器契约：Desktop、Script、MCP 对相同 fixture 返回等价结果。
- Sandbox 对抗测试：`process`、Node built-ins、动态 import、环境变量、文件系统、网络、原型链逃逸、无限循环、Promise 风暴、内存膨胀和超量输出。
- Script 行为：循环、条件、函数、async/await、批量 API、异常和堆栈映射。
- 权限矩阵：未授权、能力不足、代码哈希变化、目标库变化、REPL 会话结束、非交互自授权拒绝。
- Execution 状态机：成功、部分成功、失败、取消、超时、执行器崩溃和应用重启后的日志/Job 对账。
- MCP 协议：initialize、tools/list、tools/call、分页、取消、超限结果、错误和 stdio 纯净。
- 只读证明：Script/MCP 在真实副本库运行前后数据库及托管文件哈希不变。
- 写入阶段：Desktop/Script/MCP 并发读写、租约超时、持锁进程崩溃、变更序号刷新、重复 Job 领取和计划失效。
- 打包阶段：macOS/Windows 安装、路径/Unicode、Ctrl+C、MCP Host 启停、脚本类型版本和卸载/重装。

功能变更必须同步更新相关测试；若 Registry 或 API 版本改变，Script types、MCP Schema、fixture 和说明必须在同一增量更新。

### 人工与真实 Agent 验证

- Desktop Console 视觉、授权文案、高风险批准弹窗、执行历史和停止操作使用 Computer Use 验证。
- 用 Desktop Console 与 MCP Host 各调用同一组 Action（含至少一条高风险计划路径），核对结果等价。
- Agent 驱动「建库 → 导入/整理」类工作流时，必须出现本机批准，且 Agent 无法自提权。
- 写入验收必须使用测试资源库；永久删除在进入范围前不提供验收入口。

## Out of Scope

- 任意 Node.js、npm/pip 依赖、Shell、SQL、环境变量、任意文件系统或原始网络（`net.fetch` 原始出口）。
- MCP / 脚本旁路 Gateway 的任意 `eval`。
- 跨资源库事务、联合搜索和跨机并发。
- 云端远程 MCP、开放公网端口和团队身份授权。
- 第三方脚本市场、签名、自动更新和供应链信任。
- 定时任务、文件事件触发器和应用关闭后通用脚本常驻（常驻扩展走插件 Job/Hook）。
- 插件 Contribution API（菜单/Hook/UI/输入捕获）作为脚本或 MCP 工具。
- 永久删除与整个资源库删除（首版）。
- GUI 鼠标键盘自动化和当前选区控制。
- Python SDK；先验证 JS/TS 模型，再根据 DCC 集成需求决定。

## Further Notes

- 研究依据见 [`agent-interface-choice-after-agents-2026-07-28.md`](../research/agent-interface-choice-after-agents-2026-07-28.md)。
- 已撤回的 CLI 代码不复用。Registry 从现有 Worker protocol 迁移；不得创建按入口复制的平行 Registry。
- 沙箱引擎是必须先用原型证明的技术风险。候选 QuickJS/WASM 只是默认方向，不在缺少泄露、性能与打包证据时直接锁定。
- 完整写入依赖 `Serpent-bb56.2`。Phase A–C 可以在 v0.1.0 发布收口期间并行，Phase D 以后不得绕过写租约前置条件。
