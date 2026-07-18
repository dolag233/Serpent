# 2026-07-18 智能合集条件校验与侧栏计数（CU-M5/M6 / Serpent-o8v）

> 工单：`Serpent-o8v`（in_progress）  
> 来源：Computer Use 审计 CU-M5 / CU-M6

## 问题

1. **CU-M5**：保存智能合集只校验标题非空；`{}` 或仅排序定义可通过，产出匹配全部资产的「伪智能合集」。
2. **CU-M6**：普通合集侧栏有 `assetCount`，智能合集行无计数，信息不一致。

## 方案

1. **条件校验（共享）** `src/shared/smart-collection-query.ts`  
   - `hasMeaningfulSmartCollectionCondition`：至少一个搜索 clause **或** 过滤 clause；纯 `sort` / 空对象不算。  
   - Renderer：`saveSmartCollection` / `updateSmartCollectionQuery` 先本地拦截并 `toast.smartCollectionNeedsCondition`。  
   - Worker：`createSmartCollection` / 更新 query 时抛 `INVALID_SMART_COLLECTION_QUERY`（协议 + 中英文 error catalog）。

2. **侧栏计数（CU-M6）**  
   - `SmartCollectionSummary.assetCount` 进入 schema / list / create / update 响应。  
   - `listSmartCollections` 内对每项用 `searchAssets(..., limit: 0)` 取 `total`（一次 list RPC，避免 UI N+1）。  
   - 打开智能合集时用 execute 的 `total` 刷新对应侧栏徽章。  
   - `NavigationSidebar` 对智能合集 `NavRow` 传入 `count={sc.assetCount}`。

## 实现位置

| 需求 | 实现 | 自动化 |
| --- | --- | --- |
| 有意义条件判定 | `smart-collection-query.ts` | `tests/unit/smart-collection-query.test.ts` |
| 创建/更新拒绝空条件 | `library-service` create/update | `organization.test.ts` / `search.test.ts` CU-M5 |
| list 含计数 | `listSmartCollections` + schema | worker CU-M6 断言 `assetCount` |
| UI 校验文案 + 侧栏计数 | `App.tsx` / `NavigationSidebar` / i18n | 人类验收 SMART-001 / SMART-006 |

## 验证

- `npm run typecheck`：通过
- 单元：`tests/unit/smart-collection-query.test.ts` — 5 passed
- Worker（Electron vitest）：`organization` + `search` 中 `smart collection` 过滤 — 23 passed
- eslint（本增量相关文件）：`smart-collection-query.ts` / `library-service` 无新增 findings
- Computer Use：未执行，移交人工 QA（SMART-001 / SMART-006）

## 人类验收

- **SMART-001**：无条件保存被拒绝；有搜索或过滤时可保存  
- **SMART-006**：侧栏智能合集显示匹配计数

## 未提交

按任务要求本回合不创建 git commit。
