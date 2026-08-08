# Serpent Automation Skill

用于编写 Serpent Desktop Console、脚本或 MCP 自动化。

## 约束

- 只使用注入的 `serpent` API；不要使用 Node、文件系统、网络、Shell、SQL、环境变量或任意 IPC。
- 未绑定资源库时只能调用 `serpent.library.create()`。创建成功后必须由 Main/Worker 打开并绑定，才能执行其他命令。
- `library.create`、`files.import`、重命名和移入回收站都需要本机计划确认；脚本或 MCP 不得绕过确认。
- 大结果使用 `limit`/`offset` 分页，不假设单次调用能返回完整资源库。
- 记录并向用户说明 `undoGroupId`、部分成功和不可撤销项；不要把内部绝对路径返回给脚本或 Agent 摘要。
- 对文件移动或回收站操作保留 `undoGroupId`，撤销只能通过 Desktop/Main 的 Undo 入口完成；
  脚本或 MCP 不得自行重放文件操作。若 `skippedCount > 0`，不得报告为全部撤销。
- `library.inspect` 只返回 `libraryId` / `displayName`，不含路径。

## 搜索

- Console / 脚本：`serpent.assets.search({ query: 'tag:抽象' | null, limit?, offset? })`（工具栏同款字符串）。
- MCP：同样可传字符串；也可传结构化 `SearchQuery`。字段名用 `filename`（UI 别名 `name:` 会归一到 `filename`）。
- 子串匹配可能让 `rain` 命中 `rainbow`；需要更严时用更长 token 或多字段组合，并人工核对结果。

## 导入与分类

- `folders.create` 只创建空文件夹。把已有资产移入文件夹请用 `serpent.assets.moveToFolder(assetIds, targetFolderId, { conflictStrategy? })` / MCP `serpent_asset_move`（本机计划确认）。
- 不要把「已创建分类文件夹」单独报告成「已完成文件夹分类」；应核对 `movedCount` / `skippedCount`。
- `expandImageSequences` 默认 false，控制单文件导入是否展开连续同目录帧；导入完成后仍按既有序列识别规则维护序列。导入完成结果应读取 `fileCount`、`assetCount`，并区分疑似重复/跳过/替换；MCP 客户端超时 ≠ 操作未执行——超时后应调用 `serpent_execution_status` 查询当前执行状态，并读取库变更序号 / 目标范围，避免盲目重提旧计划。长写操作建议把 MCP 客户端超时设 ≥5 分钟；MCP 会话墙钟上限为 30 分钟。`library.create` 与 `files.import` 可传非空白、最长 128 字符的 `idempotencyKey`；超时后若确认需要重试，使用同一 execution、同一命令、同一 key 和完全相同的参数。相同 key 的成功结果会复用，参数变化会以 `AUTOMATION_INVALID_REQUEST` 拒绝。

## AI 辅助分类（推荐，非强制默认）

1. 导入资产。
2. `jobs.ai.enqueue` 图像理解。
3. `jobs.ai.status` 等待完成。
4. `assets.getAiContent(assetId)` 读取 AI 描述、标签和建议评分；需要人工字段时另读 `assets.getMetadata`。
5. 按规则 `tags.assign` / `collections.addAssets`。
6. 将已有资产移动到文件夹请使用 `assets.moveToFolder` / `asset.move`，单独经过计划确认；AI 不得直接改磁盘位置或未经确认建立合集关系。
7. AI 不可用或失败时保留导入结果并报告原因。

## 推荐流程

1. 先读取 `docs/manual/scripts/development.md` 和当前 Registry。
2. 先用只读查询确认目标，再执行最小批量写入。
3. 对文件操作保存返回的恢复引用；计划过期或客户端超时时重新读取状态再决定是否重试，不要重复提交旧计划。
4. 运行结束后检查 Execution history 和 `logId`；不要把日志中的路径、凭据或环境变量复制到输出。

## MCP 资源库变更

- MCP 可轮询 `serpent_library_change_sequence`，也可监听标准 `notifications/message`；`data.type` 为 `library.changed` 时读取 `libraryId` 与 `changeSequence`。
- 只有已绑定目标资源库的执行会收到推送；通知不含文件系统路径。

## MCP 启动器

- 默认使用 `npm run mcp` 附着当前已打开的 Desktop；通过本机确认后可调用 Desktop 专用工具（见下）。这些工具只改变窗口、选中或浏览/查看语义状态，不写库、不产生 revision/entity_version 变化；不提供任意 UI、Shell、SQL、网络或文件系统控制。
- Desktop 专用工具：`serpent_desktop_focus`、`serpent_desktop_select_assets`、`serpent_desktop_get_state`、`serpent_desktop_open_folder`、`serpent_desktop_set_discovery`、`serpent_desktop_reveal_asset`、`serpent_desktop_open_viewer`、`serpent_desktop_close_viewer`、`serpent_desktop_navigate_viewer`。
- 多步 Agent 工作流应只附着一次。推荐用 `node scripts/mcp-session.mjs --write-access start` 建立长连接，再用 `call` 复用同一会话；`status` / `stop` 查看或结束。不要为每次工具调用重新 `npm run mcp` 或重复本机确认。
- 需要隔离/无界面流程时使用 `npm run mcp -- --headless --library <绝对路径>`，或使用 `--unbound` 先暴露
  `library.create`；`--write-access` 只表示本机已配置写入能力，不能由 Agent 自行提升。headless 不暴露 Desktop-only 工具。
- `npm run mcp` / `npm run mcp -- --headless ...` 是当前仓库的 stdio 协议启动入口，不是通用 CLI；诊断写 stderr，stdout 只保留 MCP
  JSON-RPC。未绑定执行不能调用资源库范围 Action。
- MCP stdio 本身就是交互式请求/响应通道。若使用命令行包装器，包装器必须持有同一个 MCP Client 和传输连接，把“连接 → 查询 → 用户筛选 → 执行 → 复核”作为同一会话；一次性脚本只允许用于诊断。

独立类型声明见 `docs/internal/skills/serpent-automation/automation-api.d.ts`。它由当前
Registry 的公开命令与 `AUTOMATION_API_VERSION` 维护，不能声明 Registry 之外的 API。

## 能力边界

领域命令的唯一来源是 `src/automation/command-registry.ts`。新增命令必须同时更新 Registry schema、Gateway、Worker protocol、脚本类型、MCP catalog、测试和人类验收清单。
