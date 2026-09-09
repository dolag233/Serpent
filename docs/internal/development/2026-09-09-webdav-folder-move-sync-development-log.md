# WebDAV 建文件夹/移动已有资产不同步（GitHub #31）

## 问题

用户反馈 https://github.com/dolag233/Serpent/issues/31：

1. 在库里新建文件夹，把**已经同步过**的照片移进去，远端既没有该文件夹，根上原文件也不删。只有把**新文件**拖进文件夹才会上传。
2. 设置页把自动轮询改成 60 秒，再打开又变回 5 秒；界面像一直在同步。
3. 同步冲突时希望能强制用云端或强制用本地覆盖。已扩展为 P2 路线图：资产显示已同步 / 等待同步 / 正在同步 / 冲突，冲突须手动选本地或云端，状态可隐藏（`Serpent-871f34`）。

## 根因

### 路径变更被当成无变化（`Serpent-038ecf`）

`planSyncActions` 对双侧已知资产只比较 `contentHash`。本地移动/改名不改内容，两边哈希都没变，规划器输出空动作。

新拖入的文件是「本地有、manifest 无」→ `upload`，路径带新目录，runner 上传前会对父目录 `MKCOL`，所以只有新文件会「带出」文件夹。

规格要求远端 `assets/` 与库内文件夹层级一致；WebDAV 驱动已有 `MOVE`/`MKCOL`，缺的是规划层。

### 轮询间隔保存丢失（`Serpent-8c4920`）

设置页把 `pollIntervalMs` 传给 `syncSaveBinding`，但 preload 解构时丢掉该字段。Main 用 `request.pollIntervalMs ?? previous`，永远拿不到新值，UI 回落默认 5 秒。5 秒一轮询再叠加完整同步，看起来就像一直在同步。

## 修复

- 路径变、哈希不变：本地改路径 → 远端 `MOVE`（先 `MKCOL` 父目录）；远端改路径 → 本地 `applySyncRelocate`（复用托管移动，必要时建文件夹）。
- 内容与路径都变：`upload` 到新路径，并带 `previousPath` 先 MOVE 再 PUT。
- 服务端不支持 MOVE 时退化为复制 + 删除。
- preload / `library-api` 完整传递 `pollIntervalMs`。

空文件夹里还没有任何资产时仍不同步：交换格式按文件布局，没有资产条目就不会 MKCOL。这与「把已有照片移进文件夹」不是同一条路径。

## 验证

- `tests/worker/sync-plan.test.ts`：本地改路径 → `move-remote`；远端改路径 → `relocate-local`；内容+路径 → `upload` + `previousPath`。
- `tests/worker/sync-runner.test.ts` / `sync-engine.test.ts`：MOVE 后新路径有内容、旧路径消失。
- `tests/worker/sync-library-integration.test.ts`：`applySyncRelocate` 建文件夹并搬走托管文件。
- `tests/unit/protocol.test.ts`：绑定保存请求保留 `pollIntervalMs`。
- 真实 Electron / packaged 未执行，见验收清单 SYNC-FOLDER-001、SYNC-POLL-001。
