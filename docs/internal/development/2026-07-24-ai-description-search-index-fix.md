# AI 简介搜索索引修复

> 工单：`Serpent-3cz9`
> 状态：人类验收通过
> 日期：2026-07-24

## 问题与根因

用户报告资产 `7b35aeea1ab81788429174b37953b596286dfee612f4df-kQEWbF_fw658webp.webp`
的可见 AI 简介包含「鼓机」，但普通搜索无法命中。只读核对确认该文本保存在
`ai_content`，而 `asset_metadata.description` 与 `asset_search_index.description` 均为空。

`writeAiAnalysisResult` 在写入后调用了搜索索引同步，但同步与 v18 索引回填只读取
人工 `asset_metadata.description`，遗漏了独立的 AI 内容层。因此人工简介可搜索、AI
简介却不可搜索。

## 实现决定

- `description` 搜索字段合并人工与 AI 简介；这只影响检索，不改变 UI 的人工优先显示规则。
- 新增 schema v19：清空并按当前规范重建已有 `asset_search_index`，不重新调用 AI。
- 日常单资产同步使用按 `asset_id` 的 AI 内容子查询；全库迁移回填才进行一次聚合，避免
  每次 AI 完成扫描整张 AI 内容表。

## 验证范围

- 新 AI 简介包含「鼓机」时可以搜索到对应资产；清空 AI 简介后不再命中。
- 从旧 schema 迁移后，既有 AI 简介也会进入搜索索引。
- 人工简介与 AI 简介均可保留在同一检索字段中。

执行记录：

- 在 v20 回收站迁移进入共享工作区前，`node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/ai-analysis.test.ts tests/worker/library-service.test.ts --reporter=dot`：45 passed。
- 当前工作区的「AI 简介索引」定向回归：1 passed。v13 历史迁移测试目前被并行加入的 v20 迁移夹具阻断：夹具仅降低 schema 版本却未移除 v20 新增列，重新打开时 v20 重复 `ALTER TABLE`；与本次 AI 描述索引无关，未在此范围修补。
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/search.test.ts -t "CJK tokenization|contextual substring search|schema v5->v6 migration" --reporter=dot`：10 passed，69 skipped。
- `npm run typecheck`：通过。

`tests/worker/search.test.ts` 全文件当前另有 6 条 FTS5 查询字符串断言失败；它们与 AI
简介索引无关，未在本修复范围内改动。

2026-07-24：产品负责人已在真实资源库中确认验收通过。
