# ADR-0025：统一自动化核心，脚本与 MCP 共享 Action 面

- 状态：已接受（2026-07-30 产品对齐修订）
- 日期：2026-07-28
- 修订：2026-07-30
- 替代：0011 一等 CLI 切片；其已实现的只读基础层已撤回
- 保留：ADR-0021 的独立客户端、无常驻 daemon、Library Worker 所有权与短暂写协调

## 背景

复杂资产工作流需要循环、条件、函数、并发和复用；把这些能力重新发明成大量 CLI 参数会形成低效且难维护的流程语言。此前曾实现只读 CLI 基础层，但产品决定撤回该入口，避免在公共能力尚未稳定时增加另一套面向用户的命令行协议。另一方面，把任意 Node.js、SQL、文件系统或网络能力直接交给 Agent，会绕过资源库不变量、权限、Undo、日志与崩溃恢复。Console 脚本与 MCP 必须共享同一业务核心与同一领域 Action 表面；二者的差别是调用者（人 vs Agent），不是能力子集。

## 决策

- `Automation Command Gateway` 是 Desktop、脚本、MCP、Skills 和自动化测试的唯一规范能力接缝。领域命令、输入/结果 Schema、错误、能力要求、副作用、幂等、取消、预演、Undo 与长任务元数据在同一注册表定义。
- 本阶段不提供通用 CLI、`serpent run` 或 `serpent repl`。脚本由 Desktop 自动化中心的 Console 运行、保存和管理；也可在 headless 宿主（如 MCP 连接生命周期内的 process-local host）中执行。将来若重新引入独立无界面脚本启动器，必须以新的 ADR 明确其分发与协议，而不能复活已撤回的 CLI 代码。
- JS/TS 自动化是复杂工作流的主要编程表面。脚本运行在独立、可终止、受资源限制的执行器中，只能调用注入的 `serpent` API；不得访问 Node.js 内建模块、任意 import、进程环境、SQLite、任意文件系统或原始网络。
- **Console 与 MCP 暴露同一套领域 Action 命令面**（只读与写入、含 `library.create`、`file.import` 等高风险 Action）。差别仅在调用者与 transport；不得维护「MCP 永久只读、脚本另有一套」的平行子集。分页、计划批准与错误契约在两端一致。
- MCP 是本地 Agent 的结构化工具适配器（stdio）。不暴露任意脚本 `eval`、Shell、SQL、秘密配置或未声明的 Node 接口。复杂长尾仍可由 Agent 生成可审查脚本，在获得人类授权后于受控执行器中运行；这与「MCP 工具面 = 脚本 Action 面」不矛盾。
- Automation Execution **可以没有当前资源库**（headless）：允许先执行 `library.create` 等不依赖已打开库的 Action，再把后续命令绑定到新建或显式指定的资源库。第一版不提供跨资源库事务；需要跨库时拆为独立 Execution 或在同一 Execution 内显式切换目标库。
- 每次脚本运行形成 `Automation Execution`，记录来源、代码哈希、可选目标资源库、能力授权、命令轨迹、结果摘要、取消/超时状态和日志关联 ID。日志必须脱敏，API Key 与秘密配置永不进入脚本、MCP 输出或执行记录。
- Script/MCP 请求只能提交 `executionId`、命令 ID 与经过 Schema 校验的输入；资源库、来源和能力集合只能由 Main/Execution journal 按 `executionId` 解析。调用方提交的 envelope 不得成为授权或跨库读取依据。
- Agent 与本地下载/粘贴的脚本均按不可信输入处理。能力授权由人类签发；**Agent/脚本不得自行提权**。高风险 Action（导入、建库、移动/重命名、回收站等）对 Console 用户与 MCP Agent **同等**要求计划摘要与本机批准 UI（类比操作系统管理员权限提示），不得因调用者是“用户自己”而静默跳过。
- 普通元数据、评分、喜欢、标签、合集、空文件夹创建等低风险写入可在已授予能力后直接执行；文件与资源库生命周期类 Action 走预检 + 计划 + 批准。永久删除与整库删除不进入首个写入切片。
- Script/MCP 的完整写入依赖 ADR-0021 所需的跨进程写租约、变更序号、原子任务领取和恢复语义。实现上可先交付只读，但产品边界不以“MCP 只读”为终态。
- 不新增系统级常驻 daemon。Desktop Console 复用其 Main 与 Library Worker；本地 stdio MCP 在自身连接生命周期内启动 headless host 与 process-local Library Worker。
- **插件 Contribution**（菜单、Hook、自定义 UI、输入捕获、Provider 注册）不属于脚本/MCP Action 面，由 ADR-0026 / 0024 定义。插件通过 Gateway 执行的领域 Action 与脚本/MCP 相同。

## 后果

- 以现有 Worker request/response schema 为迁移输入建立通用自动化命令注册表；不得恢复 `cli-command-registry` 或让 MCP 自己维护平行领域描述。
- 脚本沙箱不能依赖 `node:vm` 冒充安全边界；实现前必须通过隔离、超时、内存、取消和宿主能力泄露原型门禁。
- MCP 工具与脚本 `serpent` Action 同源生成或对照校验；大结果使用分页或资源引用，避免把整个资源库和大 Schema 塞进模型上下文。
- Desktop 自动化中心与 MCP 可以分阶段交付，但不得各自复制领域实现，也不得把 `library.create` / `file.import` 等 Action 错误划给“仅插件”。
- 插件系统复用能力与授权词汇，但安装、第三方依赖、长期后台触发、Contribution 和可信 Node 边界由
  [ADR-0026](0026-plugin-runtime-installation-and-trust.md) 与
  [0024 规格](../implementation/0024-script-plugin-platform.md) 单独定义。

## 2026-07-30 修订摘要

产品负责人确认：

1. Console 与 MCP 的领域 Action 内容应对齐，差别只在调用者。
2. `library.create`、`file.import` 等 Action 属于脚本/MCP；注册菜单/Hook/界面属于插件。
3. 高风险操作对用户脚本与 Agent 均需本机批准弹窗；禁止自提权。
4. 脚本按 headless 理解：无已打开资源库亦可建库。
