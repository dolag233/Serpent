# Serpent MCP API 参考

## 连接

Serpent MCP 是由运行中的 Serpent Desktop 提供的 loopback Streamable HTTP 服务：

```text
POST http://127.0.0.1:<port>/mcp
Authorization: Bearer <token>
```

在“设置 → MCP”开启服务后，点击客户端凭据行的“复制给 Agent”，把剪贴板中的连接信息发送给 Cursor、Claude、Codex 或其他 MCP Agent。连接信息包含 endpoint、`Authorization: Bearer ...`、对应客户端配置和最短使用步骤；客户端不需要安装 Node/npm，也不需要手工填写端口、命令或 token。

面向普通用户时，推荐直接复制剪贴板中的**全部文本**并粘贴到 Agent 对话或连接说明中，不要只复制 endpoint 或 token，也不要手动改写配置。Agent 会读取其中的连接信息和使用提示；连接后先调用 `serpent_library_list_open` 或 `serpent_library_list_recent` 获取 `libraryId`，再把它带入每个资源库相关请求。

服务只绑定 `127.0.0.1`，并校验 Host/Origin。它不是公网或局域网网关。

MCP transport 仍可能有协议层 `Mcp-Session-Id`，但它只用于请求关联、进度、日志、取消和连接生命周期；它不保存当前资源库、权限、默认目标或工具目录。

## 初始化与工具目录

客户端使用 MCP SDK 标准 `initialize`，并提供有限长度的 `clientInfo.name`。服务器提供 `tools` 和 `logging` 能力。

初始化响应会带上简短的服务器使用说明；Agent 不需要猜测调用顺序。推荐先读取这段说明和 `tools/list`，再调用 `serpent_library_list_open` 或 `serpent_library_list_recent` 获得目标 `libraryId`。

核心 Registry 工具目录对所有已认证客户端保持静态，不会因 Desktop 当前显示哪个资源库、重连或工具刷新而变化。插件工具可以随插件贡献变化发送 `tools/list_changed`。

每个库级工具的 `inputSchema` 都要求显式 libraryId。不能省略它，也不能用 `library.use` 设置后续调用的默认库。全局工具可以在没有资源库时执行。

## 资源库工具

| MCP 工具 | 作用 |
| --- | --- |
| `serpent_library_list_open` | 列出当前可访问的资源库；空列表是正常结果，不建立默认资源库。 |
| `serpent_library_list_recent` | 列出最近使用过的资源库（只返回 ID 和名称，不返回路径）。没有资源库时也可调用。 |
| `serpent_library_create` | 根据显式 `displayName` 和 `selectedParentPath` 创建资源库，返回新的 `libraryId`。不打开文件夹选择器。 |
| `serpent_library_open` | 根据显式 `libraryId` 打开已知资源库；没有目标时返回结构化错误，不打开选择器。 |
| `serpent_library_show_in_desktop` | 让 Desktop 显示显式 `libraryId`；只改变可见 UI，不改变任何后续 MCP 调用目标。 |
| `serpent_library_close` / `serpent_library_rename` | 关闭或重命名当前目标资源库。 |
| `serpent_library_export` | 按显式 `destinationPath` 导出 folder/zip；不会打开保存对话框。 |
| `serpent_library_import_folder` / `serpent_library_import_zip` | 从显式路径导入已导出的资源库；导入完成后可用返回的 ID 调用 `library.open`。 |
| `serpent_library_delete_from_disk` | 从磁盘永久删除资源库；仅危险操作确认后执行。链接源目录不删除。 |

创建或打开后，Agent 从结果中取得 `libraryId`，之后每个库级请求都把它放回参数中。多个客户端可以同时操作不同资源库；Desktop 焦点切换不会影响 MCP 请求。

库内结果应包含实际 `libraryId`；资源库变更通过 logging notification 报告 `changeSequence`，通知不是完整快照。

## 撤回与重做

撤回/重做由资源库 Worker 持有，Desktop、脚本、MCP 和插件共享同一条每库线性历史。MCP 不保存自己的 session 撤回栈，也不把文件 `operationId` 当作可执行的恢复凭据。

`serpent_history_undo` 和 `serpent_history_redo` 需要 `library.read` 与受控的 `history.write` capability；只读 credential 不能绕过这项能力检查，也不会把请求送入 Worker。读写/Auto 按普通受控写入策略执行，Full Access 只改变 MCP 档位授权，不绕过历史前置条件。

| MCP 工具 | 作用 |
| --- | --- |
| `serpent_history_status` | 返回当前库的 `undoTop`、`redoTop`、`staleTop` 和 `transitionInProgress`；不返回路径或内部 recipe。 |
| `serpent_history_undo` | 用 `libraryId` 和从 `history.status` 读到的 `expectedHistoryEntryId` 撤回当前栈顶。 |
| `serpent_history_redo` | 用 `libraryId` 和当前 `redoTop.historyEntryId` 重做当前栈顶。 |

调用必须显式带预期条目 ID；条目不是当前栈顶、已经 stale、被新的写入截断或存在并发转换时，服务器拒绝请求，不会跳过中间操作。新的正向写入会清除 redo 分支。永久删除等不可逆操作是 history barrier，不会因为开启 Full access 就变得可撤回。

推荐流程：先调用 `serpent_history_status`，确认目标条目的 label/state，再调用 undo/redo；成功后使用返回的新 status 刷新显示。`staleTop` 只说明被阻塞的历史摘要，不能让 Agent 绕过前置条件强行恢复。

## 路径与导入

Agent 工作流始终传显式路径，不调用原生文件选择器：

```json
{
  "libraryId": "<uuid>",
  "sourceKind": "files",
  "sourcePaths": ["/absolute/path/one.png", "/absolute/path/two.png"]
}
```

`serpent_library_create` 使用 `selectedParentPath`。Main/Worker 会进行路径规范化、存在性、类型、权限和 Serpent 边界校验；路径错误直接作为 MCP 错误返回。客户端不能提交 Worker 命令、SQL、计划证明或任意内部字段。

Windows 路径必须按 Windows 语义传递：盘符、反斜杠、UNC、长路径、大小写不敏感、保留名和 junction/reparse point 均由 Main/Worker 校验。

## 权限模式

权限绑定 MCP credential，跨 transport 重连、Serpent 重启和多个客户端连接保持一致。设置页里每个凭据有：复制 Agent 连接信息、权限档选择、删除按钮；主界面可以添加新客户端。两种权限档：

- **自动（Auto）**：普通读取、写标签、创建文件夹/合集、导入、可恢复整理等日常操作直接执行，不弹出人类权限窗口；危险操作仍需 Agent 二阶段确认。默认档。
- **完全（Full Access）**：受信任客户端可直接执行所有普通和可恢复操作；开启时设置页会弹出红色危险提示，用户确认后生效。危险操作仍需 Agent 二阶段确认，Serpent 始终保留路径、目标、版本和 Worker 安全校验。

权限档不能由 MCP 参数、环境变量或配置文件覆盖。撤销 credential 或停止服务会立即阻断后续调用。

危险工具包括 `serpent_asset_delete_permanent` 和 `serpent_library_delete_from_disk`：**Auto 和 Full Access 都采用 Agent 二阶段确认**。第一次调用绝不执行，只返回绑定本次精确调用的完整风险计划（challengeId、非空 planHash、影响对象、数量、可恢复性、资源库 revision、过期时间）。首次调用即提供非空 `idempotencyKey`；Agent 评估后以**同一工具**再次调用并原样回传 `challengeId`、非空 `planHash`、`acknowledged: true` 和同一个 `idempotencyKey`，只有命令、完整规范化参数、目标、library、revision 和幂等键完全匹配且未过期、未消费过的 challenge 才会执行，且只执行一次。单独提交 `acknowledged: true`、缺失字段、篡改参数、跨客户端复用、重放、状态变化都会拒绝并签发新风险报告。`tools/list` 会明确标注 `risk=critical`、`approval=agent-challenge` 和 `requiresCriticalConfirmation=true`。

## Desktop 信息投影

Desktop 是 Agent 工作的非阻塞投影。需要向用户解释阶段、目标或进度时，Agent 可以调用 `serpent_ui_notify`；它只显示非阻塞 info/progress/success/warning toast（不接受 `dialog` 模式），不承担批准，也不阻塞 Agent 调用。

资源库变化通过标准 logging notification：

```json
{
  "level": "info",
  "logger": "serpent.library",
  "data": {
    "type": "library.changed",
    "libraryId": "<stable-id>",
    "changeSequence": 42
  }
}
```

## 错误与重试

工具失败返回 `isError: true`，内容包含稳定 `code` 和可行动的 `message`，例如：

```json
{
  "ok": false,
  "code": "MCP_LIBRARY_TARGET_REQUIRED",
  "message": "This tool requires an explicit libraryId."
}
```

常见错误包括：

- `MCP_CLIENT_UNAUTHORIZED`、`MCP_CLIENT_REVOKED`、`MCP_SESSION_NOT_FOUND`；
- `MCP_LIBRARY_TARGET_REQUIRED`、`AUTOMATION_LIBRARY_NOT_OPEN`；
- `AUTOMATION_INVALID_REQUEST`、`AUTOMATION_CAPABILITY_DENIED`；
- `AUTOMATION_PLAN_STALE`、`AUTOMATION_OUTPUT_LIMIT_EXCEEDED`；
- `AUTOMATION_EXECUTION_CANCELLED`、`AUTOMATION_EXECUTION_TIMED_OUT`。

超时后不要盲目重复文件操作。对支持幂等的命令复用原 `idempotencyKey`，并先查询状态、资源库变更序号和目标状态。

文件导入遇到一次 `VERSION_CONFLICT` 时，Gateway 会自动重新生成一次新计划并重试；第二次仍失败会原样返回可诊断错误，不会无限重试或重复导入。

## 配置、停止与撤销

配置流程只有：开启服务 → 可选开启自动启动 → 复制 Agent 连接信息 → 在客户端粘贴一次。设置页可以停止/启动服务、修改端口、切换 Auto / Full Access 和撤销 credential。

当前没有 stdio MCP、`npm run mcp`、独立 headless Host、Desktop attached proxy、公网监听或通用 Shell/Node/SQL/文件系统执行器。
