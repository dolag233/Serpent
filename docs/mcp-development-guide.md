# Serpent 本地 MCP 开发指南

> 面向：实现本地 MCP Host 集成、Agent 工具调用器和 Serpent 自动化适配器的开发者。
>
> 文档边界：本文描述当前仓库中可用的本地 **stdio MCP**，包括默认的 Desktop 附着模式、显式 headless 模式和持久附着会话。它不描述远程 MCP 服务或通用 CLI。

## 1. 先理解运行边界

Serpent MCP 是本机 Agent Host 与 Serpent Automation Command Gateway 之间的结构化适配器。当前支持的是：

- Agent Host 启动一个 MCP stdio 子进程；默认代理附着当前 Serpent Desktop，也可以显式启动独立的 headless Host；
- 附着模式使用 Desktop 已有的 Main/Library Worker；headless 模式在自己的连接生命周期内启动 process-local Electron/Library Worker；
- Main 持有 Automation Execution、授权、资源库绑定、日志和 Gateway；
- Library Worker 是 SQLite 与受管文件的唯一所有者。

它不是远程 MCP、系统 daemon、开机服务或公网服务，也不是通用 CLI。不要把 `npm run mcp`、`scripts/run-mcp.mjs` 或 `scripts/mcp-session.mjs` 当作可供用户编排任意 Shell/Node/SQL 的 CLI；它们只是开发态或本地 Host 的 MCP 启动/会话辅助器。

当前 MCP 不提供任意 JavaScript `eval`、Shell、SQL、任意文件系统、原始网络、秘密配置、GUI 鼠标键盘控制、当前选区推断、永久删除或整库删除。插件导出的 MCP 工具是受限的插件命令桥接，不会改变上述边界。

## 2. 当前可用路径

### 默认附着 Desktop

```bash
npm run mcp
```

默认启动 `scripts/desktop-attached-mcp-proxy.mjs`。它会连接当前 userData 下的 Desktop 控制面；如果 Desktop 尚未运行，开发态代理会启动一个可见 Desktop。附着时使用 Desktop 当前聚焦的资源库，并要求本机用户确认目标库和是否请求写入权限。没有活动资源库时附着会失败。要按绝对路径指定资源库，请使用 `--headless --library`；不要把附着模式的 `--library` 当作切换当前 Desktop 资源库的参数。

附着会话额外提供以下 Desktop 语义工具：

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

这些工具操作窗口、选区、浏览过滤和 Viewer 的语义状态，不提供 DOM、像素、任意鼠标键盘或路径旁路。它们只存在于附着会话，不会出现在 headless 的 `tools/list` 中。

### Headless 资源库会话

最小开发态启动：

先在仓库根目录安装 Node `>=24 <25` 的依赖，然后让 MCP Host 启动：

```bash
npm run mcp -- --headless --library "/absolute/path/to/My.library"
```

`--library` 必须是绝对路径。该命令由 `scripts/run-mcp.mjs` 转换为：

```text
SERPENT_MCP=1
SERPENT_MCP_LIBRARY_PATH=/absolute/path/to/My.library
SERPENT_MCP_WRITE_ACCESS=0
npx electron-forge start
```

无当前资源库的 headless 会话必须显式使用 `--unbound`：

```bash
npm run mcp -- --headless --unbound
```

它只适合先调用 `serpent_library_create`，创建并打开资源库后再继续调用依赖资源库的工具。未提供 `--library` 或 `--unbound` 时，MCP host 会拒绝启动。

### 写入配置

开发态可用以下方式请求写工具：

```bash
npm run mcp -- --headless \
  --library "/absolute/path/to/My.library" \
  --write-access
```

`--write-access` 只是本地 Host 配置的写入意图，不是 Agent 自行提权。Main 仍以本次 Automation Execution 的能力、命令元数据和高风险计划边界做最终判断。没有写配置的连接在 `tools/list` 中只看到公开工具；写工具不会因为 Agent 在请求中提交 `source`、能力、库 ID 或批准凭据而出现。

对于 MCP Host 配置，开发态推荐使用等价的 stdio 命令，而不是把 Electron、数据库路径或内部 Worker 暴露给 Agent：

```json
{
  "mcpServers": {
    "serpent": {
      "command": "npm",
      "args": [
        "run",
        "mcp",
        "--",
        "--headless",
        "--library",
        "/absolute/path/to/My.library"
      ],
      "cwd": "/absolute/path/to/Serpent"
    }
  }
}
```

当前仓库的真实入口是 `npm run mcp`、`npm run mcp -- --headless ...` 和 `npm run mcp:session ...`。不要把 `serpent-mcp` 当作当前仓库已经提供的独立可执行文件；如果未来发行包提供等价启动器，必须以该发行包的说明为准。打包/Windows Host 旅程仍需按对应 QA 记录单独验证。

### stdio 的纯净性

stdout 只允许 MCP JSON-RPC 帧。诊断写 stderr 或应用日志；不要在 MCP 适配器中使用 `console.log` 输出协议外文本。`redirectConsoleToStderrForMcp()` 是已有的开发态保护，但 Host 仍应把 stdout 当作严格协议通道处理。

## 3. 生命周期与会话模型

一次 MCP 连接对应一个 Main-owned Automation Execution：

1. host 创建 `source: "mcp"` 的 Execution 和随机 `sessionId`；
2. Main 解析初始资源库（或保持 unbound）并授予默认读能力；
3. 连接完成 `initialize` 后，Host 可执行 `tools/list` / `tools/call`；
4. 每次调用只提交 API 版本、命令映射出的工具输入和 Main 签发的 `executionId`；
5. MCP 连接关闭时，Execution 会话结束，未完成执行被取消；
6. 应用重启会把未结束 Execution 标为 `AUTOMATION_INTERRUPTED_BY_RESTART`。

适合集成测试或多步开发流程的持久附着会话辅助器：

```bash
npm run mcp:session -- --user-data /tmp/serpent-mcp-test start
npm run mcp:session -- --user-data /tmp/serpent-mcp-test list
npm run mcp:session -- --user-data /tmp/serpent-mcp-test call serpent_asset_search '{"query":null,"limit":20}'
npm run mcp:session -- --user-data /tmp/serpent-mcp-test status
npm run mcp:session -- --user-data /tmp/serpent-mcp-test stop
```

`mcp:session` 当前连接的是附着 Desktop 的 MCP 代理；它的本地 socket 只用于复用已建立的 MCP 连接，不是对外 API。默认文件是 userData 下的 `agent-mcp-session.sock`、`.pid` 和 `.log`。测试必须使用临时 userData，避免污染真实配置。

## 4. 资源库绑定与权限

资源库不是“当前窗口焦点”的隐式状态。headless 会话只有两种初始状态：

- `--library <绝对路径>`：启动时打开并绑定一个资源库；
- `--unbound`：不绑定资源库，只允许无需库的操作（最典型是创建库）。

MCP 输入不能提交可作为授权依据的 `libraryId`、`source`、能力集合或批准凭据。Gateway 依据 `executionId` 从 Main/Execution journal 解析这些字段。需要跨库时拆成独立 Execution，或在明确的领域流程中显式创建/绑定；不保证跨库事务。

无写配置时只读工具可发现。`--write-access` 后，低风险执行级写工具和高风险计划工具才可能出现在 `tools/list`；具体仍由 Registry 的 `allowedSources`、能力和审批策略决定。Agent Host 的“允许”提示不能替代 Serpent 的能力授权或本机批准。

能力分为库、文件夹、资产、内容、元数据、标签、合集、AI、剪贴板和回收站等命名空间。能力拥有不是领域校验的替代品：资产版本、路径安全、冲突、资源库变更序号和写租约仍会再次校验。

## 5. 工具发现与调用约定

### `initialize`

使用 MCP SDK 的标准 `initialize`；不要自行拼接 stdio 帧。服务名默认为 `serpent-mcp`，版本字符串为 Automation API 版本（当前为 `"1"`），能力声明包含 `tools` 和 `logging`。

### `tools/list`

`tools/list` 是会话级动态结果：

- 默认只列出 `mcp.public: true` 工具；
- 有本地写配置时，再列出符合写入暴露条件的工具；
- 工具名、描述、JSON Schema、影响级别和审批元数据来自 Automation Registry；
- 插件工具只有在插件已启用且声明 `mcpExported` 时才列出。

不要缓存一个会话以外的工具清单，也不要通过猜测工具名绕过暴露过滤。工具名中明确禁止 `eval`、`shell`、`sql`、`fetch`、`net`、`fs`、`process`、`exec` 等旁路语义。

### `tools/call`

调用使用标准 MCP `tools/call`：

```json
{
  "name": "serpent_asset_search",
  "arguments": {
    "query": null,
    "limit": 50,
    "offset": 0
  }
}
```

适配器会把工具名映射到 Registry `commandId`，再构造内部 envelope：

```json
{
  "apiVersion": 1,
  "commandId": "asset.search",
  "executionId": "main-owned-execution-id",
  "input": { "query": null, "limit": 50, "offset": 0 }
}
```

`executionId` 不由 MCP 客户端伪造或替换。工具结果同时提供 MCP text content；对象结果还提供 `structuredContent`。成功结果通常包含 `ok: true`、`toolName`、`commandId`、`result` 和可选 `undoGroupId`。失败结果使用 `isError: true`，text JSON 中包含稳定 `code` 和可读 `message`。

### 分页与通知

分页输入通常为 `limit`（默认 50，最大 200）和 `offset`（默认 0）；分页结果包含 `items`、`total`、`offset`、`limit`、`hasMore`。Agent 应持续翻页直到 `hasMore=false`，不要一次请求超过 200。

绑定资源库发生变化时，已绑定该库的 Execution 可收到 MCP logging message：

```json
{
  "type": "library.changed",
  "libraryId": "library-id",
  "changeSequence": 42
}
```

未绑定或绑定其他库的会话不会收到该通知；通知不包含路径。

## 6. 写入、计划批准与撤销

影响级别和策略由 Registry 声明：

| 策略 | 含义 |
| --- | --- |
| `none` | 无额外批准；只读或 Main 内部提示类操作。 |
| `execution` | 会话/Execution 获得能力后可执行；常见于评分、标签、合集、元数据、空文件夹、AI 入队。 |
| `plan` | 先预检并生成不可变计划，再由本机人类批准；常见于导入、建库、移动、重命名、回收站。 |
| `forbidden` | 不允许由该自动化来源执行。 |

计划摘要至少描述目标数量、源/目标范围、冲突/不可执行项、可撤销性、Undo 预期和后台任务。计划绑定输入内容、实体版本和（已绑定库时）变更序号；批准后前提变化会使计划失效，客户端应重新预检，不能重放旧批准。

计划批准是 Serpent 本机边界，Agent Host 的二次确认不能替代它。拒绝、超时或过期都不应被客户端当作成功。文件操作可能部分成功；结果必须按 `succeeded`、`skipped`、`failed` 等字段处理。

可撤销结果可能返回 `undoGroupId`。它是 Serpent 内部恢复引用，不是让 Agent 直接改文件的权限；重复消费已使用或已失效的组会被拒绝。永久删除和整库删除不在首版 MCP 面。

## 7. 取消、超时、状态和幂等重试

Execution 会记录 `running`、`awaiting-approval`、`succeeded`、`partially-succeeded`、`failed`、`cancelled`、`timed-out` 等状态。使用：

```json
{
  "name": "serpent_execution_status",
  "arguments": {}
}
```

状态结果是无路径投影，包含 `executionId`、`status`、命令计数、最后命令、失败码、deadline 和完成时间。工具调用超时不等于服务器没有执行：客户端应先查询状态，再决定是否重试。

当前已实现的幂等键仅适用于 Registry 标记 `supportsIdempotencyKey` 的命令（当前重点是 `library.create` 和 `file.import`）：

```json
{
  "displayName": "采集库",
  "selectedParentPath": "/absolute/path/to/parent",
  "idempotencyKey": "import-job-20260802-001"
}
```

同一 Execution、同一命令、同一 key 必须配完全相同的业务参数；参数改变会返回 `AUTOMATION_INVALID_REQUEST`。客户端超时后不要生成新 key，也不要盲目发起第二个写入。无幂等支持的命令只能查询状态、重新读取资源并由业务层决定是否重试。

Execution 的默认资源预算由 Main 维护（墙钟、CPU、内存、输出、并发命令和 pending Promise 均有限制）；连接关闭会停止继续发起命令。已进入不可中断文件阶段的操作可能按恢复语义收口，而不是瞬间回滚。

## 8. 日志与脱敏

MCP result/stdout 只承载协议数据。诊断日志包含 `executionId`、命令 ID、耗时、重试、取消、能力拒绝和稳定失败原因，并关联 `logId`。不要把 stdout 当作业务日志流。

以下内容不得出现在 Agent 可见结果、Execution 记录或普通日志中：API Key、Authorization header、完整秘密配置、脚本中的显式 secret、任意二进制和未经脱敏的外部绝对路径。`library.inspect` 只返回 `libraryId` 与显示名；复制路径工具只返回复制数量，路径写入系统剪贴板。

## 9. 附着 Desktop 的实现边界

附着控制面使用 userData 下的本机 loopback endpoint 和 nonce 握手；连接后仍由 Main 创建并持有 MCP Execution。附着请求会等待当前活动库，并要求本机确认。关闭 stdio 连接会取消该附着会话的 Execution，不会关闭 Desktop 或资源库。

附着工具的当前行为以 `tools/list` 返回的 schema 为准。它们是本地开发态和本地 Host 集成入口，不是远程服务；当前仓库没有为它们提供跨机器认证、系统级 daemon 或稳定的独立 packaged 启动器。

## 10. 排障流程

1. **没有响应或启动失败**：确认 Node 版本、依赖、工作目录和绝对资源库路径；无库流程必须带 `--unbound`。查看 stderr，不要从 stdout 判断诊断。
2. **`tools/list` 没有写工具**：检查是否真的以 `--write-access` 启动；确认 Host 没有复用旧进程/userData；再检查目标命令的能力和 Registry 暴露条件。不能通过请求体自授权。
3. **`MCP_EXECUTION_REQUIRED`**：客户端/适配器没有使用由 Main 创建的 MCP Execution；不要自行生成 execution ID。
4. **`AUTOMATION_LIBRARY_NOT_BOUND`**：当前会话是 unbound，先调用允许的 `serpent_library_create` 并等待绑定，或重启时指定 `--library`。
5. **`AUTOMATION_CAPABILITY_DENIED` / `MCP_TOOL_NOT_EXPOSED`**：能力或本地写配置不足；重新建立正确权限的会话，不要重试同一个被拒请求。
6. **计划拒绝、过期或部分成功**：把返回的计划/跳过/失败项记录下来；资源库变化后重新读取并重新预检，不要复用旧批准。
7. **调用超时**：先调用 `serpent_execution_status`；若仍运行，等待或取消；仅对支持幂等的写命令用同一 key 重试。
8. **stdio JSON 解析失败**：检查是否有库代码或启动器把日志写到 stdout；所有诊断改到 stderr。也确认没有把 `mcp-session` 的本地 JSON 控制协议直接当成 MCP stdio。
9. **资源库变化没通知**：确认 Execution 已绑定目标库；通知是 logging message，不是工具返回值，且不会发给 unbound/其他库会话。
10. **想控制窗口/选区**：确认使用默认附着模式，而不是 `--headless`；Desktop-only 工具不会在 headless 会话中出现。

## 11. 实现者自检清单

- 只通过 MCP SDK `initialize`、`tools/list`、`tools/call` 和标准 logging message。
- 不在适配器中直接访问 SQLite、LibraryService、文件系统、Node 内建模块或网络。
- 所有新工具先进入 Automation Registry，再由 MCP catalog 暴露；不手写平行 Schema。
- 严格区分公开读工具、执行级写工具和计划级写工具。
- 输出校验、稳定错误码、分页上限、日志脱敏和 stdout 纯净性都有测试。
- 变更 API 版本、工具 Schema 或审批元数据时，同步更新类型、fixture、Host 示例和对应测试。
- 用临时 userData 做集成测试；不要把真实资源库或默认配置作为 fixture。
