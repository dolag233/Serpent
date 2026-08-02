# Serpent MCP API 参考

> 当前版本：Automation API `1`。
>
> 传输范围：本地 MCP stdio，包括默认 Desktop 附着和显式 headless。本文列出的 Registry 工具由 Automation Registry 生成；调用方不应自行构造 Gateway envelope。Desktop-only 工具仅在附着会话出现。

## 1. 协议入口

### 启动

默认附着当前 Desktop：

```bash
npm run mcp
```

没有 Desktop 时，开发态代理会启动可见 Desktop；附着使用当前活动资源库并要求本机确认。附着模式不通过 `--library` 切换当前 Desktop 资源库；需要按绝对路径绑定时使用 `--headless --library`。

```bash
npm run mcp -- --headless --library "/absolute/path/to/library"
```

无绑定启动：

```bash
npm run mcp -- --headless --unbound
```

写配置：

```bash
npm run mcp -- --headless --library "/absolute/path/to/library" --write-access
```

环境变量等价物：

| 变量 | 值 |
| --- | --- |
| `SERPENT_MCP=1` | 启用 headless MCP host。 |
| `SERPENT_MCP_LIBRARY_PATH` | 资源库绝对路径；与 `--library` 等价。 |
| `SERPENT_MCP_ALLOW_UNBOUND=1` | 允许无绑定启动；与 `--unbound` 等价。 |
| `SERPENT_MCP_WRITE_ACCESS=1` | 请求本地写工具暴露；与 `--write-access` 等价。 |
| `SERPENT_MCP_USER_DATA_PATH` | 隔离 userData；测试应设置临时目录。 |

`--user-data <dir>` 可覆盖 userData。`--library` 必须为绝对路径；不要通过 `libraryId` 或显示名替代启动绑定。

当前仓库没有独立的 `serpent-mcp` 可执行文件；使用上面的 npm 脚本，或使用随未来发行包提供的等价启动器（若发行包明确提供）。

需要多次调用并复用同一次附着确认时，可使用持久会话包装器：

```bash
npm run mcp:session -- --user-data /tmp/serpent-mcp-test start
npm run mcp:session -- --user-data /tmp/serpent-mcp-test list
npm run mcp:session -- --user-data /tmp/serpent-mcp-test call serpent_asset_search '{"query":null,"limit":20}'
npm run mcp:session -- --user-data /tmp/serpent-mcp-test status
npm run mcp:session -- --user-data /tmp/serpent-mcp-test stop
```

它使用 userData 下的本地 socket 复用附着的 MCP Client，不是远程服务，也不改变 MCP 工具和权限契约。

### Server capabilities

服务端名称默认为 `serpent-mcp`，版本为 `"1"`，能力为：

```json
{
  "tools": {},
  "logging": {}
}
```

### 标准 MCP 请求

```json
{
  "method": "tools/call",
  "params": {
    "name": "serpent_asset_search",
    "arguments": { "query": null, "limit": 20, "offset": 0 }
  }
}
```

响应对象结果示例：

```json
{
  "content": [{ "type": "text", "text": "{...}" }],
  "structuredContent": {
    "ok": true,
    "toolName": "serpent_asset_search",
    "commandId": "asset.search",
    "result": {
      "items": [],
      "total": 0,
      "offset": 0,
      "limit": 20,
      "hasMore": false
    },
    "truncated": false
  }
}
```

失败时仍返回 MCP tool result，但带 `isError: true`；错误数据形状为 `{ ok: false, code, message, gateway? }`。不要只依赖自然语言 `message` 做分支。

## 2. 工具暴露规则

`tools/list` 的结果按当前 Execution 动态生成：

- 没有写配置：只列公开只读/提示工具；
- 有写配置：公开工具加上允许 MCP 来源、能力和审批策略匹配的写工具；
- `plan` 工具可被发现，但每次仍必须经过 Main 本机计划批准；
- 插件工具以 `serpent_plugin_<pluginId>_<commandId>` 形式追加，仅限已启用、声明导出且本次连接请求本地写入配置的插件命令；插件命令目前按可能产生副作用处理；
- headless Registry 不包含 `serpent_desktop_*` 工具；附着会话会在 Registry 工具后追加 Desktop-only 工具。

`inputSchema` 是 JSON Schema，`additionalProperties` 通常为 false。未知字段、缺少必填字段、超出 ID/数组/字符串限制会在 Gateway 前被拒绝。

通用分页字段：`limit` 默认 50、最大 200；`offset` 默认 0。分页结果：`items`、`total`、`offset`、`limit`、`hasMore`。

## 3. 当前工具目录

下表列出当前 Registry MCP 名称与命令 ID。具体字段约束以同一会话的 `tools/list.inputSchema` 为准。

### 公开工具（无写配置即可发现）

| MCP 工具 | `commandId` | 用途 |
| --- | --- | --- |
| `serpent_library_inspect` | `library.inspect` | 读取当前绑定库摘要；只返回 ID 和显示名。 |
| `serpent_library_change_sequence` | `library.change-sequence` | 读取绑定库持久变更序号。 |
| `serpent_execution_status` | `execution.status` | 读取当前 Execution 的无路径状态投影。 |
| `serpent_ui_notify` | `ui.notify` | 向桌面显示 info/warning/error 提示；不要求绑定库。 |
| `serpent_folder_list` | `folder.list` | 分页列出托管文件夹。 |
| `serpent_linked_folder_list` | `linked-folder.list` | 分页列出链接文件夹摘要。 |
| `serpent_asset_list` | `asset.list` | 按文件夹分页列出资产。 |
| `serpent_asset_metadata_get` | `asset.metadata.get` | 读取人工元数据。 |
| `serpent_asset_ai_content_get` | `asset.ai-content.get` | 读取 AI 层结果，不修改人工元数据。 |
| `serpent_asset_extracted_metadata_get` | `asset.extracted-metadata.get` | 读取提取元数据。 |
| `serpent_asset_search` | `asset.search` | 搜索资产，支持字符串或结构化 SearchQuery。 |
| `serpent_tag_list` | `tag.list` | 分页列出标签。 |
| `serpent_collection_list` | `collection.list` | 分页列出合集。 |
| `serpent_collection_asset_memberships` | `collection.assets.memberships` | 查询资产的合集归属。 |
| `serpent_smart_collection_list` | `smart-collection.list` | 分页列出智能合集。 |
| `serpent_media_jobs_list` | `media.jobs.list` | 查询媒体 Job。 |
| `serpent_ai_jobs_status` | `ai.jobs.status` | 查询 AI Job 状态。 |

### 写入或外部副作用工具（需要写配置和 Execution 能力）

| MCP 工具 | `commandId` | 策略/边界 |
| --- | --- | --- |
| `serpent_library_create` | `library.create` | `plan`；可在 unbound headless 会话创建并绑定库；支持幂等 key。 |
| `serpent_file_import` | `file.import` | `plan`；导入文件/目录；支持幂等 key、取消和恢复语义。 |
| `serpent_asset_rating_set` | `asset.rating.set` | `execution`；批量设置 0–5 评分。 |
| `serpent_asset_paths_copy` | `asset.paths.copy` | `execution`；写系统剪贴板，结果只返回复制数量。 |
| `serpent_asset_trash` | `asset.trash` | `plan`；移入 Serpent 回收站，不是永久删除；可能返回 `undoGroupId`。 |
| `serpent_asset_content_replace` | `asset.content.replace` | `plan`；替换受管内容。 |
| `serpent_asset_content_replace_batch` | `asset.content.replace-batch` | `plan`；批量内容替换。 |
| `serpent_asset_move` | `asset.move` | `plan`；移动到文件夹；返回部分成功/恢复信息。 |
| `serpent_asset_rename_file` | `asset.rename-file` | `plan`；重命名单个文件。 |
| `serpent_asset_rename_files` | `asset.rename-files` | `plan`；批量重命名。 |
| `serpent_asset_restore_if_original_vacant` | `asset.restore-if-original-vacant` | `plan`；只在原位置安全可恢复时还原。 |
| `serpent_folder_create` | `folder.create` | `execution`；创建空文件夹，不等于移动已有资产。 |
| `serpent_asset_metadata_set` | `asset.metadata.set` | `execution`；支持 `expectedVersion` 乐观并发校验。 |
| `serpent_tag_create` | `tag.create` | `execution`；创建标签。 |
| `serpent_tag_assign` | `tag.assign` | `execution`；批量分配标签。 |
| `serpent_tag_remove` | `tag.remove` | `execution`；批量移除标签。 |
| `serpent_collection_create` | `collection.create` | `execution`；创建合集。 |
| `serpent_collection_assets_add` | `collection.assets.add` | `execution`；添加资产到合集。 |
| `serpent_collection_assets_remove` | `collection.assets.remove` | `execution`；从合集移除资产。 |
| `serpent_ai_enqueue` | `ai.enqueue` | `execution`；入队 AI 分析，遵守全局 AI Job 并发限制。 |

`asset.content.stage`、`asset.content.read`、`asset.list-trash`、`asset.palette.aggregate-recent` 在 Registry 中存在，但当前 `mcp.public=false`，不会因 `--write-access` 自动出现在 MCP `tools/list`；它们不是当前 MCP 公共工具契约。工具目录随 Serpent 版本发布，不允许客户端依赖未列出的内部 command ID。

## 4. 输入结构重点

### 搜索

字符串搜索与 UI 工具栏语法兼容：

```json
{
  "query": "tag:抽象 | filename:rain",
  "limit": 50,
  "offset": 0
}
```

也可使用结构化查询（字段使用 `filename`，不是 UI 别名 `name`）：

```json
{
  "query": {
    "clauses": [
      { "field": "filename", "values": ["sunny"], "exclude": false }
    ]
  },
  "limit": 50,
  "offset": 0
}
```

### 资产和元数据

批量工具通常接收稳定 `assetIds` 数组；不要用显示名代替 ID。`asset.metadata.set` 需要先读取 `entityVersion`，再带回 `expectedVersion`：

```json
{
  "assetId": "asset-id",
  "expectedVersion": 7,
  "rating": 5,
  "favorite": true
}
```

内容版本 `currentRevisionId` 与元数据 `entityVersion` 不同；移动、重命名、评分、喜欢和标签不会改变内容 revision。

### 导入和建库

```json
{
  "displayName": "素材库",
  "selectedParentPath": "/absolute/path/to/parent",
  "idempotencyKey": "library-create-001"
}
```

```json
{
  "sourceKind": "files",
  "sourcePaths": ["/absolute/path/to/a.png"],
  "targetFolderId": "folder-id",
  "imageSequenceFps": 24,
  "expandImageSequences": false,
  "idempotencyKey": "import-001"
}
```

`sourcePaths` 是本地开发态输入，必须满足领域层路径和符号链接检查；MCP 不因此获得任意文件系统读写 API。导入可能先返回冲突计划，再在本机批准后完成。

### 插件 MCP 工具

插件工具输入是严格受限的上下文：至少提供一个非空的 `assetIds`、`folderIds` 或 `collectionIds`，每个数组最多 256 个字符串，不允许任意字段：

```json
{
  "assetIds": ["asset-1", "asset-2"]
}
```

插件工具由插件清单的 `mcpExported` 和设备启用状态共同决定；它们仍使用 Main-owned `executionId`，不是插件自建 transport。

## 5. 结果、错误和日志

### 成功

成功外壳：

```json
{
  "ok": true,
  "toolName": "serpent_asset_trash",
  "commandId": "asset.trash",
  "result": {
    "trashedCount": 2,
    "operationId": "operation-id"
  },
  "undoGroupId": "undo-group-id",
  "truncated": false
}
```

`result` 必须按工具 Schema 解析；`truncated` 是适配器输出标记，不能据此推断写入是否完成。

### MCP 适配器错误

| code | 含义 |
| --- | --- |
| `MCP_TOOL_NOT_FOUND` | 工具名未知。 |
| `MCP_TOOL_NOT_EXPOSED` | 工具存在但当前会话未获本地暴露/写配置。 |
| `MCP_EXECUTION_REQUIRED` | 没有 Main-bound MCP Execution。 |
| `MCP_GATEWAY_FAILURE` | Gateway 返回拒绝或领域错误；继续看 `gateway`。 |

### Gateway/领域错误

常见稳定码包括：

| code | 处理建议 |
| --- | --- |
| `AUTOMATION_INVALID_REQUEST` | 修正 API 版本、命令输入或幂等 key；不要原样重试。 |
| `AUTOMATION_API_VERSION_UNSUPPORTED` | 使用当前随 Serpent 发布的 API 版本。 |
| `AUTOMATION_COMMAND_NOT_FOUND` | 重新执行 `tools/list`，不要调用内部 command ID。 |
| `AUTOMATION_EXECUTION_NOT_FOUND` | 会话已结束或 ID 无效，建立新会话。 |
| `AUTOMATION_SOURCE_NOT_ALLOWED` | 该来源不能调用命令。 |
| `AUTOMATION_CAPABILITY_DENIED` | 本次 Execution 没有需要的能力。 |
| `AUTOMATION_LIBRARY_NOT_BOUND` | 先绑定库或重启时指定 `--library`。 |
| `AUTOMATION_LIBRARY_OPEN_FAILED` | 检查库路径、版本、权限和完整性。 |
| `AUTOMATION_CONCURRENCY_LIMIT_REACHED` | 降低同一 Execution 并发，稍后重试。 |
| `AUTOMATION_EXECUTION_CANCELLED` / `AUTOMATION_CANCELLED` | 请求或会话取消；检查状态和已完成摘要。 |
| `AUTOMATION_EXECUTION_TIMED_OUT` / `AUTOMATION_TIMED_OUT` | 查询状态；支持幂等时用同一 key 恢复。 |
| `AUTOMATION_INTERRUPTED_BY_RESTART` | 应用重启中断；不要假设未开始命令已执行。 |
| `AUTOMATION_RESULT_INVALID` | 记录 `logId` 并报告版本/适配器问题。 |
| `VERSION_CONFLICT` / `AUTOMATION_UNDO_STALE` | 重新读取实体或 Undo 前提后再决定操作。 |
| `LIBRARY_BUSY` / `ASSET_FILE_NAME_CONFLICT` | 等待占用释放或让用户处理冲突。 |

业务错误可能出现在 `gateway` 的 public error 中，并带 `code`、可选原因/上下文；客户端应保留稳定 code，向用户显示脱敏 message。

### 日志与路径

每个 Execution 有 `logId`。日志和结果不应暴露 API key、Authorization、秘密配置或未经脱敏的绝对外部路径。`library.inspect` 不返回路径；路径复制工具只返回数量。诊断去 stderr/应用日志，stdout 只保留 MCP 帧。

## 6. 计划、取消和重试参考

推荐的高风险调用流程：

```text
tools/list → 读取 inputSchema/审批元数据
          → 读取资源和 changeSequence
          → tools/call（使用稳定 idempotencyKey，如该命令支持）
          → 等待本机计划批准
          → 读取 result 或 serpent_execution_status
          → 处理部分成功/undoGroupId
```

发生客户端超时：

1. 不立即发起一个新 key 的写请求；
2. 调用 `serpent_execution_status`；
3. 若仍运行，等待、取消或让用户处理本机批准；
4. 若命令支持幂等键且确需重试，使用相同 key 和完全相同参数；
5. 若资源库变更序号或实体版本变化，重新读取并重新计划。

客户端不能假定 MCP `tools/call` 的传输取消一定能撤销已经进入 Worker 的文件阶段；取消保证停止继续发起命令，当前命令按其恢复语义结束。

## 7. 版本兼容

Automation API 与 Renderer IPC 独立版本化，当前 `AUTOMATION_API_VERSION = 1`。MCP server、Script 类型和 Desktop 随同 Serpent 版本分发；不允许单独升级一个协议包后期待隐式兼容。新增/弃用工具时，应同步 Registry、JSON Schema、类型声明、fixture、测试和本参考文档。

## 8. Desktop 附着工具

当前附着会话提供以下 Desktop-only 工具：

```text
serpent_desktop_focus
serpent_desktop_select_assets
serpent_desktop_get_state
serpent_desktop_open_folder
serpent_desktop_set_discovery
serpent_desktop_reveal_asset
serpent_desktop_open_viewer
serpent_desktop_close_viewer
serpent_desktop_navigate_viewer
```

它们用于操作已附着 Desktop 的语义状态（窗口、选区、浏览过滤、Viewer），不接受 DOM/像素/鼠标键盘/路径旁路。调用前必须使用默认 `npm run mcp` 附着，并接受本机确认；headless `tools/list` 不会返回它们。当前仓库的控制面、跨平台 packaged 和 Windows 旅程仍需按 QA 记录验证，客户端不应把它们当作远程或跨机器服务。

## 9. 最小集成验收

- 使用临时 userData 启动 `--headless --library`，完成 `initialize`、`tools/list`、`serpent_library_inspect`。
- 不带 `--write-access` 时确认写工具未暴露，直接调用返回 `MCP_TOOL_NOT_EXPOSED`。
- 用分页搜索并解析 `structuredContent`，不依赖格式化 text。
- 用 `serpent_execution_status` 验证当前 Execution ID 和终态。
- 对支持幂等的导入/建库请求模拟客户端超时，确认同 key 重试不会重复副作用；参数改变会失败。
- 验证 stdout 无非 MCP 文本，诊断在 stderr/日志。
- 以真实资源库之外的临时 fixture 验证错误、计划拒绝、过期计划和部分成功。
- 不把远程服务、系统 daemon 或通用 CLI 作为通过条件；需要窗口/选区时使用附着 Desktop 测试路径。
