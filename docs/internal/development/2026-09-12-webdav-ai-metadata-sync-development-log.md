# WebDAV 同步纳入 AI 元数据（2026-09-12）

## 范围

GitHub #39 要求标签、描述、评分随 `metadata/entries` 双向传输，复现步骤核过 `human_asset_tags` **和** `ai_asset_tags`。2026-09-11 首期 sidecar 只读人手表。用户在同步库用 AI 自动打标后，对端 Inspector 看不到标签、评分、简介。工单 `Serpent-4ffae8`。合集成员仍不同步。

## 实现摘要

- sidecar 增加可选 `ai`：`tags` / `description` / `rating` / `modelId` / `modelVersion`。写入 `ai_asset_tags` 与 `ai_content`，不写 `human_asset_tags` / `asset_metadata`。
- 无 `ai` 键的旧 JSON 与原人手哈希兼容；应用时不覆盖本机 AI 层。
- `writeAiAnalysisResult` / `clearAiContent` 在用户命令边界发 `asset.changed`，自动同步能捡到 AI 完成与清除。同步回放仍走 `withSyncReplay`。

## 验证

- `npx tsc --noEmit`：通过（并修了 `managedFolderCountMaps` 子文件夹计数仍引用未定义 `placeholders` 的编译错误，改走 `withSqliteInPredicate`）。
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/sync-metadata.test.ts tests/worker/sync-library-integration.test.ts tests/worker/sync-two-device.test.ts tests/worker/sync-plan.test.ts`：4 files / 30 passed。
- 同上套件另跑 `tests/worker/ai-completion.test.ts tests/worker/ai-analysis.test.ts tests/worker/sync-engine.test.ts`：3 files / 86 passed。
- `npm run test:library-availability`：9 files / 209 passed / 1 skipped。
- `tests/worker/webdav-sync-e2e-manual.test.ts` 已补 AI 断言；本机未跑真实 WebDAV 门控（需已配置的临时远端目录）。不要写用户 NAS。

Computer Use、packaged、真实双机未执行。清单 `SYNC-META-001` 待人用 AI 打标路径再点。
