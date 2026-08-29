# 2026-07-29：脚本资产自动化操作开发记录

> 状态：开发态实现与定向自动化通过；真实 Electron 的评分 E2E 已有基线，新增原生文件计划对话框及全套脚本示例仍待人类验收。

## 本次范围

Desktop Console 的受限 `serpent` API 增加：文件夹/资产分页、元数据读取、路径复制、回收站移入与严格恢复、近期自动色卡聚合、单项重命名和批量重命名。批量重命名用于“按第一个 tag 给某文件夹所有资产改名”这类真实工作流，避免逐项弹原生确认。

真实路径仍不跨过 Main：Worker 将路径仅返回 Main，Main 写入系统剪贴板，脚本只得到数量。永久删除、任意路径读写、网络、Node、数据库和 MCP 写入仍未开放。

## 文件计划边界

- `asset.trash`、`asset.rename-file`、`asset.rename-files` 与 `asset.restore-if-original-vacant` 都是 `file-write` / `plan` policy。
- Main 通过 automation-readonly dispatch 请求 Worker 预检；结果只有目标数量、可执行/阻塞数量、可撤销性和每个资产的 opaque state token。
- Main 显示原生确认后把计划参数、execution、library、变更序号和 token 绑定为 SHA-256 proof。
- Worker 在接触文件系统前验证库 change sequence 和所有 token。任何提交后的库变化都会得到 `VERSION_CONFLICT`，而非对过期计划执行。
- `renameFiles` 是逐项可恢复文件操作：局部的同名、不可用或非法名称记录在 `skipped`，基础设施错误立即失败，不伪装成普通跳过。

## 可追溯验证

| 需求 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 标签筛选后移入回收站 | `quickjs-sandbox-prototype.ts`、`command-registry.ts`、`library-service.ts` | `quickjs-sandbox-prototype.test.ts`、`trash-relink.test.ts` | 待 AUT-006 人工确认原生计划对话框与回收站结果 |
| 手动评分筛选后复制路径 | `command-registry.ts`、`main/index.ts` | `automation-command-gateway.test.ts` 验证脚本永不得到路径 | 待 AUT-006 人工确认系统剪贴板 |
| 按文件夹第一个 tag 批量重命名 | `automation-file-plan-approval.ts`、`library-service.ts` | `automation-file-plan-approval.test.ts`、`asset-rename.test.ts` | 待 AUT-006 人工确认批量确认与冲突提示 |
| 近期自动色卡聚合 | `library-service.ts` | `palette-artifact.test.ts` | 待人类以已有自动色卡资源库确认 |
| 喜欢资产批量 5 星 | `command-registry.ts`、既有有界 `asset.rating.set` | `automation-command-gateway.test.ts`、既有 `batch-rating.test.ts` | 默认评分 E2E 已验证同一写路径；喜欢筛选待人类确认 |
| 原路径空闲才恢复 | `library-service.ts` | `trash-relink.test.ts` | 待 AUT-006 人工确认原生计划与跳过原因 |

## 执行记录

- `npm run typecheck`：通过。
- `npx vitest run --config vitest.config.ts tests/unit/script-sandbox-preview-controller.test.ts tests/unit/automation-command-gateway.test.ts tests/unit/automation-file-plan-approval.test.ts tests/unit/quickjs-sandbox-prototype.test.ts tests/unit/automation-script-ipc.test.ts`：51 tests 通过。
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/automation-readonly-command-executor.test.ts tests/worker/asset-rename.test.ts tests/worker/trash-relink.test.ts tests/worker/palette-artifact.test.ts`：100 passed、1 skipped。
- `node scripts/run-e2e.mjs tests/e2e/automation-script-file-operations.test.ts`：通过；隔离 Electron 以测试专用确认开关执行 Console 批量改名，检查脚本结果不含临时库路径且卡片名称更新。

尚未声称 Computer Use 或人类验收通过；产品负责人仍须执行 AUT-006，真实确认/取消、剪贴板、回收站恢复、色卡与视觉状态都需要人类确认。
