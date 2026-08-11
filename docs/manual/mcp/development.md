# Serpent MCP 开发指南

Serpent MCP 由 Desktop Main 进程内嵌提供，仅监听 `127.0.0.1` 的 Streamable HTTP。它服务于不应安装 Node/npm 的美术和设计师；客户端只需粘贴设置页复制的配置。

## 用户侧启用

1. 在“设置 → MCP”打开“启用 MCP 服务”。
2. 可选打开“自动启动”。
3. 点击“启动 MCP 服务”。
4. 点击“复制 MCP 配置”，粘贴到目标客户端。
5. 新 credential 默认读写（read-write）；可切到只读（read-only，写入需桌面确认）或完全（full-access，一切直接执行，启用时有红色警告）。

不需要编辑 JSON、启动 npm、选择工作目录或重复批准普通操作。

## 进程边界

- Main 持有 HTTP listener、credential、访问模式和 MCP transport。
- Renderer 只通过类型化 IPC 操作设置页，不接收 token、socket、数据库连接或任意文件系统能力。
- Library Worker 是 SQLite 和资源文件的唯一所有者。
- 所有 MCP 请求经 Automation Registry、Gateway、Schema、目标库校验、版本/变更序列和 Worker 安全边界。

transport 可以为 MCP SDK 保存 session，但禁止把 active library、library authorization、capability grant、默认目标或动态核心工具目录放入 session。每个库级调用必须带显式 `libraryId`；`library.show-in-desktop` 只投影 UI。

## 自动化与人类操作等价（产品原则）

**MCP/脚本的操作与人类的操作没有不同**：`file.import` 导入 = 人类导入，`asset.trash` 删除 = 人类删除。含义：

- 领域校验与安全边界不变（Schema、计划、版本、Worker），source 只影响审计标签；
- 副作用必须与人类操作一致：自动 AI 分析入队（`onImportCompleted` → `enqueueAutoAnalyzeAfterImport`，与桌面导入 IPC 同一函数）、undo group、插件 will-hooks、桌面提示（同一套 toast，见 Serpent-fmbr）；
- 不得为自动化单独造一套提示/入队/撤销机制；触发点放在统一完成点（Gateway 钩子 / 事件），而非 MCP transport 层。

若发现某个人类操作的副作用在自动化路径缺失，视为 bug（Serpent-ihpx 即此类）。

## Registry 与请求处理

`src/automation/command-registry.ts` 是 MCP 工具和输入/输出 Schema 的单一来源。`src/mcp/tool-catalog.ts` 为核心工具生成静态目录，`src/mcp/call-tool.ts` 对库级调用提取并校验显式 `libraryId`，再通过 Gateway 的 `contextOverrides` 做单次目标绑定。

过渡约束：插件 MCP 工具当前只在 `full-access` 档暴露（`tool-catalog.ts` 的 exposure 判断）；read-write/read-only 客户端拿不到插件工具列表。与 ADR-0025“插件与脚本/MCP 同一 Action 面”的完全对齐留待插件权限投影设计。

全局命令（列出最近资源库、列出已打开资源库、建库、导入已导出的库）不要求 `libraryId`。库级命令（资产、文件夹、标签、合集、导入资产、AI 和任务）要求 `libraryId`。不要从 Desktop 当前库或 HTTP session 填充缺省目标。库级调用的目标由 Gateway 单次绑定，不会写回 MCP session。

路径输入必须在 MCP Schema 中声明并直接传给 Main：

- 创建资源库：`selectedParentPath`；
- 导入：`sourcePaths`；
- 其他文件操作：由 Registry 声明具体业务参数。

MCP 路径请求绝不调用 Electron 原生文件选择器。Windows 需要独立验证盘符、UNC、长路径、保留名、大小写不敏感、反斜杠和 reparse point/junction。

## 权限档：只读 / 读写 / 完全

`McpPermissionPolicyStore` 只保存 credential 级 `mode`：

- `auto` 是默认值。普通和可恢复操作由 Gateway 直接执行，不能调用人类权限 prompt。
- `full-access` 由设置页的独立红色确认窗口开启；开启后普通及暴露的危险 MCP 调用均不等待 Agent 二次确认。

Permission Broker 只读取 credential 权限档，不保存 transport session grant。只读档的写入请求由桌面确认框决定（调用方等待用户决定）；读写档的普通操作不弹窗；完全档一切直接执行。普通计划型文件操作仍执行 Worker 的只读计划、状态 token、change sequence 和幂等校验。

危险命令（如永久删除）在只读档下与普通写入同等对待——必须由桌面用户当场确认或拒绝，Agent 无法自行确认（sonnet 审查回归：read-only 不得存在任何绕过桌面确认的危险执行路径）。读写档下使用一次性 challenge，绑定 credential、命令、规范化参数、libraryId、目标 ID 和前置版本；第一次调用只能返回风险报告，第二次精确确认才能执行。完全档直接执行（启用时用户已确认责任），但不能跳过领域校验。

## Desktop 通知

`serpent_ui_notify` 是非阻塞信息投影，不是权限通道，仅接受 `toast` 模式（dialog 模式已按 stateless 设计移除）。Host 或 Agent 可以用它说明“正在导入显式路径”“正在查询任务”等阶段，但不得打开选择器或用 notification 等待人类批准。

库级调用的成功响应回显 `libraryId` 与 `libraryChangeSequence`（最近已知变更序号，ADR-0031 §2）；写命令自身可能滞后一个事件，后续调用与 `library.change-sequence` 提供新值。失败响应携带稳定 `code`/`message`，并按错误契约附加 `retryable`（瞬时错误）、`currentVersion`（实体版本冲突）与 `libraryId`。

资源库变化只发送 `notifications/message` logging notification，并携带 `libraryId` 与 `changeSequence`。MCP 发起的关闭、重命名、删除和资源库导入会通过同一 Main 生命周期投影同步 Desktop，并显示非阻塞 info toast；上下文变化不得触发核心 `tools/list_changed`，只有实际工具贡献变化才刷新工具列表。

当前完整的整理面包含：托管文件夹重命名、移动和受保护的空文件夹批量删除；链接文件夹创建、重连、解除、规则更新和刷新；普通/智能合集的创建、修改、排序、删除、成员列表与规则执行；标签重命名、删除、批量删除、合并和共现查询；资产批量复制、缩略图/预览状态读取和整库刷新。空文件夹删除只接受无资产、无子文件夹且磁盘目录确实为空的目标，任何不满足条件的批次会整体拒绝。

危险的“从磁盘删除资源库”也走与回收站永久删除一致的二阶段 challenge；它不是普通 capability，也不能由 session、配置字段或 Full Access 之外的普通授权绕过。

## 测试与验收

定向自动化测试至少覆盖：

- 只读 / 读写 / 完全 权限档持久化和凭据隔离；
- 多连接、断开重连后工具目录和显式 `libraryId` 行为不变；
- 缺少库目标时的稳定错误；
- 空资源库列表、显式建库和显式路径导入；
- Host/Origin、token 撤销、端口生命周期和输出预算；
- Worker 计划、版本、幂等、取消和崩溃恢复。

Electron E2E 必须后台运行并隔离 `SERPENT_E2E_USER_DATA_PATH`。完成大型 MCP 改动后，主 agent 还要使用真实 Serpent Desktop 做独立 UI/设置验收；自动化通过不能代替人眼验收。

Windows 当前没有 runner，macOS 通过不能写成 Windows 通过。审查至少覆盖 Node `path`、`fs` 原子替换、loopback 绑定、端口错误、Electron 生命周期、Windows 用户目录和 packaged 资源路径。
