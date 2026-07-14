# 切片 0007 双轴代码审查

> 状态：双轴通过（0 HARD 违规，2 非阻断气味）；完整规格满足
> 日期：2026-07-13（基线）/ 2026-07-14（补充）

## 审查范围

- 固定范围：`8dc2470...cdc2247`（基线）
- 补充审查：`8d53057` + 未提交 working-tree diff，含 4 个新文件
- 规格：`docs/implementation/0007-trash-relink-batch-relocate-vertical-slice.md`
- 未提交 diff 范围（`git diff HEAD --`）：`src/main/index.ts`、`src/main/relink-preview-store.ts`（新）、`src/preload/index.ts`、`src/renderer/App.tsx`、`src/shared/asset-types.ts`、`src/shared/library-api.ts`、`src/shared/protocol/errors.ts`、`src/shared/protocol/requests.ts`、`src/shared/protocol/responses.ts`、`src/worker/index.ts`、`src/worker/library-service.ts`
- 新文件：`tests/e2e/trash-relink-flow.test.ts`、`tests/unit/asset-types-paths.test.ts`、`tests/unit/relink-preview-store.test.ts`
- 补充修改：`tests/e2e/organization-search-trash.test.ts`、`tests/unit/protocol.test.ts`、`tests/worker/trash-relink.test.ts`

## Standards 轴

### 2026-07-14 relink-preview 增强

- 通过（0 HARD 违规）：不透明 `previewId`（UUID）确保 Renderer 不接触绝对路径——`rootPath` 仅在 Main 的 `RelinkPreviewStore`（`src/main/relink-preview-store.ts`）持有，apply 时 Main 直接转发 Worker，Renderer 始终只有 UUID 句柄。
- 通过：Worker 仍是唯一 DB/文件所有者——`relinkBatchPreview` 与 `relinkBatchApply` 在 `src/worker/library-service.ts` ~L10185/L10232。
- 通过：所有协议边界 Zod 校验——`workerCommand`、`workerSuccessResult`、`rendererRequest`、`rendererSuccessResult` schema 在 `tests/unit/protocol.test.ts` 中覆盖；`portableRelativePathSchema` 拒绝绝对/UNC 路径（`tests/unit/asset-types-paths.test.ts`）。
- 通过：SQL 完全 `?` 参数化——`batchRelinkRows`、`batchRelinkMatches`、`batchRelinkApply` 均无字符串拼接。
- 非阻断气味（2 项）：
  1. `src/worker/library-service.ts` ~L10185/L10232：`relinkBatchPreview` 与 `relinkBatchApply` 之间约 8 行重复的辅助调用（`normalizeAbsolutePath`、`realDirectoryExists`、`assertNoSymlinkEscape`、`batchRelinkRows`、`batchRelinkMatches`），可抽取共享辅助但当前不阻塞。
  2. `src/main/relink-preview-store.ts`：`RelinkPreviewStore` 的 Primitive Obsession——3 操作（create/consume/cancel/clearLibrary）的 token store，适当设计，不值得因过度工程化而膨胀。

### 2026-07-13 基线

- 通过：托管文件操作和 SQLite 状态变更由 Worker 所有；Renderer 不接收物理回收站路径。
- 通过：软删除保留资产身份和组织/元数据关系，恢复清理删除状态。
- 通过：永久删除逐项处理占用错误，自动清理不会因单项失败阻断整批。
- 通过：E2E 使用公共 UI 与系统选择器接缝，不直接修改数据库。
- 通过：链接源删除用持久化 applying journal 记录 in-flight/trashed 状态，数据库失败后可恢复；
  离线根不会触发推断删除。
- 通过：批次上限、重复 ID 拒绝、helper 与 Main 截止时间避免 Worker 在调用方超时后长期继续。
- 通过：managed 单项/批量重新定位把候选复制回托管空间，刷新与重开后仍可解析真实新字节；
  linked 单项重新定位更新相对路径和 portable identity，不再产生假 available。
- 非阻断风险：过程文档事后重建；Windows 系统回收站语义尚未验证。

## Spec 轴

### 2026-07-14 relink-preview 增强

- 通过：完全满足规格——preview 返回 `{matchedCount, unmatchedCount, totalCount, examples[]}` 且 `examples` 仅含相对路径（`portableRelativePathSchema` 拒绝绝对/UNC）；apply 返回 `{restoredCount, unchangedMissingCount, assets[]}`；0% 匹配返回空 no-op。
- 通过：`keepMetadata=false` 清空行为已覆盖（`tests/worker/trash-relink.test.ts:1731`）——清空人工与 AI 元数据、标签、合集关系；`keepMetadata=true` 保留行为同样在基线已覆盖。
- 通过：无绝对路径到达 Renderer——规格第 220 行不变量通过 `tests/unit/protocol.test.ts` Zod schema 校验与 `portableRelativePathSchema` 断言维持。
- 判定：stateful store + cancel 是**有理增强**（将原有隐式 `pendingRelinkRoots` 状态显式化到 `RelinkPreviewStore`，防止过期重放）——非不当偏离规格。
- 范围新增均为良性加固：崩溃恢复 manifest（`recoverOrphanRelinkPlacement`）、候选去重（`realpath` + linked-root 冲突校验）、`FILE_BUSY` 错误枚举、Renderer 多选永久删除对话框——均不与规格矛盾。

### 2026-07-13 基线

- 通过：公共 UI 已验证托管资产删除、回收站查看和原位恢复主线。
- Worker 测试覆盖永久删除、自动清理、元数据保留、单项找回与批量重新定位的核心路径。
- Worker 回归额外覆盖重新定位后的 `resolveAssetPath`、实际字节、刷新、关闭重开与 artifact 失效。
- 通过：macOS 真实 helper 与 Electron 公共 UI 已验证链接资产同步删除至系统回收站；失败原因
  仅暴露稳定 ID/枚举，物理路径留在日志。
- 待验证：恢复冲突策略、文件占用、`keepMetadata=false`、
  批量重新定位完整公共 UI 和平台行为。

## 结论

双轴通过：Standards 轴 0 HARD 违规（2 非阻断气味），Spec 轴完整满足（含 `keepMetadata=false` 覆盖、无绝对路径泄漏、stateful store 为有理增强、范围新增为良性加固）。代码未提交（working tree uncommitted）。macOS Computer Use 人工视觉 QA 与 Windows 平台行为仍未验证，切片整体尚未 accepted。
