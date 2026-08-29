# MCP 细粒度权限与关键危险操作确认设计

- 状态：已废止（2026-08-10）；不得继续实施
- 日期：2026-08-10
- 关联：ADR-0025、ADR-0029、ADR-0030
- 替代范围：现有设备级“跳过高风险操作确认”布尔开关及 initialize 阶段的整包读/写授权

> 本设计已由[业务无状态、可无人值守的 MCP 设计](2026-08-10-stateless-unattended-mcp-design.md)和[ADR-0031](../../adr/0031-stateless-unattended-mcp.md)整体替代。原因：`allow-session`、运行时权限 Prompt 和 critical 人工窗口仍把正常 Agent 工作流绑定到短暂 session 与高频人类操作，不能满足默认 Auto、零人工参与的产品目标。本文只保留为历史记录。

## Problem Statement

当前 MCP 权限体验只有“只读/允许修改”和“跳过所有高风险计划确认”两种粗粒度选择。它无法表达“导入文件可以在本次会话中一直通过，但移动、回收站仍逐次询问”，也无法让用户在设置中按客户端管理长期信任。原生选择器、能力授权和执行计划确认还会形成多次、缺少上下文的提示。

产品需要类似 Cursor、Claude Code、Codex 的渐进授权：具体权限第一次使用时询问，用户可以仅通过本次调用，或在当前 MCP session 内总是通过；可信客户端可以在设置中持久化特定权限，或一次开启全部普通权限。同时，删除整库等关键危险、低频操作必须保持不可静默绕过的独立红色确认。

## Solution

Serpent 以现有 Automation Capability 作为稳定权限 ID，在 Desktop Main 中增加统一 Permission Broker。MCP credential 只证明客户端身份；资源库授权只允许该 session 使用某个库；具体命令是否可执行由权限策略和调用时风险共同决定。

普通读取能力默认允许。其余可授权能力默认询问，首次调用显示包含客户端、权限、目标资源库和执行计划摘要的权限提示，提供“拒绝”“通过”“本会话总是通过”。设置页按客户端 credential 保存 `ask` 或 `always-allow`，并提供“开启所有普通权限”快捷操作。Agent 不能在 MCP 参数中选择授权结果。

关键危险操作不参与会话授权、持久授权或“开启所有权限”。它们每次都打开专用 modal child window，只提供取消和红色确认按钮，不提供“总是通过”或“不再提示”。首个明确对象是“从磁盘删除资源库”；该操作继续不向 MCP 暴露，但使用同一风险分类和关键确认组件。

## User Stories

1. 作为首次连接 MCP 的用户，我希望复制 Agent 连接信息后客户端可以直接建立受控 session，而不是先对全部写权限做一次模糊授权。
2. 作为用户，我希望 Agent 第一次导入文件时看到“导入文件”这一具体权限，而不是笼统的“允许修改”。
3. 作为用户，我希望对一次导入选择“通过”，使该决定只覆盖本次已展示的操作。
4. 作为用户，我希望对“导入文件”选择“本会话总是通过”，使同一 MCP session 后续导入不再重复询问。
5. 作为用户，我希望 session 断开、超时、服务停止、credential 撤销或应用退出后，会话授权自动失效。
6. 作为用户，我希望一个客户端的会话授权不能被另一个客户端或新 session 复用。
7. 作为用户，我希望在设置中按客户端查看每个 MCP 权限是“每次询问”还是“总是允许”。
8. 作为用户，我希望把可信客户端的“导入文件”设置为总是允许，并让该决定跨 session 和应用重启保留。
9. 作为用户，我希望“开启所有权限”只影响当前选中的客户端，而不是所有现有和未来 credential。
10. 作为用户，我希望开启所有普通权限前看到清晰的高风险确认，并用红色按钮确认。
11. 作为用户，我希望关闭“开启所有权限”后，权限矩阵恢复为逐项询问，而不是留下隐藏授权。
12. 作为用户，我希望撤销 credential 时立刻终止该客户端 session，并使其持久权限一并失效。
13. 作为用户，我希望手动把某项权限改回“每次询问”时，当前活动 session 对该权限的缓存授权也立即失效。
14. 作为用户，我希望权限提示说明请求来自哪个客户端、针对哪个资源库、将处理多少项以及冲突或跳过数量。
15. 作为用户，我希望并发的同权限请求只出现一个可理解的提示，而不是弹出多个互相遮挡的窗口。
16. 作为用户，我希望取消权限提示或客户端断开后，不发生任何写入，也不留下待执行计划。
17. 作为用户，我希望已经“总是允许”的文件操作仍然经过 Worker 的版本、状态、冲突和计划校验。
18. 作为用户，我希望资源库授权与操作权限相互独立：允许导入不代表 Agent 可以切换到任意资源库。
19. 作为用户，我希望“开启所有权限”不包括删除整库、永久删除源文件等关键危险操作。
20. 作为用户，我希望从磁盘删除资源库时每次都看到独立窗口、不可逆说明和红色确认按钮。
21. 作为用户，我希望关键危险确认没有“不再显示”和“本会话总是通过”。
22. 作为用户，我希望关键确认默认焦点位于取消，按 Escape 取消，关闭窗口也取消。
23. 作为 Agent，我希望所有可请求工具仍能通过 `tools/list` 发现，并在调用需要权限时得到稳定的等待、拒绝或取消结果。
24. 作为 Agent，我希望等待用户决定时收到 progress/logging 信息，而不是把权限等待误判为网络卡死。
25. 作为维护者，我希望权限 ID、风险等级和命令映射来自单一 Registry，避免 MCP、设置页和确认 UI 各维护一份列表。
26. 作为维护者，我希望权限决策日志不包含绝对路径、token、文件内容或未脱敏的工具参数。
27. 作为 Windows 用户，我希望 modal owner、焦点、任务栏、关闭和崩溃恢复行为与 macOS 一致。

## Implementation Decisions

### 1. 权限单位与风险单位分离

- Automation Capability 是稳定权限 ID，例如 `file.import`、`file.move`、`trash.write`、`metadata.write`。
- Automation Command 继续声明所需 capability；一个 capability 可以覆盖语义相同的一组命令。
- 风险等级是命令/操作属性，不是 capability 名称。首版分为：
  - `safe`：读取和受限 info 通知，默认允许；
  - `controlled`：可改变资源库、文件、元数据或外部状态，可被单次、session 或持久策略授权；
  - `critical`：低频、不可逆或影响整个资源库/大量源字节，每次必须关键确认。
- Registry 是权限 ID、风险等级、计划要求和 MCP 暴露元数据的唯一来源。设置页和 Prompt 不手写另一份权限清单。

### 2. 四种不同证据

权限边界保持分层，任何一层不能推导下一层：

1. Client credential：证明是哪一个已配置客户端；
2. Library Authorization：允许当前 Automation Execution 使用某个资源库；
3. Permission Policy / Session Grant：允许调用某类 capability；
4. Operation Plan / Critical Confirmation：证明本次具体影响已校验或由用户逐次确认。

Credential 不携带资源库路径或隐式全权限。允许 `file.import` 不允许 Agent 自选磁盘路径；原生选择器仍由 Desktop 控制。

### 3. 权限决策与作用域

普通权限提示只有三种决定：

- `deny`：拒绝本次调用，不写入 grant；
- `allow-once`：只批准当前调用；若存在 Execution Plan，决定绑定其 plan hash、目标库和版本；
- `allow-session`：写入当前 Automation Execution 的内存 grant，直至 session 结束。

设置中的持久策略按 `(credentialId, capability)` 保存：

- `ask`：调用时询问；
- `always-allow`：该 credential 的任意新 session 可直接使用该普通 capability。

不提供 MCP 参数、环境变量或配置文件字段让客户端自行选择 `allow-session`/`always-allow`。持久策略只可由 Serpent 设置 UI 修改。

### 4. “开启所有权限”的准确语义

- 设置中的“开启所有权限”属于当前选中 credential，而不是整机全局默认。
- UI 开关由该 credential 的全部 `controlled` capability 是否为 `always-allow` 推导，不单独保存第二个真值来源。
- 开启时显示专用危险设置确认窗口，确认按钮为红色；确认后把全部当前 `controlled` capability 写为 `always-allow`。
- 关闭时把全部 `controlled` capability 写回 `ask`，并清除该 credential 活动 session 中对应的 session grants。
- 新版本新增 capability 时默认 `ask`；过去的“全部允许”不能自动覆盖未来新增能力。
- `critical` 操作永远不属于“全部权限”。

### 5. 调用时解析顺序

每个 MCP 调用按以下顺序处理：

1. 验证 credential、session、请求大小和取消状态；
2. 解析 Automation Execution 与目标资源库，完成必要的 Library Authorization；
3. 按 Registry 构造命令和只读影响摘要；需要计划的操作先生成 Execution Plan；
4. 若操作为 `critical`，始终进入关键确认；
5. 否则检查该 credential 的持久策略，再检查当前 Execution 的 session grant；
6. 均未允许时显示普通权限提示；
7. 批准后再次验证取消状态、上下文 revision、changeSequence、实体状态和 plan hash；
8. 通过 Gateway 执行，记录脱敏审计结果。

权限允许不替代 Worker 校验。计划在等待过程中变旧时返回稳定 stale 结果，并要求重新计划；不能用旧 Prompt 决定执行新目标。

### 6. 工具发现与 initialize

- initialize 不再弹出“只读/允许全部修改”的整包授权；credential 配对后建立 session，安全读取能力默认可用。
- `tools/list` 显示当前上下文中可请求的公共工具。`ask` 状态不隐藏工具，否则 Agent 无法触发权限请求。
- 调用受控工具时由 Permission Broker 决定直接执行、等待用户、拒绝或取消。
- 设置策略或 session grant 变化后发送 `notifications/tools/list_changed` 或等价的权限状态通知；工具输入 Schema 不暴露授权字段。

### 7. 普通权限提示

- 普通权限提示由 Desktop 主窗口承载，显示客户端名称、权限名称、目标资源库和安全摘要。
- 对需要 Execution Plan 的操作，权限提示与计划确认合并为一次交互，避免“先给权限、再确认计划”的双弹窗。
- 按钮顺序与平台习惯一致，语义固定为“拒绝”“通过”“本会话总是通过”；默认/关闭/Escape 都是拒绝。
- 同一 execution、capability 和等价计划的并发请求合并为一个 Prompt；不同计划串行排队。
- 客户端断开、请求取消、session 超时、库关闭或计划失效时 Prompt 自动取消。

### 8. 关键危险确认窗口

- `critical` 操作使用独立、Main-owned、带父窗口的 modal child window，而不是普通 toast、内联 Prompt 或不可测试的原生 message box。
- 窗口使用隔离 Renderer、窄 IPC 和运行时 Schema；不获得 Node、路径读取或通用自动化能力。
- 只显示取消和红色确认；取消为默认焦点，Escape/关闭窗口等价于取消。
- 每次调用都确认；不提供 session/persistent allow、不受“开启所有权限”影响，也不允许“不再显示”。
- 文案说明不可逆影响、对象名称、数量和恢复边界，但不向 MCP 返回绝对路径。
- 首批 critical 候选：从磁盘删除整个资源库、文件夹、托管资产、链接资产源文件、永久删除回收站资产和清空回收站。它们均由 Main 的请求类型和 `deleteFromDisk`/`deleteSourceFile` 语义显式分类，不能按字符串或 UI 入口猜测；当前仍不向 MCP 暴露这些命令。

### 9. 设置与撤销

- MCP 设置页按 credential 展示：名称、签发时间、最近使用、状态、权限矩阵和活动 session 数。
- 每项普通权限可在“每次询问/总是允许”之间切换；读取权限展示为默认允许但不可误称为写权限。
- 将持久项改回 `ask` 时，立即清除该 credential 活动 session 中同 capability 的 session grants，并通知活动客户端。
- 撤销 credential 会关闭其所有 session、清除内存 grant，并使持久策略不可再生效；保留脱敏审计记录。
- 旧 `skipApproval` 设置不迁移为持久全权限，避免升级后静默扩大权限。新产品直接移除该字段；旧开发态值按 `ask` 处理。

### 10. 审计与隐私

审计记录包含 credential ID、client name、execution ID、capability、command ID、library ID、风险等级、决定作用域、时间、结果和可选 plan hash。不得记录 bearer token、绝对路径、文件内容、API key 或完整工具输入。

设置修改、开启全部权限、session grant、单次拒绝、关键确认和因断开自动取消都需要可诊断事件。Agent 只收到稳定状态码和安全文案。

### 11. 跨平台

- 持久策略使用 Main 的受控原子 JSON 存储；Windows 替换/恢复语义与 credential、Execution Journal 一致。
- modal child window 必须在 Windows 正确绑定 owner，关闭父窗口或应用退出时自动取消，不能留下无主窗口或任务栏幽灵项。
- macOS 和 Windows 的按钮视觉、危险红色、默认焦点和键盘行为保持语义一致；布局允许平台字体和系统缩放差异。

## Testing Decisions

- 最高价值测试接缝是“Registry 命令 + credential policy + Execution session grant + plan 风险 → Permission Broker 结果”的状态矩阵。它必须覆盖 `ask`、持久允许、session 允许、单次允许、拒绝、取消和 critical 强制确认。
- Gateway 集成测试从真实命令 envelope 进入，证明普通权限只弹一次、`allow-session` 只在同 execution 生效、持久策略跨新 session 生效，且任何允许都不跳过 Worker plan/version 校验。
- 标准 Streamable HTTP MCP client 测试证明 requestable 工具可发现、调用等待期间有 progress、断开会取消 Prompt、新连接不继承 session grant。
- 设置 Store 测试覆盖按 credential 持久化、旧 `skipApproval` 安全降级、未来新增 capability 默认 `ask`、撤销和 Windows 崩溃恢复模型。
- Electron E2E 覆盖普通 Prompt 三按钮、开启全部权限的红色确认、critical 独立窗口、默认焦点、Escape、父窗口关闭和重复 Prompt 合并。
- 删除资源库从磁盘必须有独立的真实 Electron E2E：取消不删除；确认后库目录消失；链接源目录保留；不存在“不再显示”。
- Windows 需要 packaged/runner 证据，重点验证 modal owner、焦点、任务栏、原子 Store、服务停止和应用退出。macOS 结果不能替代 Windows。
- 文档契约测试或生成检查应证明设置页权限清单、MCP Tool 所需 capability 和手册说明来自同一 Registry 事实。

## Delivery Tasks

跟踪 Epic：`Serpent-9rbn`（MCP 细粒度权限与关键危险操作确认框架）。

1. `Serpent-9rbn.1`：定义 Registry 权限目录、风险等级和 critical 初始清单，移除 ad-hoc `skipApproval` 语义。
2. `Serpent-9rbn.2`：实现按 credential 持久化的 Permission Policy Store，以及未来新增权限默认 `ask` 的迁移规则。
3. `Serpent-9rbn.3`：实现 Main-owned Permission Broker：单次决定、session grant、并发合并、取消、失效和脱敏审计。
4. `Serpent-9rbn.4`：实现普通权限 Prompt、关键危险 modal window、设置权限矩阵与“开启所有权限”红色确认。
5. `Serpent-9rbn.5`：将 MCP initialize、tools/list、Gateway 和 Execution Plan 接入新 Broker，删除整包读/写授权与双重 Prompt。
6. `Serpent-9rbn.6`：补全 SDK/HTTP、Gateway、Store、Electron E2E、packaged 和 Windows 验证。
7. `Serpent-9rbn.7`：同步 MCP 手册、自动化技能、领域模型、ADR、开发日志与验收清单，并加入文档/Registry 对齐检查。
8. `Serpent-9rbn.8`：单独改造“从磁盘删除资源库”为不可跳过的 critical 确认；当前不把整库删除暴露给 MCP。

依赖主链为 `.1 → .2 → .3 → .4/.5 → .6/.7`；`.8` 依赖 `.4` 的统一 critical 窗口，最终验证与文档任务同时等待 `.5` 和 `.8`。旧设备级跳过开关工单 `Serpent-d7s6` 已由本 Epic 取代。

## Out of Scope

- 局域网/公网 MCP、OAuth、远程身份和远程批准。
- 允许 Agent 通过请求参数写入或修改权限策略。
- 按绝对路径、任意 glob 或任意 SQL 建立权限白名单。
- 把 session grant 跨断线、跨应用重启恢复。
- 把 critical 操作纳入“开启所有权限”。
- 在本设计中把“从磁盘删除资源库”开放为 MCP 工具。
- 重做插件 unrestricted 信任模型；插件继续遵循自己的 Package/运行时边界。

## Further Notes

- “总是通过”必须在 UI 中写清作用域：Prompt 中是“本会话总是通过”，设置中是“此客户端总是允许”。不得只显示模糊的“总是”。
- 当前手册已切换到细粒度普通权限与关键确认模型；旧开发态 `skipApproval` 字段仅在读取旧设置文件时安全忽略，不再出现在运行时设置或用户界面。
- 旧工单 `Serpent-d7s6` 的设备级跳过开关将由本设计的 epic 取代，不能作为最终安全模型关闭验收。
