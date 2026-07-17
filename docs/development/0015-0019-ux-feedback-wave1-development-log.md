# Wave 1 开发日志：2026-07-17 第二批用户反馈（T1–T4）

> 建立：2026-07-17
> 范围：`mvp-ui-ux-requirements-backlog.md`「2026-07-17 第二批反馈排期」Wave 1 四轨道
> 执行方式：workflow + worktree 并行启动；API 配额中断后由主 agent 顺序接管合流（T1/T2/T4 半成品由主 agent 检视补齐）。审查状态逐轨道如实记录。

## T3 — BUG-TRASH-001 回收站预览丢失（已合流 `d4de957`，实现 `39f134d`）

### 根因（先写失败测试复现，再修复）

`getArtifactAbsolutePath`（`src/worker/library-service.ts:7703`）在 artifact 解析 SQL 中过滤 `a.deleted_at IS NULL`，资产移入回收站后 worker 拒绝解析其缩略图 artifact（`ASSET_NOT_FOUND` → Main 的 `serpent://` handler 返回 404 → `<img>` 不解码）。另发现同族缺陷：`listTrash` 从不 JOIN artifact 状态，恒定返回 `thumbnailArtifactId=null`。

已证伪的假设：回收站物理移动只动源文件（`.serpent/trash/<assetId>/`），不触碰 `revision_artifacts`；回收站视图走的是正常缩略图路径（searchAssets trash scope → `thumbnailArtifactMap`，无 `deleted_at` 过滤）。

### 修复（根因修复，非补丁）

1. 移除 `getArtifactAbsolutePath` 的 `deleted_at` 子句；服务边界由 `a.current_revision_id = ra.revision_id` 的 JOIN 承担——永久删除（行被 DELETE）的资产仍无法解析，`status='ready'`、`invalidated_at IS NULL`、usage allowlist、realpath/符号链接 containment 检查全部不变。
2. `listTrash` 复用 `thumbnailArtifactMap` + 媒体类型探测（与 `searchAssets` 同模式），两条回收站列表路径暴露一致的缩略图状态。

### 影响面核查

全部 4 个 `getArtifactAbsolutePath` 调用方：protocol 分发（本意）；AI 云端分析读字节（AI 入队自身在 `:7832/:7906` 过滤 deleted_at，无害）；palette 读取（best-effort）；palette job（对 trash 竞态从误报 ASSET_NOT_FOUND 变为健壮）。`serpent://source`（getCurrentMediaSource）仍拒绝 trashed 资产——不变（查看页本就不能从回收站打开）。链接资产不进 Serpent 回收站（trashAssets 拒绝非 managed；deleteLinkedAssets 硬删行）——行为不变。

### 证据（四列）

| 需求 | 实现 | 自动化 | 人工/平台 |
| --- | --- | --- | --- |
| BUG-TRASH-001 | `src/worker/library-service.ts:7703-7717`、`10612-10634` | `tests/worker/trash-relink.test.ts:393`（trash 后可解析+sharp 可解码，修复前 ASSET_NOT_FOUND）、`:434`（listTrash/search 一致）、`:451`（trash→restore 字节一致）、`:480`（永久删除回归门禁）；worker 相关 111 passed；全量 988 passed + 2 skipped（worktree 内 Electron runtime） | E2E 与 Computer Use **未执行**（合流后由主 agent 后台跑 E2E；视觉移交人工 QA） |

### 审查状态（如实记录）

- 实现 agent 自做双轴自审（Standards/Spec 无阻断）。
- workflow 广度审查 3/6 完成并通过（regression、a11y-text、css-visual，0 findings）；Standards 深审、Spec 深审、security 广度因 API 配额 403 未执行。
- 合流时主 agent 深审实现 diff（`39f134d`）：SQL 边界、listTrash 对齐、调用方影响与测试断言真实有效，判定通过。
- 纪律 #11 的 2 sonnet + 4 haiku 完整交叉审查本增量未足额执行（配额），记录为偏差；后续增量配额恢复后优先补齐。

### 环境注记

新 worktree `npm ci` 后 better-sqlite3 为 Node ABI 137，canonical `npm run test` 在 Electron 43（ABI 148）下需 `npx @electron/rebuild -f -w better-sqlite3`；该全量失败在未改动基线上复现，证明为环境问题而非本变更引入。

---

（T1/T2/T4 章节随合流追加。）
