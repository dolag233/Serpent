# Serpent MCP API 参考

## 连接

Serpent MCP 是由运行中的 Serpent Desktop 提供的 loopback Streamable HTTP 服务：

```text
POST http://127.0.0.1:<port>/mcp
Authorization: Bearer <token>
```

在“设置 → MCP”开启服务后，点击“复制 MCP 配置”，把完整配置粘贴到 Cursor、Claude、Codex 或其他 MCP 客户端。客户端不需要安装 Node/npm，也不需要手工填写端口、命令或 token。

服务只绑定 `127.0.0.1`，并校验 Host/Origin。它不是公网或局域网网关。

MCP transport 仍可能有协议层 `Mcp-Session-Id`，但它只用于请求关联、进度、日志、取消和连接生命周期；它不保存当前资源库、权限、默认目标或工具目录。

## 初始化与工具目录

客户端使用 MCP SDK 标准 `initialize`，并提供有限长度的 `clientInfo.name`。服务器提供 `tools` 和 `logging` 能力。

核心 Registry 工具目录对所有已认证客户端保持静态，不会因 Desktop 当前显示哪个资源库、重连或工具刷新而变化。插件工具可以随插件贡献变化发送 `tools/list_changed`。

每个库级工具的 `inputSchema` 都要求显式 libraryId。不能省略它，也不能用 `library.use` 设置后续调用的默认库。全局工具可以在没有资源库时执行。

## 资源库工具

| MCP 工具 | 作用 |
| --- | --- |
| `serpent_library_list_open` | 列出当前可访问的资源库；空列表是正常结果，不建立默认资源库。 |
| `serpent_library_create` | 根据显式 `displayName` 和 `selectedParentPath` 创建资源库，返回新的 `libraryId`。不打开文件夹选择器。 |
| `serpent_library_open` | 根据显式 `libraryId` 打开已知资源库；没有目标时返回结构化错误，不打开选择器。 |
| `serpent_library_show_in_desktop` | 让 Desktop 显示显式 `libraryId`；只改变可见 UI，不改变任何后续 MCP 调用目标。 |

创建或打开后，Agent 从结果中取得 `libraryId`，之后每个库级请求都把它放回参数中。多个客户端可以同时操作不同资源库；Desktop 焦点切换不会影响 MCP 请求。

库内结果应包含实际 `libraryId`；资源库变更通过 logging notification 报告 `changeSequence`，通知不是完整快照。

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

权限绑定 MCP credential，跨 transport 重连、Serpent 重启和多个客户端连接保持一致。设置页里每个凭据有：复制配置、权限档选择、删除按钮；主界面可以添加新客户端。三种权限档：

- **只读（Read-only）**：只能读取和搜索；任何写入操作都会在桌面弹出确认框，由用户当场决定允许或拒绝。适合不信任的或专用的浏览型客户端。
- **读写（Read-write）**：普通读取、写标签、创建文件夹/合集、导入、可恢复整理等日常操作直接执行；危险操作（如永久删除）仍需 Agent 二阶段确认。默认档。
- **完全（Full access）**：所有 MCP 操作直接执行，包括永久删除。开启时设置页会弹出红色危险提示，用户确认后生效；之后责任由用户承担，Serpent 仍保留路径、目标、版本和 Worker 安全校验。

权限档不能由 MCP 参数、环境变量或配置文件覆盖。撤销 credential 或停止服务会立即阻断后续调用。

危险工具（当前为 `serpent_asset_delete_permanent`）：**只读**档下与普通写入同等对待——桌面弹出确认框，由用户当场决定允许或拒绝，Agent 无法自行确认；**读写**档下采用 Agent 二阶段确认：第一次调用绝不执行，只返回绑定本次精确调用的风险报告（challengeId、影响对象、数量、可恢复性、过期时间）；Agent 评估后以**同一工具**再次调用并回传 `challengeId`、`planHash` 和 `acknowledged: true`，只有完全匹配且未过期、未消费过的 challenge 才会执行，且只执行一次。篡改参数、跨客户端复用、重放、状态变化都会拒绝并签发新风险报告。**完全**档直接执行（用户在启用时已确认责任），但仍不能跳过领域边界和 Worker 校验。

## Desktop 信息投影

Desktop 是 Agent 工作的非阻塞投影。需要向用户解释阶段、目标或进度时，Agent 可以调用 `serpent_ui_notify`；它只显示 info/progress/success/warning，不承担批准。

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

## 配置、停止与撤销

配置流程只有：开启服务 → 可选开启自动启动 → 复制完整配置 → 在客户端粘贴一次。设置页可以停止/启动服务、修改端口、切换 Auto / Full Access 和撤销 credential。

当前没有 stdio MCP、`npm run mcp`、独立 headless Host、Desktop attached proxy、公网监听或通用 Shell/Node/SQL/文件系统执行器。
