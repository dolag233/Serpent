# 2026-07-18 多选菜单跳过数量与原因报告（REQ-MENU-004 / Serpent-guq）

> 工单：`Serpent-guq`（in_progress）  
> 来源：需求池 REQ-MENU-004；REQ-MENU-007 已覆盖批量执行后的 toast 跳过报告，本增量补齐**菜单打开时**的预览式处理/跳过说明。

## 问题

0014 多选菜单已有混合选择说明，但文案冗长（「移动/复制处理 N 项可用托管资产，跳过…；回收站处理 M 项…」），逻辑内联在 `AssetContextMenu`，且未把回收站状态纳入跳过分桶；资格计算与拖放（排除 `deletedAt`）不完全一致。

## 方案

1. **纯模块** `src/renderer/menu-skip-report.ts`  
   - `buildMultiAssetMenuSkipReport`：按选中 id + 当前范围快照分类  
     - 移动：`managed` + `available` + 非回收站  
     - 回收站：`managed` + 非回收站（含 missing）  
     - 跳过原因码：`linked` / `unavailable` / `trashed` / `unresolved`  
   - `formatMenuActionSkipLine` / `formatMultiAssetMenuSkipFooter`：简洁页脚  
     - 例：`移动：将处理 3 / 跳过 2（回收站）`  
     - 两项都有跳过时用 `；` 拼接移动与回收站行  
   - 全部在回收站时返回 `allTrashed`，页脚为 `null`（走恢复/永久删除分支）

2. **菜单接线** `AssetContextMenu` 多选分支改用模块输出的 process id 与页脚字符串；注册表计数与「将处理」一致。

3. **i18n** en + zh-CN：`menu.skipReport*` / `menu.skipReason*`；移除旧冗长 `moveCopySummary` / `skipLinked` 等键。

## 实现位置

| 需求 | 实现 | 自动化 |
| --- | --- | --- |
| 处理/跳过分桶与原因码 | `menu-skip-report.ts` | `tests/unit/menu-skip-report.test.ts` |
| 简洁页脚文案 | `formatMultiAssetMenuSkipFooter` + catalogs | 同上（zh-CN / en 字面量断言） |
| 菜单接线 | `AssetContextMenu.tsx` | E2E `context-menu` mixed-selection 段 |

## 验证

- `npx vitest run tests/unit/menu-skip-report.test.ts`：10 passed  
- `npx eslint`（改动文件）：0 findings  
- `tsc --noEmit`：仓库内既有 `library-service.ts` smart-collection 错误，与本增量无关  
- E2E：`context-menu` mixed 断言已改为新文案；本回合未集中跑全量 E2E  
- Computer Use：未执行，移交人工 QA（MENU-023）

## 人类验收

- **MENU-023**：多选菜单显示处理/跳过数量与原因（见 `docs/qa/human-acceptance-checklist.md`）  
- **MENU-012**：保留为 0014 总览项，详细步骤指向 MENU-023

## 未提交

按任务要求本回合不创建 git commit。
