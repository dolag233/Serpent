# 0031 实施规格：数据兼容性项目级保障（Serpent-verg）

> 状态：设计稿 v3（2026-08-07）
> 关联：ADR-0028、Serpent-033e、CLAUDE.md「数据兼容性纪律」
> 产品负责人方向（2026-08-07 两轮确认）：
> 1. **不依赖备份**——保障 = 高版本兼容低版本（迁移无损）+ 鲁棒错误恢复；
> 2. **鲁棒性 = 结构容错（宽容读取）**：即使表的列缺少或多出，**直接忽略这些列、读取剩余信息**，不因结构差异直接失败。

## 0. 核心原则

1. **宽容读取（lenient read）优先**：读取路径对结构差异容忍——缺列用默认值/跳过该列、多列忽略——**能读就读，不因结构差异失败**。
2. **迁移无损**：升级不丢不坏（事务原子性 + 全版本链验证）。
3. **失败可恢复**：迁移失败 → 原库无损、可诊断、可重试。
4. **只读降级是最后手段**（ADR-0028）：仅当核心数据确实读不了时才降级。

## 1. 宽容读取（结构容错）——核心新增

### 1.1 语义

| 结构差异 | 读取行为 |
|---|---|
| 表**缺**列（旧库，代码查询的列不存在） | 跳过该列：用默认值（NULL/0/''）填充读取结果；该列功能降级（如缺 `byte_size` → 不显示大小）——**不失败** |
| 表**多**列（新库，代码不认识的列） | 忽略多余列——照常读取 |
| 表**缺**（整体缺失） | 该表对应功能降级（如缺 `collections` → 合集功能不可用提示）——**不崩溃** |
| 索引/触发器缺失 | 按不存在处理（查询仍可用，性能降级） |

### 1.2 落地方式

- **读取查询白名单化**：核心读路径（浏览/搜索/预览/Inspector）的 SQL 改为**显式列白名单**，并在**查询前探测列**（`PRAGMA table_info`，进程内缓存）——探测结果决定实际查询的列集（存在的列才 SELECT/WHERE）。
- **列探测缓存**：`Map<table, Set<column>>`（库打开时构建，迁移后失效重建）。
- **缺列降级映射**：对每个白名单列定义降级默认值（`asset.byte_size` 缺 → null；`asset.display_name` 缺 → 文件名兜底）。
- **容错范围**：**读路径**（browse/list/search/preview/resolution/metadata 读取）。**写路径保持严格**（写入未知结构不做——写的是代码认识的列，缺列时写失败返回明确错误）。
- **实现形态**：集中式 helper（如 `src/worker/lenient-columns.ts`：`selectColumns(connection, table, wanted)` 返回存在的列集），核心查询逐表接入（**优先**：assets/revisions/revision_artifacts/tags/collections/smart_collections/asset_metadata/ai_content——**读路径高频表**）。

### 1.3 与版本门禁的关系

- 版本门禁（`LIBRARY_VERSION_TOO_NEW`）**不再是第一道闸**：先尝试**宽容读取**。
- 仅当宽容读取也无法进行（缺关键表/缺关键列导致核心功能不可用）时，才走**只读降级**（ADR-0028 现有实现）或**明确错误**。
- 写路径：结构差异时返回明确错误（`LIBRARY_STRUCTURE_MISMATCH`，可选码），**不静默写坏**。

## 2. 迁移原子性与错误恢复

### 2.1 迁移原子性

- 审计 `MIGRATIONS`：每个迁移整体在事务内（含表重建 `DROP/ALTER/RENAME` 序列）；失败时回滚到迁移前状态。
- 失败注入测试：对每个迁移注入中途失败 → 断言 `user_version` 未变、无半迁移残留、可再次打开重试。

### 2.2 失败诊断与重试

- 迁移抛错 → 事务回滚（库无损）→ 写 `.serpent/migration-failed.json`（fromVersion/toVersion/error/attemptedAt）。
- 库版本未变 → 下次打开自动重试；同一 from→to 连续失败 **3 次** → 不再自动重试 → **只读降级打开**（宽容读取优先）+ 明确提示。
- 新错误码：`LIBRARY_MIGRATION_FAILED`（已回滚可重试）、`LIBRARY_MIGRATION_STUCK`（连续失败只读打开）。
- `verifyMigrationHistory` 失败（checksum 不匹配）：不重试（历史损坏，保持 LIBRARY_CORRUPT）。

## 3. 全版本链兼容测试

### 3.1 策略

- **升级链**：v1 库（数据种子）→ 逐版本迁移 v33 → 断言完整。
- **降级链**：v33 → 关键版本降级（v4/v21/v22/v23/v24/v25/v26/v27/v29/v32/v33）→ 再升级 → 断言。
- **结构变异测试（宽容读取验证）**：对关键表（assets/revisions/artifacts/tags/collections/metadata/ai_content）**删一列 / 加一列 / 改列名** → 打开库 → **浏览/搜索/预览不崩溃**，能读的数据正确（缺列降级默认值生效）。
- **失败注入测试**（2.1）。

### 3.2 数据种子

资产（图片/视频/音频/3D/文本/RAW）、修订历史、trash、人工+AI 标签、合集（嵌套）、智能合集、元数据（评分/收藏/描述/来源/色彩）、搜索索引、文件夹树、链接文件夹、忽略规则、artifact（缩略图/代理/poster）。

### 3.3 断言矩阵

| 维度 | 断言 |
|---|---|
| 资产/修订 | 数量、ID、字节、时间不变 |
| 标签/合集/智能合集 | 结构 + 关联完整、查询条件保留 |
| 元数据 | 逐项一致 |
| 搜索 | 结果集一致（FTS 可重建） |
| 组织/trash/派生数据 | 完整 |

## 4. 迁移纪律门禁

- development-process 迁移检查清单（只加不改、新列可空、升级无损验证、事务化）。
- `tests/unit/migration-discipline.test.ts`：MIGRATIONS SQL 静态检查（禁 DROP/ALTER 现有结构）。
- 兼容测试纳入 verify:mainline。

## 5. 实施计划（子任务）

| # | 任务 | 产出 |
|---|---|---|
| 1 | 宽容读取基建：列探测缓存 + 降级默认值 helper | `src/worker/lenient-columns.ts` |
| 2 | 核心读路径逐表接入宽容读取（assets/revisions/artifacts/tags/collections/metadata/ai_content） | 各查询模块改造 |
| 3 | 结构变异测试（缺列/多列/改列名 → 读取不崩溃 + 降级正确） | `tests/worker/schema-lenient-read.test.ts` |
| 4 | 迁移原子性审计 + 失败注入测试 | `tests/worker/schema-compatibility.test.ts`（原子性部分）+ 修正 |
| 5 | 迁移失败诊断 + 重试/防死循环 | `src/worker/schema-failure.ts` + 测试 |
| 6 | 全版本降级 fixture + 数据种子 + 升级链断言矩阵 | `tests/fixtures/schema/` + `tests/worker/schema-compatibility.test.ts` |
| 7 | 迁移纪律静态检查 | `tests/unit/migration-discipline.test.ts` |
| 8 | 错误码/UI/文档收口 | errors.ts + i18n + development-process |

## 6. 风险

- **宽容读取改造面广**：核心查询逐表接入——按高频表优先级推进，先覆盖浏览/搜索/预览主链路。
- **缺列降级的语义**：需要为每个白名单列定默认值语义（避免降级后产生误导数据）。
- **写路径边界**：宽容只做读路径；写路径保持严格（结构差异明确报错，不静默写坏）。
- **FTS 索引**：搜索断言容忍重建。
