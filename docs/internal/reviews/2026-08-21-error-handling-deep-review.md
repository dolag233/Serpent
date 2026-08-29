# 错误处理深审（2026-08-21）

> 触发：用户反馈回收站永久删除后重启资产复现、二次删除报「未能分类的内部错误」。日志 `serpent (2).log`（2026-08-19）。本报告为 Composer 2.5 只读双轴审查结论，**未改代码**。

## 案例时间线（永久删除）

| 时刻 | 事件 |
|------|------|
| 13:51 | 第一次永久删除确认；~11s 后 `asset.metadata.get` → `ASSET_NOT_FOUND`（第一次可能已删库记录） |
| 14:28 | 第二次删除：`WORKER_REQUEST_TIMEOUT`（15s）→ Main 映射 `INTERNAL_ERROR` + `LIBRARY_TRANSFER_TIMEOUT`；Worker 3s 后返回 `ASSET_NOT_FOUND` 被 `Ignored a valid response for a timed-out request` 丢弃 |
| UI | toast「已永久删除 1 项」、标题「回收站 0 项」、侧栏仍显示 1——`applyLocalAssetRemoval` 不更新 `trashedAssetCount`；`reloadCurrentContent().catch(() => undefined)` 静默失败 |

## 关键代码位置

- `src/main/worker-client.ts`：默认 15s 超时；`#expiredRequestIds` 丢弃迟到响应；`#protocolFailure` 杀 Worker
- `src/main/index.ts:5193-5195`：所有 `WorkerRequestTimeoutError` → `INTERNAL_ERROR` + `LIBRARY_TRANSFER_TIMEOUT`（开库文案）
- `src/worker/library-service.ts:27591-27711`：`deleteAssetsPermanent` 非幂等（已删抛 `ASSET_NOT_FOUND`）
- `src/worker/index.ts:891-916`：destructive 命令前先 `createDatabaseBackup`
- `src/renderer/App.tsx:6637-6674`、`5061-5089`：乐观 UI 与侧栏计数不同步

## 系统性问题（审查共识）

### 1. 超时与 INTERNAL 塌缩（P0/P1）

- 15s 默认超时 + 全局 INTERNAL + **开库专用** `LIBRARY_TRANSFER_TIMEOUT` reason，覆盖搜索/移动/删除/undo 等
- `asset.delete-linked` 已无超时；同族 `delete-permanent` / `delete-from-disk` / `purge-trash` 未跟进
- Main shell/clipboard（`index.ts:4650-4874`）硬编码 `INTERNAL_ERROR`
- `classifyUnknownFailure` 缺口：ETIMEDOUT、EXDEV、SQLITE_CONSTRAINT 等仍落 INTERNAL

### 2. 错误码语义误用（P1）

- **`INVALID_IMPORT_DECISION` 被误用于非导入场景**（已在回收站再 trash、恢复已恢复资产）→ 用户看到「导入冲突处理选项无效」——最高频「莫名其妙」来源之一
- `toMessage` 双轨：`LibraryOperationError` 优先 INTERNAL 长文；裸 `PublicError` 只用 fallback（AI 路径丢 reason）
- 7 个公开码缺 zh-CN：`FOLDER_NOT_EMPTY`、`AUTOMATION_UNDO_*`（3）、`PLUGIN_HOOK_BLOCKED`、`HISTORY_TOO_LARGE`、`SYNC_IN_PROGRESS`
- 同步服务器已删：Main 抛中文 `Error`，`toPublicError` 剥 message → INTERNAL

### 3. 删除 UX（P1，与案例相关）

- `trashedAssetCount` 与乐观移除不同步
- reload 失败无用户反馈
- 永久删除应对已删资产幂等或返回专用码，不得 15s 后备份+删除后再 ASSET_NOT_FOUND

## 建议修复优先级

1. 超时：按命令映射；破坏性写操作拉长/取消墙钟超时；超时专用公开码，禁止套开库文案
2. 错误码：`INVALID_IMPORT_DECISION` 不得作通用非法状态；已删除/已完成应幂等或专用码
3. Main：shell/clipboard/同步服务器缺失等不走硬编码 INTERNAL；保留中文 actionable message
4. Renderer：`toMessage` 统一处理 `PublicError` + reason；补 7 个中文码
5. Worker：裸 Error → 已有公开码；扩展 `classifyUnknownFailure`
6. 删除 UX：`trashedAssetCount` 同步、静默 reload 失败要有反馈

## 关联工单

- 母单：`Serpent-n5iu`（INTERNAL_ERROR 系统性排查，in_progress）
- `Serpent-f24e55` [P0] 回收站永久删除超时误报 INTERNAL 且侧栏计数不同步（依赖 `Serpent-779f2e`）
- `Serpent-779f2e` [P1] Worker 破坏性写操作超时与 OPERATION_TIMEOUT 语义收口（依赖 `Serpent-n5iu`）
- `Serpent-50c466` [P1] INVALID_IMPORT_DECISION 不得用于非导入非法状态
- `Serpent-d19850` [P1] Main shell/clipboard 等硬编码 INTERNAL 改为可操作错误（依赖 `Serpent-n5iu`）
- `Serpent-4ddfe8` [P1] Renderer toMessage/i18n 缺口与 classifyUnknownFailure 扩展（依赖 `Serpent-n5iu`）
