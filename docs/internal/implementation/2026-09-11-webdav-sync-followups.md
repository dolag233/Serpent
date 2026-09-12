# WebDAV 同步后续（2026-09-11）

> 状态：实现已落地；真实 WebDAV worker 门控已通过（仅临时远端目录）；待人类 UI 验收  
> 日期：2026-09-11  
> 证据：GitHub [#38](https://github.com/dolag233/Serpent/issues/38)、[#39](https://github.com/dolag233/Serpent/issues/39)、[#40](https://github.com/dolag233/Serpent/issues/40)；0.2.1 Windows + 飞牛 NAS WebDAV 用户日志与源码对照  
> 工单入口：Epic 见本文 §6；执行队列以 `.beads/issues.jsonl` 为准

本文件给后续 agent 用。不要凭聊天记忆改行为。不要把十万导入 epic `Serpent-168624` 和本设计混在同一 PR。

## 1. GitHub #31 口径

产品口径：**#31 已关闭，不再当作执行队列。**

已落地、不要重做：

- `planSyncActions` 路径变更 → `move-remote` / `relocate-local`（`Serpent-038ecf`）
- 绑定保存传递 `pollIntervalMs`（`Serpent-8c4920`）
- 冲突手选与状态徽章仍是路线图 `Serpent-871f34`（P2），不是 #31 的关闭条件

人类验收 `SYNC-FOLDER-001` / `SYNC-POLL-001` 仍可点验手动同步与轮询秒数；**不要**再往 #31 上堆新评论或把新缺陷写回该 issue。

#31 关闭后仍留在 HEAD 的独立缺口：本地建文件夹并移动已有资产时，**自动同步不触发**。手动「立即同步」可以 MOVE。这不是规划层回归，不要重开 #31，走本文 §5.1。

## 2. 仍打开的 GitHub issue

| GitHub | 用户可见现象 | HEAD 对照 |
| --- | --- | --- |
| #38 | 进回收站后 `sync.run` 报 `RemoteStorageError: CONFLICT`；永久删除/再导入仍 CONFLICT；`media.get-artifact-paths` `ENOENT`/`ASSET_NOT_FOUND`；渲染 `e.trim is not a function`，界面不可用 | 回收站会发 `asset.changed`，自动同步会跑。`syncSnapshot` 排除 `deleted_at` 非空行，规划为 `delete-remote` + `tombstone-upload`。单条 HTTP 409 会让整次 `sync.run` 失败。缺 artifact 当资产不存在。Renderer 对非字符串 `.trim()` |
| #39 | 标签/描述不同步；NAS 无 `metadata/`；手册写首次同步上传元数据 | `SYNC_METADATA_DIR` 仅定义于 `src/shared/sync-paths.ts`，worker 同步路径零引用。`metadataVersion` 写死 1。`SyncLibraryPort` 无元数据读写 |
| #40 | 后接入设备把远端 `manifest.json` 的 `libraryId`/`displayName` 改成自己的值 | `syncOnce` 把以本机 `localManifest` 为起点的 JSON 无条件 PUT。远端已有身份不会保留 |

#31 评论里 CODES233 的「等 1h40m 无 sync 事件、手动立刻成功」与 §5.1 同一根因。文件夹未自动上去时，后接入设备看到扁平 `assets/`、`managed_folders` 为 0，会和 #39 叠在一起，但不是元数据通道问题。

## 3. 不变量（实现不得破坏）

1. **交换格式仍是文件 + manifest，SQLite 永不上传。**
2. **空文件夹仍可不出现在远端**（按文件布局；没有资产条目就不 MKCOL）。
3. **同步会话产生的本地搬移不得再触发一轮自动同步死循环。** `applySyncRelocate` → `applyManagedMoveOperation` 若发 `asset.changed`，debounce 后会再 `sync.run`。用户手势才发事件；同步回放保持静默，或 `source: 'sync'` 且调度器忽略。
4. **远端已有 `libraryId` 后，后写入设备不得用本机 UUID 覆盖。** `displayName` 以远端已有值为准，直到产品另做「重命名库并传播」。
5. **一次同步不得因单个资产 HTTP 409 让整库停在 CONFLICT 循环。** 失败要落到该资产，其余动作继续，会话能写回一致的 manifest。
6. **已进回收站或永久删除的资产，缺 artifact 不得把浏览界面打穿。**
7. **迁移只加不改。** 元数据走交换格式文件，不改现有表语义。
8. **Renderer 不接收路径/SQL。** WebDAV I/O 只在 Worker。
9. 改资源库 / 同步引擎必须跑完 `npm run test:library-availability`，并补 sync plan/runner/engine 定向测试。

## 4. 明确不做（本轮）

- 不重开或继续实现 GitHub #31 标题下的 MOVE 规划与轮询秒数。
- 不在本轮做 `Serpent-871f34` 全套卡片同步状态与可隐藏徽章（可与 #38 的「强制本地/云端」分 PR）。
- 不同步插件安装目录、脚本、MCP 配置（#38 末尾产品建议，另开单）。
- 不把远端 `trash/` 做成用户可浏览的「云回收站 UI」；墓碑文件已存在，只保证删除传播可靠。
- 不合集成员、智能合集单独通道；#39 的 sidecar 覆盖人手与 AI 的标签、描述、评分，以及收藏。合集成员仍不同步。
- 不把资源库直接放到 SMB 当同步（#41 已关，不是 WebDAV）。

## 5. 设计决策

### 5.1 本地路径变更必须触发自动同步（P0）

根因：`src/main/sync-auto-scheduler.ts` 只订阅 `onAssetsChanged`。云端轮询只比远端 manifest 与本地缓存，**看不见本地搬家**。

`moveAssets` → `applyManagedMoveOperation` **不发** `asset.changed`。`createManagedFolder`、`renameManagedFolder` 也不发。导入新文件会发，所以「只有再拖新文件才上传」。

应对：

- 在用户命令边界发 `asset.changed`（`source: 'client'`）：`moveAssets`、`undoMoveAssets`、`renameManagedFolder`（改写了下属资产路径时）、`renameAssetFile`（已有则核对）。
- **不要**在 `applyManagedMoveOperation` 无条件广播，避免 `applySyncRelocate` 回放时再次调度。
- 单测：move 后调度器在 debounce 窗口收到事件；`applySyncRelocate` 不发或调度器忽略 `source === 'sync'`。
- 空文件夹仍不同步；验收看「已有资产移入后自动出现远端目录」，不是空目录 MKCOL。

### 5.2 回收站 / 删除同步不得整库 CONFLICT（GitHub #38，P0）

`syncSnapshot` 不含回收站行，规划 `delete-remote` + `tombstone-upload` 是对的。失败来自：

1. `webdav-driver` 把 HTTP 409 打成 `CONFLICT` 且 `retryable: true`，三次后抛出，`sync.run` 整单失败，manifest 不写回，基线永远脏。
2. 远端路径仍被旧 `syncId` 占用时，再导入被当成新资产 `upload`，PUT 再 409。
3. 缺 `.serpent/artifacts/…` 时 `getArtifactAbsolutePath` 抛 `ASSET_NOT_FOUND`。
4. Renderer 把非字符串当 `e.trim()`。

应对：

- `delete-remote`：远端已无文件视为成功（404/409 且 GET 不存在）。墓碑 PUT 不带陈旧 If-Match。
- 单资产失败记入会话结果，不中断其余动作；写回的 manifest 只包含已成功条目。
- 规划：本地已无资产且远端同路径被**另一个** `syncId` 占用时，先按墓碑处理旧条目，再 upload 新条目，禁止对占用路径盲目 If-Match PUT。
- 缺 artifact：返回缺失并入队重建，禁止用 `ASSET_NOT_FOUND` 表示「缩略图文件没了」。
- Renderer：`toMessage` / toast / 同步错误文案对非字符串做防护，界面保持可点。
- 已卡死的库：同步设置提供「用远端清单重置本地基线」（只重写 `sync_manifest_cache`，不删 Assets）。完整「强制本地/云端」仍归 `Serpent-871f34`。

### 5.3 远端 manifest 身份稳定（GitHub #40，P1）

`runSyncActions` 从本机 `localManifest` 起步。缓存为空时 `createEmptyManifest` 用本机 `libraryId`/`displayName`。`syncOnce` 无条件 PUT 该对象。

后接入设备若本地库 ID 与远端不同（打开同步库时未钉死远端 ID，或绑定了另一份本地库到同一文件夹），会覆盖身份。报告里出现默认名「我的资源库」时，优先核 `createLibrary` 是否用 `path.basename(finalPath)` 覆盖了传入的 `displayName`，以及 `sync.open-remote-library` 是否把远端 `libraryId` 写入 `library` 表。

应对：

- 远端已有合法 `libraryId`：写出的 manifest **必须**保留该 `libraryId`；`displayName`/`directoryName` 同样保留，除非本机正在执行「重命名本库」且产品确认要传播。
- 打开同步资源库：本地 `library.library_id` = 远端 manifest `libraryId`，显示名 = 远端 `displayName`。禁止另造 UUID 再写回。
- 本机 `libraryId` 与远端不同：拒绝覆盖身份，诊断为绑定错误，提示「这是另一份资源库」。
- 禁止用空 `entries` 覆盖非空远端 manifest。
- 单测：B 机空缓存同步后，远端 `libraryId` 仍是 A；A 再同步仍是 A。

### 5.4 标签 / 描述同步（GitHub #39，P1）

手册已承诺首次同步上传元数据。常量 `SYNC_METADATA_DIR` 未接线。`metadataVersion` 恒为 1，`pollRemoteChange` 的比较无意义。

首期范围：人标签（名称列表）、描述、评分、收藏，以及 AI 标签 / AI 简介 / AI 评分（独立 `ai` 对象，写入 `ai_asset_tags` / `ai_content`，不写进人表）。文件夹层级走资产 `path`（依赖 §5.1 真的把路径传出去）。合集成员不做。

应对：

- 每资产一份 JSON，路径 `metadata/entries/<syncId>.json`，与 manifest `metadataVersion` 同号递增。
- `SyncLibraryPort` 增加读本地元数据 / 应用远端元数据。规划：`metadataVersion` 单侧增加 → 上传或下载 sidecar；双侧不同且字段冲突 → 该资产元数据 LWW（与文件冲突副本策略分开，首期不要为标签再做 `(conflict-…)` 文件）。
- 改标签/描述/评分/AI 分析结果必须让自动同步跑起来（`asset.changed` 或等价 dirty）。
- 打开同步库下载文件后必须应用 sidecar，不能只落媒体。旧 sidecar 没有 `ai` 键时不覆盖本机 AI 层。
- 测试可用极小文件 + 标签字符串，不要拷用户库。

若首期时间只够改文档：那是产品降级，须改 `docs/user-guide/sync.md` 与英文手册，明确「当前版本不同步标签/描述」。默认实现通道，不默认只改文档。

## 6. 工单与依赖

实现顺序：先自动触发（否则文件夹/元数据验收会误判），#38 可并行（回收站已会触发同步）。#40 与 #39 不要和 #38 挤进同一 PR。

| ID | 优先级 | 主题 | 依赖 |
| --- | --- | --- | --- |
| `Serpent-6e68cf` | P1 epic | WebDAV 同步后续（#38/#39/#40） | 被全部子单阻塞；不要认领 |
| `Serpent-486cba` | P0 | 本地移动/改文件夹名触发自动同步 | 无；先做 |
| `Serpent-77a39f` | P0 | GitHub #38 回收站 CONFLICT 与界面崩溃 | 无 |
| `Serpent-079d71` | P1 | GitHub #40 manifest 身份不覆盖 | 无 |
| `Serpent-b20a7f` | P1 | GitHub #39 标签/描述 sidecar | 被 `Serpent-486cba` 阻塞 |
| `Serpent-871f34` | P2 已有 | 状态徽章与冲突手选 | 不纳入本 epic |

## 7. 测试

- 调度器：`moveAssets` 后在 debounce 内出现 `local-change` 同步请求；`applySyncRelocate` 不叠加第二次。
- plan/runner：回收站 → delete-remote 成功或 404 视为成功；单条 409 不抛翻整次 `syncOnce`。
- engine：远端已有 libraryId 时写出仍为该 ID；空 entries 不得覆盖非空远端。
- 元数据：A 写标签与描述（含 AI 自动打标）后 sidecar 存在且 `metadataVersion` > 1；B 打开同步库后本地人字段与 AI 层均非空。
- Renderer：`toMessage` 对 `{ code: 'CONFLICT' }` 对象不抛。
- 改 library-service / 开库 / 同步：完整 `npm run test:library-availability`。
- 不要用用户真实库路径或 NAS 地址；测试目录用完即删。

## 8. 验收条目（实现同一提交写入清单）

仅用户本人可把 UI 条标成「人类验收通过」。实现前不要把下列 ID 标成待验收。

- `SYNC-AUTO-MOVE-001`：已同步照片拖进新建文件夹，只等自动同步（不要点立即同步），远端 `assets/` 出现子目录且根上原文件消失。
- `SYNC-TRASH-001`：已同步照片进回收站，同步结束不整库 CONFLICT；浏览界面仍可点；缺缩略图会重建而不是卡死。
- `SYNC-ID-001`：第二台电脑「打开同步资源库」后，远端 `manifest.json` 的 `libraryId`/`displayName` 仍是第一台写入的值。
- `SYNC-META-001`：第一台打标签（人手或 AI）、写描述或等 AI 简介并等同步；第二台打开同步库后能看到同一标签和描述。合集成员本轮不同步。
