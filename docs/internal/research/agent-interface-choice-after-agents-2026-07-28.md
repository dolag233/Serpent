# Agent 时代的软件能力接口：CLI、脚本运行时与 MCP

> 调研日期：2026-07-28。范围：只采用厂商官方文档、公告或官方仓库。本文的「厂商事实」只复述来源明确写出的内容；「选型推断」是 Serpent 团队基于该事实作的解释，不能倒读成厂商声明。
>
> 2026-07-28 产品范围决定：本文保留 CLI 的行业案例和利弊，但 Serpent 当前撤回通用
> CLI 及其已实现的只读基础层，优先交付 Desktop Console 的受控 JS/TS 脚本与本地 stdio
> MCP。本文关于 CLI 的结论是备选架构信息，不是当前实现授权。

## 口径说明：真实样本并不对称

若严格限定为「原本已有 GUI/领域能力的软件，在 Agent 普及后新增入口让 Agent 操作」，公开样本并没有均匀分成 CLI 与脚本两派：

- 明确把 **CLI 作为 Agent 首选入口**、并公开解释原因的案例已经出现，例如 Playwright CLI。
- 图形软件和高状态软件通常没有把任意脚本直接作为唯一入口，而是采用 **MCP/结构化工具作为控制面，脚本作为长尾逃生口或内部实现层**。Roblox Studio、Unreal Editor 都属于这种混合方案。
- OpenAI Agents SDK、Vercel AI SDK 能说明「函数/脚本运行时为什么适合组合 Agent 工具」，但它们是 Agent 开发框架，不是既有桌面软件被 Agent 化的同类样本，不能拿来直接证明桌面软件应优先脚本化。
- Blender、Unity、Photoshop 的广泛脚本执行式 Agent 集成，目前不少来自社区项目而非原厂；这些项目是其自身架构的一手来源，但不能表述成 Blender、Unity 或 Adobe 的官方选型。

因此本文不强行凑成「三款官方 CLI 软件对三款官方脚本软件」。样本本身透露出的趋势更重要：**面向 Agent 的公开入口趋向结构化工具；CLI 是 coding agent 的低上下文适配；脚本负责无法预先枚举的复杂控制流。**

## 先给结论

「支持 Agent」不是 CLI 和脚本的二选一。2025–2026 的一手样本实际分出三层：

| 入口 | 最适合谁拥有执行环境 | 强项 | 主要代价 |
| --- | --- | --- | --- |
| CLI + Skill | Agent 已有 shell/workspace，且操作可拆成短的确定性命令 | 安装零耦合、可供人/CI/Agent 共用、容易存档和复现 | 跨命令状态、对象传递和长任务需要额外协议 |
| 进程内脚本/SDK 工具 | 产品或集成方拥有 Node/Python 等运行时 | 类型、事务/会话、并发、事件与授权检查可在一次调用中组成程序 | 调用者必须安装并维护语言运行时/依赖；不是所有 Agent host 都能嵌入 |
| MCP / 结构化工具服务 | 希望接入很多不同 Agent host，且需要 schema 发现、OAuth 或持续上下文 | 标准化 discovery、精确参数 schema、远程/桌面连接都可行 | 工具 schema 与返回内容会消耗上下文；仍需定义写入确认、权限和幂等 |

因此，对 Serpent 最合理的不是「只做 CLI」或「让 Agent 任意执行 JS」，而是：**核心应用服务/typed command 是唯一能力源；JS/TS 自动化 API 是复杂工作流的主表面；CLI 和未来 MCP 都是同一 command 的受控适配器。**CLI 仍应独立做好，因为这是 Agent host 已有 shell 时成本最低的入口；MCP 只暴露精选、高价值、可安全授权的工具。

## 一、CLI 中心的 Agent 接入

### 1. Microsoft Playwright CLI（2026）

- **厂商事实：**[官方仓库](https://github.com/microsoft/playwright-cli)把 `playwright-cli` 定位为给 coding agent 使用的 CLI，要求项直接列出 Claude Code、GitHub Copilot 或其他 coding agent；它可安装 Skills，且 `--help` 本身可供没有 Skill 的 agent 发现能力。仓库还明确比较 CLI 与 MCP：CLI+Skill 避免把大型工具 schema 和冗长 accessibility tree 装入模型上下文，因而更省 token；MCP 更适合需要持久状态、丰富页面检查和长时间探索循环的情形。
- **厂商事实：**命令将浏览器会话保留在命名 session 中；每个命令后把 snapshot 写到文件，并返回该文件引用，而不是把整页内容直接塞入命令输出。[README](https://github.com/microsoft/playwright-cli#sessions) 同时提供 `run-code` 执行 Playwright 代码片段。
- **选型推断：**这是「Agent 已经会运行 shell」的强样本：小命令适合高频行动，Skill 负责教 agent 编排；把大观察结果留在工作区文件，是主动控制 context 成本，而不只是把旧 API 改名成 CLI。

### 2. Vercel CLI 的 `vercel api`（2026-01）

- **厂商事实：**Vercel 在[发布公告](https://vercel.com/changelog/introducing-the-vercel-api-cli-command)中明确说 `vercel@50.5.1` 的 `api` 命令是「AI agents through the CLI」的直接入口；Claude Code 等只要拥有该环境和 CLI 即可调用，不另配 Agent 专用连接，并继承用户已在 CLI 中拥有的权限。`vercel api ls` 可列出可用 API，命令可交互构建或直接请求 endpoint。
- **厂商事实：**[CLI 概览](https://vercel.com/docs/cli)同时把 CLI 定义为可在终端或 automated system 中操作平台；CI 无人工输入时以 token 认证。
- **选型推断：**Vercel 选择 CLI 的关键不是「函数签名只能在 CLI 中表达」，而是复用既有本地凭据/环境与 shell 分发面，并以 `api ls` 补上大量 API 的发现问题。这种方式特别适合云 API 的长尾覆盖；对本地 Serpent，不能据此推导为 CLI 应直接持有 SQLite。

### 3. Lark/飞书 `lark-cli`（2025–2026 持续演进）

- **厂商事实：**[第一方仓库](https://github.com/larksuite/cli#readme)将它称为为「humans and AI Agents」构建的官方 CLI，提供 Agent Skills、默认结构化输出，以及 shortcuts / API commands / raw API 三层命令面。其 README 还公开 JSON success/error contract、分页和 schema inspection。
- **厂商事实：**同一来源把高风险动作的确认、dry-run 与 Agent 使用安全说明放在 Skill/命令契约中，而非假定 OAuth 后可无限自动执行。
- **选型推断：**这是 CLI 能做得很完整的反例：CLI 的价值不在语言能力，而在把**同一业务能力**做成可发现、可枚举权限、可审计的外部协议；Skill 是工作流说明层，不能取代命令的输入/输出与失败契约。

## 二、脚本/运行时中心：把能力作为应用内可组合函数

这里的「脚本」不是“先写一个文件再启动”。它可以是 Node/Python 服务里的函数、REPL、保存的 automation 或一次交互执行。此类产品的共同点是：**Agent 的执行器与业务函数在同一应用/受控运行时内**，而不是每次绕经 shell。

### 0. 更符合问题本身的桌面软件样本

#### Roblox Studio：结构化工具为主，Luau 是通用逃生口

- **厂商事实：**Roblox Studio 现已[内置 MCP server](https://create.roblox.com/docs/studio/mcp)。Agent 可通过 `script_read`、`multi_edit`、`search_game_tree`、输入模拟和 playtest 等结构化工具操作当前 Studio；同时也提供 `execute_luau`，可在 Edit、Client 或 Server data model 中执行 Luau。
- **选型推断：**Roblox 没有在「几十上百个细粒度工具」和「只给一个 eval」之间二选一。常见操作使用可描述、可限制的工具；复杂循环、批量数据模型变换和项目特有逻辑交给 Luau。脚本在这里的价值是覆盖工具列表无法穷举的长尾，而 MCP 负责发现、连接与边界。

#### Unreal Editor：MCP 同步编辑器状态，Python/C++ 编写可复用 Toolset

- **厂商事实：**Epic 的[Unreal MCP](https://dev.epicgames.com/documentation/unreal-engine/unreal-mcp-in-unreal-editor)把 MCP server 嵌入 Editor，通过本地 HTTP 让 Agent 调用 typed Tools；调用会串行同步到 game thread。Toolset 可用 Python 或 C++ 编写，注册后由 MCP 自动包装，同一 Toolset 还能被其他 AI surface 复用。
- **选型推断：**它选择结构化工具而不是让外部 Agent 任意执行 Python，核心原因是 Unreal 是有严格线程与生命周期约束的状态应用。脚本仍然重要，但位置是在产品内部扩展工具面，而不是绕过 game thread 和 Undo/状态约束。

#### Photoshop/Blender 社区桥：广域脚本很强，也暴露了风险

- **项目事实：**社区项目 [Photoshop MCP](https://github.com/alisaitteke/photoshop-mcp)明确说明，直接让 Agent 拼 ExtendScript 很脆弱，会造成反复试错、类型错误和失败后文档状态未知，因此它在底层 ExtendScript 之上增加 state、preview、capabilities、recipe、统一错误和单步 Undo。项目使用 ExtendScript，是因为 Photoshop 的外部 AppleScript/COM 自动化不能直接调用 UXP。
- **项目事实：**社区项目 [BlenderMCP](https://github.com/ahujasid/blender-mcp)提供 `execute_blender_code`，直接利用 Blender 既有 Python API 覆盖建模长尾；项目同时明确警告该能力可以执行任意 Python，功能强但危险。
- **选型推断：**这是脚本方案最诚实的两面：已有成熟领域 API 时，Agent 一次生成程序即可获得循环、条件和批量操作，开发成本远低于手写全部工具；但 raw script 缺少稳定的状态回执、Undo 边界和最小权限。因此成熟方案往往会在脚本外再包 plan、preview、recipe、日志和确认机制。

### 1. OpenAI Agents SDK：本地函数就是 Agent 工具

- **厂商事实：**[Python Tools 文档](https://openai.github.io/openai-agents-python/tools/)把 function tool 定义为「wrap any Python function」；SDK 从函数签名、docstring 和 Pydantic 自动生成输入 schema。工具调用由模型提出、由应用/本地运行时实际执行；文档还提供本地 shell、computer、patch 等 execution tool，以及审批、并发上限与 guardrail 配置。
- **厂商事实：**[TypeScript SDK](https://openai.github.io/openai-agents-js/)明确把 TypeScript-first orchestration、函数工具、sandbox、human-in-the-loop 和 tracing 作为设计理由；Agent loop 负责把工具结果送回模型继续运行。
- **选型推断：**脚本运行时更适合一个自动化要在同一事务/会话中查询、判断、批量修改、重试并记录证据的情况：宿主能够在调用前后统一做权限、取消、并发和审计。它不是把「任意 Python」暴露给 Agent；恰恰相反，Agent 只看到应用明确注册的函数与 schema。

### 2. Vercel AI SDK：本地 typed tools 优先于 MCP

- **厂商事实：**[AI SDK 的 tools 文档](https://ai-sdk.dev/docs/foundations/tools)规定一个本地 tool 包含 description、Zod/JSON input schema 与 async `execute`；schema 同时用于模型消费和参数校验，执行结果再回到模型。其[Agent 文档](https://ai-sdk.dev/docs/agents/agent-class)把多步 tool loop、可复用 agent 和 TypeScript 的端到端类型支持列为直接目标。
- **厂商事实：**[AI SDK 对比文档](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)明确建议生产应用多数情况下优先自定义 AI SDK tools：它们具备完整静态类型、同一请求进程内低延迟执行、且应用能控制 description/schema；MCP 是运行时动态发现、独立 server/network 开销、由 server owner 控制 schema 的选择，较适合快速迭代或用户自带工具。
- **选型推断：**这是对“写文档就等价于 CLI tool discovery”的准确反驳：静态可组合的函数 API 在编译期就有类型、可在一次函数调用里保持对象/事务；但它以调用者采用 SDK 为前提。所以 Serpent 的内嵌 JS API 很有价值，却不能取代独立 CLI/MCP 的跨宿主入口。

### 3. Figma：脚本运行时实现写入，但不把 `eval` 暴露给 Agent（混合案例）

- **厂商事实：**Figma 的[官方 MCP FAQ](https://help.figma.com/hc/en-us/articles/39252411778583-Figma-MCP-server-FAQs)说明 `use_figma` 是一个 MCP tool，Agent 可借此创建/修改真实 Figma object；该 tool 的实现会执行 Plugin API code。Figma 同时把 `/figma-use` Skill 定义为教 agent 正确使用该 tool 的 Markdown 工作流说明，明确说 tool 与 Skill 都需要。
- **厂商事实：**[MCP 入门文档](https://help.figma.com/hc/en-us/articles/39216419318551-Get-started-with-the-Figma-MCP-server)说明工具读写的是组件、变量、布局等结构化设计数据；写 canvas 有 seat/权限限制，非草稿区域的 Dev seat 为只读。
- **选型推断：**Figma 的重要选择不是把 Plugin API/JavaScript console 原样交给模型，而是保留脚本运行时的对象模型与权限边界，再向外发布少量语义化工具。Serpent 可仿效这个边界：内部的 JS/TS API 可强大，但 Agent-facing surface 应是 `asset.moveMany` 这类有 scope/plan/approval 的命令，绝非通用 `eval` 或 SQL。

## 三、MCP/结构化工具服务：解决跨 Agent host，而不是取代核心 API

### 1. Chrome DevTools MCP（2025-09 起）

- **厂商事实：**Chrome 在[发布公告](https://developer.chrome.com/blog/chrome-devtools-mcp)中把 MCP server 定义为把 DevTools debugging capability 带给 AI coding assistants，理由是 coding agent 仅看源码无法看到浏览器实际运行行为；以 `performance_start_trace` 为例，模型调用的是结构化工具。新版[接入文档](https://developer.chrome.com/docs/devtools/agents/get-started)支持多种 MCP host，并警告 Agent 能读取和操作所连接浏览器的内容。
- **选型推断：**当价值来自持续运行态、浏览器连接和丰富工具发现时，MCP 比「让 Agent 拼一串 DevTools CLI 参数」自然得多；但安全仍需用户显式授权连接，而非协议本身自动解决。

### 2. Figma MCP：跨编辑器的设计上下文与权限

- **厂商事实：**[Figma MCP 指南](https://help.figma.com/hc/en-us/articles/32132100833559-Guide-to-the-Figma-MCP-server)称 MCP 是 AI agent 与数据源交互的标准接口，提供 remote server 与 desktop server，支持 VS Code、Claude Code、Codex 等 client；Agent 可读结构化组件/变量/布局，并在授权范围内创建或修改原生 Figma 内容。
- **选型推断：**这说明 MCP 特别适合“用户已经选定任意一个 Agent host，希望同一产品不用为每个 host 写 SDK”的分发问题。它与前一节的 Plugin API 并不竞争：MCP 是适配/授权/发现层，Plugin API 是内部执行层。

### 3. Vercel MCP：同一产品保留 CLI、API 与 MCP

- **厂商事实：**[Vercel MCP 文档](https://vercel.com/docs/agent-resources/vercel-mcp)把它称为官方 MCP server，列出 Claude Code、ChatGPT、Codex CLI、Cursor、VS Code/Copilot 等受支持 client，并区分公开工具与需 Vercel 授权的工具。Vercel 同时保留 REST API 和前述 CLI `api` 命令。
- **选型推断：**这正是最有力的现实证据：成熟产品没有把 MCP 当作 CLI/SDK 的替代品，而是让三个入口覆盖不同 host 与工作方式；共同的权限模型和业务服务才是应被复用的核心。

## 对 Serpent 的可执行选择

1. **先定义 Automation API/typed command，而不是先定 CLI 参数或脚本全局对象。**命令必须有稳定 ID、输入 schema、结果 DTO、错误类型、权限/副作用元数据、幂等与取消策略。
2. **JS/TS automation runtime 是复杂自动化主入口。**它运行在隔离 Worker/子进程，只获得受控 `serpent` 对象；写入按 execution/plan 批次审计，可取消、可预览、可请求确认。
3. **CLI 是同一 command 的无界面适配器。**面向 Agent/CI 默认 JSON、显式 library、stdout/stderr 分离、退出码、`--dry-run`/确认令牌和逐项批处理结果；不直接读 SQLite、不依赖 GUI 当前选中项。
4. **MCP 后置且精选。**先暴露读取、查询、plan、任务状态与少量可授权写入；每个 MCP tool 映射到相同 command/schema，不能把「任意脚本执行」作为 MCP tool。

可用一个选择题检验具体能力：若 Agent host 已有 shell、动作短且可独立重放，优先 CLI；若需要事务、对象/会话、事件订阅或复杂控制流，优先脚本 API；若需要让很多不同 Agent host 发现一组受限工具或走 OAuth/持久连接，增加 MCP。一个能力同时有三种入口时，三者应复用**同一核心 handler 与安全策略**。
