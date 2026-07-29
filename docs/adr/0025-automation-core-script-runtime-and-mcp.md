# ADR-0025：统一自动化核心，脚本与 MCP 分层开放

- 状态：已接受
- 日期：2026-07-28
- 替代：0011 一等 CLI 切片；其已实现的只读基础层已撤回
- 保留：ADR-0021 的独立客户端、无常驻 daemon、Library Worker 所有权与短暂写协调

## 背景

复杂资产工作流需要循环、条件、函数、并发和复用；把这些能力重新发明成大量 CLI 参数会形成低效且难维护的流程语言。此前曾实现只读 CLI 基础层，但产品决定撤回该入口，避免在公共能力尚未稳定时增加另一套面向用户的命令行协议。另一方面，把任意 Node.js、SQL、文件系统或网络能力直接交给 Agent，会绕过资源库不变量、权限、Undo、日志与崩溃恢复。结构化 MCP 工具适合高频受控操作，脚本适合无法穷举的复杂长尾，两者必须共享同一业务核心。

## 决策

- `Automation Command Gateway` 是 Desktop、脚本、MCP、Skills 和自动化测试的唯一规范能力接缝。领域命令、输入/结果 Schema、错误、能力要求、副作用、幂等、取消、预演、Undo 与长任务元数据在同一注册表定义。
- 本阶段不提供通用 CLI、`serpent run` 或 `serpent repl`。脚本由 Desktop 自动化中心的 Console 运行、保存和管理；将来若重新引入无界面脚本启动器，必须以新的 ADR 明确其分发、权限和稳定协议，而不能复活已撤回的 CLI 代码。
- JS/TS 自动化是复杂工作流的主要编程表面。脚本运行在独立、可终止、受资源限制的执行器中，只能调用注入的 `serpent` API；不得访问 Node.js 内建模块、任意 import、进程环境、SQLite、任意文件系统或网络。
- MCP 是本地 Agent 的结构化工具适配器。第一阶段只提供 stdio transport 和精选只读工具；工具由同一命令注册表映射，但不会把全部命令、任意脚本执行、Shell、SQL 或秘密配置自动暴露给模型。
- 每次脚本或 MCP 会话必须显式绑定一个资源库。第一版不提供跨资源库事务；跨库工作拆为独立执行。
- 每次脚本运行形成 `Automation Execution`，记录来源、代码哈希、目标资源库、能力授权、命令轨迹、结果摘要、取消/超时状态和日志关联 ID。日志必须脱敏，API Key 与秘密配置永不进入脚本、MCP 输出或执行记录。
- Script/MCP 请求只能提交 `executionId`、命令 ID 与经过 Schema 校验的输入；资源库、来源和能力集合只能由 Main/Execution journal 按 `executionId` 解析。调用方提交的 envelope 不得成为授权或跨库读取依据。
- Agent 生成的代码与本地下载的脚本均按不可信输入处理。保存脚本声明最大能力；授权绑定脚本内容哈希、资源库和能力集合，代码改变即失效。交互式 Console 只获得会话级授权。
- 普通元数据、标签和合集写入可在获得能力授权后调用语义化批量命令；文件移动、重命名、导入、回收站、永久删除等高风险操作还必须经过领域预检、计划摘要与批准策略。永久删除不进入首个脚本/MCP 写入切片。
- Script/MCP 的完整写入依赖 ADR-0021 所需的跨进程写租约、变更序号、原子任务领取和恢复语义。只读脚本与只读 MCP 可以先行。
- 不新增系统级常驻 daemon。Desktop 内的 Console 复用其 Main 与 Library Worker；本地 stdio MCP 在自身连接生命周期内启动 headless host 与 process-local Library Worker。

## 后果

- 以现有 Worker request/response schema 为迁移输入建立通用自动化命令注册表；不得恢复 `cli-command-registry` 或让 MCP 自己维护平行领域描述。
- 脚本沙箱不能依赖 `node:vm` 冒充安全边界；实现前必须通过隔离、超时、内存、取消和宿主能力泄露原型门禁。
- MCP 工具数量保持小而稳定，大结果使用分页或资源引用，避免把整个资源库和大 Schema 塞进模型上下文。
- Desktop 自动化中心（Console 与保存脚本）和 MCP 可以分阶段交付，但不得各自复制领域实现。
- 插件系统复用能力与授权词汇，但安装、第三方依赖、长期后台触发和可信 Node 边界由
  [ADR-0026](0026-plugin-runtime-installation-and-trust.md) 与
  [0024 规格](../implementation/0024-script-plugin-platform.md) 单独定义。
