# 2026-09-12 WebDAV 卡片同步状态

工单：`Serpent-871f34`（状态展示本轮落地；冲突手选「使用本地 / 使用云端」未做，工单保持 in_progress）
关联：`Serpent-19ca6e`（同步不覆盖链接文件夹，只记录）

## 行为

已绑定 WebDAV 的资源库：

- 卡片右下角（文件名/大小那一行右侧）显示圆环；悬停约 0.4 秒出现状态名称（`data-hover-tip`）。
- 待上传：蓝色静环。正在上传：绿色圆环 + 高光沿环流动。冲突：黄色实心圆 + 警告三角（不是圆环）。
- **已同步不显示**（产品行为，不写进设置说明）。
- 等待同步：本地相对路径、字节大小或 sidecar 哈希与上次 `sync_manifest_cache` 不一致，或缓存里还没有该 `sync_id`。
- 正在同步：当前 `sync.progress` 处于 run 且 `filesTotal > 0` 时，把等待项改成同步中。
- 冲突：类型与样式已预留；规划器仍是 LWW + `(conflict-…)` 副本，本轮没有可驻留的未解决冲突态，因此不会点亮。
- 链接文件夹、回收站、缺失资产不显示。
- **设置 → 同步**（通用设置，不是资源库设置）有开关「在卡片上显示同步状态」，默认开，写入画布偏好 `badgeSync`。说明文案只写「未同步的文件会在卡片上显示状态。」
- 去掉画布「正在同步 / 已同步」toast；设置页连接状态与进度条仍在。

状态只读本地 SQLite 与 manifest 缓存，命令 `sync.asset-card-status` 只接受当前页最多 300 个 `assetId`。不按卡片请求 WebDAV，也不对源文件做 sha256。

2026-09-12 续：会话日志里 `sync.asset-card-status` 持续 `SqliteError: no such column: byte_size`。`byte_size` 在 `revisions` 上，不在 `assets` 上。查询改为 `JOIN revisions`。卡片因此一直空白，与是否已同步无关。

## 实现

- `src/shared/sync-card-status.ts`：pending 判定与徽章优先级。
- `LibraryService.listSyncCardStatuses`
- 画布偏好 `canvasPrefs.fields.badgeSync`（默认 true）
- `SyncCardStatusBadge` + `useSyncCardStatuses`；占位卡 `BrowseLayoutPreview` 同样画角标
- 主题 token：`--ui-action-accent` / `--success` / `--rating-star` / `--pane`

## 验证

- 定向：`tests/unit/sync-card-status.test.ts`、`tests/worker/sync-library-integration.test.ts` 中 `listSyncCardStatuses`。
- 改了 `library-service`：须跑 `npm run test:library-availability`。
- Computer Use、packaged、真实 WebDAV 双机：未执行。

## 未做

- 冲突资产手选使用本地或使用云端（工单剩余范围）。
- 链接文件夹同步（`Serpent-19ca6e`）。
