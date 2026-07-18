# 2026-07-18 合集菜单按成员状态过滤（CU-B4 / Serpent-cnp）

> 工单：`Serpent-cnp`（in_progress）  
> 来源：Computer Use 审计 CU-B4 — 资产右键「加入合集 / 移出合集」恒同时可点。

## 问题

`AssetContextMenu` 对每个合集无条件渲染「加入」与「移出」两项。未加入时仍可点移出（再由 worker/批处理报错或空操作）；已加入时仍可点加入（幂等 INSERT OR IGNORE）。不符合成员状态。

## 方案

1. **纯决策模块** `src/renderer/collection-menu-membership.ts`  
   - `resolveCollectionMembershipState`：选中集相对某合集直接成员 → `all` / `none` / `mixed`  
   - `resolveCollectionMenuActions`：  
     - `all` → 仅移出  
     - `none` → 仅加入  
     - `mixed` → 两项都保留（对齐 REQ-MENU-007 批量跳过报告）  
   - `indexMembershipsByCollection` / `resolveCollectionMenuForSelection` 供菜单接线

2. **成员查询** `collection.assets.memberships`  
   - Worker：`listAssetCollectionMemberships`（按 `asset_id IN (...)` + 合集库作用域）  
   - 协议 / Main 映射 / Preload / `LibraryApi` 全链路  
   - 菜单打开时按选中资产拉取；加载完成前不渲染合集加入/移出行，避免错误可点态闪现

3. **菜单接线**  
   - 单选与多选分支均按上述可见性过滤  
   - 「从当前合集移除」注册表命令仍由 `activeCollectionId` 控制，本增量不改

## 实现位置

| 需求 | 实现 | 自动化 |
| --- | --- | --- |
| 成员状态 → 菜单可见性 | `collection-menu-membership.ts` | `tests/unit/collection-menu-membership.test.ts` |
| 直接成员查询 | `library-service.listAssetCollectionMemberships` + protocol/preload/main | `tests/worker/organization.test.ts`（memberships 断言） |
| 菜单过滤 | `AssetContextMenu.tsx` + `App.tsx` loader | E2E `organization-search-trash` 递归合集段改为断言非成员不显示移出 |

## 验证

- `npm run typecheck`：通过  
- `npx eslint src/renderer/AssetContextMenu.tsx src/renderer/collection-menu-membership.ts`：0 findings  
- 单元：`tests/unit/collection-menu-membership.test.ts` + protocol memberships 请求：72 passed（与 protocol 文件一并）  
- Worker：`organization.test.ts`「adds assets to a collection」（含 memberships 断言）：passed（Electron vitest）  
- E2E：`organization-search-trash` 递归合集段已改写 CU-B4 断言；本回合未集中跑全量 E2E  
- Computer Use：未执行，移交人工 QA（MENU-022）

## 人类验收

- **MENU-022**：合集加入/移出按成员状态过滤（见 `docs/qa/human-acceptance-checklist.md`）

## 未提交

按任务要求本回合不创建 git commit。
