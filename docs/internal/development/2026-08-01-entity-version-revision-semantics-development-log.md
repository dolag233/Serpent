# 2026-08-01：元数据并发版本与内容修订语义

> 工单：`Serpent-jftz`  
> 基线：`443fb4a45c259e4feb26446a994042f8a933fa69`  
> 开始时间：2026-08-01  
> 状态：完成（保留既有 E2E 红灯）

## 目标

区分 `entity_version` 与文件内容 `Revision/currentRevisionId`：

- `entity_version` 仅作为 `AssetMetadata` 行的乐观并发控制 token。
- `currentRevisionId` 表示当前文件内容修订；导入、替换或接受外部内容变化时切换。
- 元数据、组织关系、移动、重命名、回收站和恢复不应被显示为内容版本变化。

## 审计结论

- Worker 的 `assets.current_revision_id` 与 `revisions` 已用于 AssetSummary，并由导入替换、托管文件外部刷新、链接文件外部刷新路径更新；既有 Worker/E2E 测试已覆盖这些内容变化。
- `setAssetMetadata` 递增 `asset_metadata.entity_version`，不写入 `assets.current_revision_id`。
- Inspector 原先把 `entityVersion` 显示为泛化的“版本”，会把元数据并发 token 误导为文件内容版本。本增量移除该用户界面行；该 token 仍保留在 API 返回值和 `expectedVersion` 输入中供并发控制。
- 自动化资产列表/搜索的公共声明补充 `currentRevisionId`；脚本文档明确 `expectedVersion` 与内容修订的边界。

## 当前改动

- 移除 Inspector 的错误“版本”展示、对应样式和本地化键。
- 为共享资产类型、自动化 Registry 生成声明及 `automation-api.d.ts` 补充语义注释。
- 为自动化资产公共类型补充 `currentRevisionId`，并明确 `setMetadata` 使用元数据 token。
- 新增 Worker 回归测试，确认元数据更新递增 `entityVersion` 但保持 `currentRevisionId`。
- 更新组织元数据 Electron E2E，确认 Inspector 不显示内部版本 token，同时保留乐观锁冲突和重启持久化断言。

## 验证记录

### RED

- `npx vitest run tests/unit/automation-command-gateway.test.ts`：按预期失败，生成声明尚未包含 `currentRevisionId`。
- `node scripts/run-e2e.mjs tests/e2e/organization-metadata-persistence.test.ts`：按预期失败，旧 Inspector 仍渲染 `.inspector-version-line`。

### GREEN

- `npx vitest run tests/unit/automation-command-gateway.test.ts`：37/37 通过。
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/asset-metadata-revision.test.ts`：1/1 通过；确认元数据更新递增 `entityVersion` 且保持 `currentRevisionId`。
- `node scripts/run-e2e.mjs tests/e2e/metadata-version-semantics.test.ts`：1/1 通过；真实 Electron 导入资产后 Inspector 不显示 `.inspector-version-line` 或“版本 N”。
- `npx eslint` 定向检查涉及 TypeScript/E2E 文件：通过。
- `npm run typecheck`：通过（主 TypeScript 与 extension TypeScript）。
- `npm run lint`：通过；仅有既有 `library-service.ts` 超过 500KB 的 Babel deoptimise 提示。

`tests/e2e/organization-metadata-persistence.test.ts` 当前 3 项中 1 项通过、2 项失败。
失败分别是现有的跨进程乐观锁 UI 假设和多选 Inspector fixture：前者当前应用会在外部
metadata 写入后刷新 UI，后者快照显示 alpha/beta 同时选中；均不是本增量新增的内容修订
行为。专用语义 E2E 已独立通过，因此不把该文件的部分失败写成当前增量全绿。

## 已知边界

- `currentRevisionId` 是稳定 ID，不是面向用户的递增数字；当前没有版本历史 UI，本增量不新增无用户价值的内容版本展示。
- `tests/e2e/organization-metadata-persistence.test.ts` 的既有失败仍需单独建缺陷/修复，
  在主线门禁中不能忽略。
- 真实 Computer Use、packaged 和 Windows 尚未执行。
