# Serpent 自动化脚本平台设计

> 状态：已获产品负责人批准，2026-07-31
>
> 上位规格：`docs/internal/implementation/0023-automation-scripting-mcp-framework.md`
> 上位决策：`docs/internal/adr/0025-automation-core-script-runtime-and-mcp.md`

## 目标与范围

完成 0023 Phase A–F 的脚本化能力：

- Desktop Automation Console：交互式 JS/TS、保存/打开脚本、授权、执行历史、日志定位、停止/取消。
- Script Runtime：独立、可终止、受资源限制的 UtilityProcess，只注入 `serpent` 领域 API。
- Automation Gateway：Registry、Schema、能力、影响等级、计划、批准、取消、Undo/恢复和日志的唯一领域接缝。
- MCP：本地 stdio 协议适配器，与 Console 共享完全相同的 Action 面和错误/批准语义。
- 完整写入：`library.create`、`file.import`、移动、重命名和移入回收站的 Execution Plan 与本机批准。
- Headless：无当前资源库时只能先执行建库；资源库创建后必须成功打开并显式绑定，后续 Action 才能执行。
- 分发：同版本 Registry、TypeScript 声明、MCP 启动器、Skills、macOS/Windows packaged 证据。

本设计不包括插件的菜单、UI、Hook、Input Capture、Provider 或长期后台 Contribution；不恢复通用 CLI；首版继续禁止永久删除和整库删除。

延后（已批准顶层设计，不插队本主线）：Desktop 附着 MCP 与可见执行——`docs/internal/superpowers/specs/2026-07-31-desktop-attached-mcp-design.md`，工单 `Serpent-lq5y`。

## 推荐实现顺序

### 1. 写协调与 Phase E

先收口 `Serpent-bb56.2`：完成每资源库写租约、持久变更序号、长 Job owner/heartbeat/fencing、跨进程变更刷新和崩溃恢复对账。所有自动化写命令必须经过这一层，不能由脚本或 MCP 直接访问 Worker。

随后完成 `Serpent-y51c.8`：

1. Registry 为高风险 Action 声明计划和批准元数据。
2. Gateway 根据已解析的 Execution 上下文创建不可变计划。
3. 计划绑定规范化输入、目标/源范围、冲突、不可执行项、可撤销性、Job 影响、实体版本和资源库变更序号。
4. 批准只接受 Main 签发的本机凭据；调用方提交的能力、库 ID 和批准字段不能成为授权来源。
5. 批准后任一前提变化都返回稳定的计划过期错误，要求重新预检。
6. `library.create` 在无库 Execution 中运行；成功后必须完成资源库打开/初始化并返回稳定库引用，后续命令显式绑定该库；未打开/绑定时拒绝其他 Action。
7. `file.import`、移动、重命名、回收站沿用既有文件恢复与部分成功语义；可撤销结果归入可组合的 `undo group`；永久删除继续禁止。

### 2. Console 与同源 MCP

完成 `Serpent-y51c.9`，Renderer 只通过 typed IPC 调用 Main：

- Console 代码和保存脚本使用同一 `serpent` API。
- 保存脚本的授权绑定脚本内容哈希、能力集合和目标库。
- Console 授权是会话级；修改代码、目标库或能力集合自动失效。
- 执行历史只显示脱敏摘要、稳定错误码、Execution ID 和 log ID。
- 停止操作先阻止新 Gateway 请求，再向当前可取消命令传播取消信号。
- 高风险命令显示与调用来源无关的计划摘要和本机批准弹窗。
- 每个可撤销命令返回 `undoGroupId` 和组内操作引用；未来用户可通过 `Ctrl/Cmd+Z` 在应用级撤销整组已完成操作，不能只撤销组内半个文件阶段。

同步补齐 MCP 写工具：

- `tools/list` 由 Registry 生成，不能手写另一套命令描述。
- `tools/call` 只能通过 Execution resolver 和 Gateway。
- MCP 不提供自授权、任意 eval、Shell、SQL、任意文件系统、原始网络、秘密配置或永久删除。
- Console 与 MCP 对同一 Action 使用同一输入/结果 Schema、稳定错误码和计划批准语义。
- stdout 只输出 MCP 协议帧；诊断进入 AppLogger。

### 3. 分发与终态验证

完成 `Serpent-y51c.10`：

- packaged 应用内包含 Script Runtime、Registry、类型声明和 MCP stdio 启动器。
- Registry/API/类型/MCP Server 使用同版本标识，构建时检查漂移。
- 从 Registry 生成或校验 Agent Skills，文档不得宣称超出 Registry 的能力。
- 验证 macOS/Windows 的 Unicode 和空格路径、MCP Host 启停、终止信号、升级/卸载、资源库保留。
- 运行至少两个 MCP Host 的配置和连接冒烟。

## 数据流与边界

```text
Desktop Console ── typed IPC ──┐
Script UtilityProcess ── RPC ──┼── Main Execution Resolver
MCP stdio host ────────────────┘             │
                                             ▼
                                  Automation Command Gateway
                                  Registry / auth / plan / log
                                             │
                                             ▼
                                      Library Worker
                                  SQLite / files / jobs owner
```

Renderer、脚本和 MCP 都不能提交可作为授权依据的 `source`、能力集合或目标库。Main 根据 `executionId` 解析这些字段，并在 Gateway 统一校验。无库 Execution 只能执行 `library.create`；创建后的库必须先完成打开/初始化和 Execution 绑定，才能继续执行其他 Action。脚本执行器崩溃、超时或被强制终止时，Main 和 Library Worker 必须继续存活；已进入领域命令的文件阶段按恢复协议收口。

## 错误与安全

- 输入、结果和计划均由 Zod Schema 校验。
- 资源引用使用稳定 ID 或显式资源库路径；显示名称不得被当作唯一身份。
- 用户可见错误提供可操作的稳定原因；绝对路径只进入本地诊断日志，不跨 IPC 暴露。
- 执行记录不保存 API Key、Authorization、环境变量、完整秘密配置、二进制内容或未经脱敏的外部路径。
- 计划过期、能力不足、未打开资源库、库繁忙、冲突、源文件消失、取消和部分成功分别使用稳定错误/结果结构。
- Undo 以 `undoGroup` 为边界：组包含同一用户意图下的一个或多个领域操作，只有组达到可撤销终态后才暴露给应用级 Undo；组内部分成功必须返回明确的可撤销子集和不可撤销原因。
- 可信插件的直接 Node 行为不属于脚本安全边界；插件 Contribution 继续由 0024/0026 管理。

## 测试与完成定义

每个阶段先写失败测试，再实现最小行为：

- Registry 契约：ID、Schema、能力、影响、批准、MCP 公开元数据完整且唯一。
- Gateway：上下文解析、权限拒绝、计划哈希、版本失效、幂等、取消、日志脱敏。
- Worker/跨进程：租约、变更序号、heartbeat/fencing、重复 Job、崩溃恢复、部分成功和 undo group 对账。
- Runtime：Node/FS/网络/动态 import 隔离，循环、Promise 洪水、内存/输出上限、取消和进程崩溃。
- Console/MCP：同 Action 结果等价、stdout 纯净、分页、审批、自授权拒绝和终止信号。
- Electron E2E：无库 headless 建库后打开/绑定、未绑定时拒绝后续 Action、计划批准、导入后恢复、完整应用重启和日志对账。
- packaged/平台：当前 HEAD 重新构建后执行 macOS/Windows 安装、启动、卸载、重装和资源库保留。

自动化通过不等于人类验收通过；Computer Use、Windows 和 packaged 未执行的项目必须保留为未验证。每个可由人独立操作的新能力与代码、测试、开发日志同一增量更新 `docs/internal/qa/human-acceptance-checklist.md`。
