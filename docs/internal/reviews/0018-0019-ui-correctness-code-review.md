# 0018–0019 双轴代码审查 — Label 退役与产品正确性

> 固定基点：`3400d2b1dce2b905344988829885fb16576ce2a1`
> 审查范围：`3400d2b1dce2b905344988829885fb16576ce2a1...5b8b8fe`。
> 方法：Standards 与 Spec 两个独立审查任务并行检查同一暂存 diff，主 agent 复核并修复发现。

## Standards 轴

| 严重度 | 发现 | 处理 |
|---|---|---|
| P1 | QA 报告缺被测分支、SHA、构建环境/产物与真实测试结果，不能用“见提交说明”代替仓库证据。 | 已补齐并固定实现提交 `5b8b8fe`。 |
| P2 | 开发日志缺规格、分支、基线、状态流、失败根因、已知问题和文件入口，且验证状态过期。 | 已按 `docs/internal/development-process.md` 重写并与 QA/审查互链。 |
| P2 | `App.tsx` 两个异步元数据入口重复维护缓存、冲突集合和编辑状态，后续容易产生身份门禁分叉。 | 提取 `applyLoadedMetadata`，统一使用选中资产 ID 门禁。 |

架构复核：v14 数据迁移仍由 Library Worker 独占 SQLite；Renderer 没有获得 SQL/任意文件能力；跨进程 schema 继续由 Zod 约束。未发现 P0 或新的架构越界。

## Spec 轴

| 严重度 | 发现 | 处理 |
|---|---|---|
| P1 | `listTags` 只统计 `human_asset_tags`，AI-only 标签会被误判为零使用并从建议隐藏。 | 改为人工/AI 关系 `UNION`；同资产只计一次，新增 Worker 集成测试。 |
| P2 | 空输入候选来自 `listTags ORDER BY name`，实际是字母顺序，不符合“最近标签”。 | 利用现有 `created_at` 按最近创建倒序；产品/QA 明确称为“最近添加”，严格最近使用留待后续模型。 |

规格复核确认：Label 从数据库、FTS、协议、AI 和 Renderer 贯穿退役；Inspector 预览比例、标签交互、横向优先瀑布流、框选焦点和菜单高亮均有对应测试或人类证据，没有发现未经确认的范围扩张。

## 修复后复审

- Standards：无未关闭 P0/P1/P2；文档已固定准确实现 SHA。
- Spec：无未关闭 P0/P1/P2；“最近使用”没有冒充已实现，明确保留为后续需求。
- 平台保留项不属于代码审查通过：Windows、packaged app、最终提交集中 E2E 仍按 QA 报告追踪。
