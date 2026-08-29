# Serpent-verg 数据兼容性项目级保障 — 开发日志（2026-08-08）

> 关联：0031 实施规格、ADR-0028、CLAUDE.md「数据兼容性纪律」、工单 Serpent-verg.1~verg.8

## 目标

产品负责人要求（2026-08-07）：**任何版本都必须完全兼容旧版本数据**——新代码打开旧库自动无损迁移、升级后全功能可用是硬目标；只读降级只是兜底。0031 设计稿 v3 定方向：主防线 = 宽容读取（结构容错）+ 迁移无损；鲁棒性 = 迁移失败可诊断可恢复。

## 交付（13 个提交）

### 1. 宽容读取基建（verg.1，`793b93e`）

- `src/worker/lenient-columns.ts`：per-connection 列探测缓存（`columnsFor`/`selectColumns`/`missingColumns`/`hasTable`/`qualify`）+ 降级默认值注册表（`DEGRADED_COLUMN_DEFAULTS`/`degradedDefaults`）+ `invalidateColumnProbe`（迁移后失效）
- 测试 `lenient-columns.test.ts` 9/9（缺列/多列/缓存命中/迁移后失效/连接隔离/表缺失/降级默认值）

### 2. 核心读路径接入（verg.2，`3b1a538` + `cb1f385` + `9226dd9` + `93523c1`）

| 路径 | 改造 |
|---|---|
| 打开路径 | backfillTrashedFromTombstoneIds / reconcileMissingArtifactFiles / availableAutoRepairComponents / enqueueThumbnailJobs / requeueRetryableFailedArtifacts / syncGitignore 缺表/缺列跳过；迁移后列缓存失效 |
| listAssets（浏览） | SELECT/JOIN 白名单化，缺列降级默认值 |
| searchAssets（搜索） | 列白名单 + 可选表条件化 + trigram 门控表存在性 + 无索引库降级文件名搜索 + 排序缺列降级 + **修复既有 ORDER BY 裸数字 '99' 崩溃** |
| getPreviewArtifact | getCurrentArtifact 列白名单，表/列缺失降级 null |
| Inspector | listTags / listCollections / listSmartCollections / getAssetMetadata / getAiContent + collectionRecursiveAssetCounts / resolvedPaletteFields / thumbnailArtifactMap / withImageSequenceSummaries / explicitIgnoreSql 表防护 |

### 3. 结构变异矩阵（verg.3，`67b5a53`）

8 表 × 3 变异（删列/加列/改列名）→ 浏览/搜索/预览 + 表专属读路径不崩且降级正确（27/27）。矩阵暴露并修复 2 个未防护读取器。

### 4. 迁移原子性（verg.4，`2a3d1d6`）

静态审计（版本连续/无显式事务控制）+ 逐版本重放 v1..v32 全部可干净迁移 + v23+ 外层事务失败注入（版本不变/无残留/可重试）。导出 MIGRATIONS/SUPPORTED_SCHEMA_VERSION 供 fixture 使用。

### 5. 迁移失败诊断（verg.5，`edfc11e`）

- `src/worker/schema-failure.ts`：`.serpent/migration-failed.json` 记录（from/to/error/attempts/构建版本）+ MAX=3 上限 + 成功清除
- 粘滞（3 次同源失败）→ 只读降级打开 + `library.migration-stuck` 诊断 + `migrationStuck` summary 标记
- verifyMigrationHistory 损坏保持 LIBRARY_CORRUPT 不记录
- 新错误码 LIBRARY_MIGRATION_FAILED / LIBRARY_MIGRATION_STUCK（en+zh-CN）

### 6. 全版本链（verg.6，`a76d2e6`）

- `tests/fixtures/schema/schema-regress.ts`：反向 DDL 回绕器（newest-first，重建表保护不毁数据）
- 升级链 v1..v32 种子数据（资产/修订/标签/合集/元数据，列探测插入）迁移无损（32 用例）
- 降级链 v33 种子回绕到关键版本（v4/v21/v22/v23/v24/v25/v26/v27/v29/v32/v33）宽容读取+升级无损（11 用例）

### 7. 迁移纪律静态门禁（verg.7，`8faff85`）

- `migration-discipline.test.ts`：禁 DROP/ALTER/RENAME 现有结构、新增列可空/带默认；重建例外清单与 worker FK 保护集合 lockstep 断言
- **审计发现并修复**：worker `rebuildsTable` FK 保护列表缺失 v10/v16/v18/v21/v25/v30/v33 七个重建迁移——已与真实重建集合对齐（`TABLE_REBUILD_MIGRATION_VERSIONS`）；v15 历史删除例外单独登记
- development-process 增加静态门禁清单

### 8. 错误码/UI/文档收口（verg.8，`d5b5df5`）

- LIBRARY_STRUCTURE_MISMATCH（en+zh-CN）+ SQLite `no such column` 写失败映射
- renderer 只读 banner 区分「迁移粘滞」与「新版 schema」（migrationStuck 透传）
- ADR-0028 补充 verg 实施记录

## 代码审查（2026-08-08，opus，固定点 9bc59f6）

审查发现 6 项有效问题，本批次已修复：

1. **🔴 粘滞闩锁无恢复路径**（最严重）：stuck 检查只比对库版本——升级新版后闩锁仍生效，迁移永不重试。修复：记录构建版本（`supportedSchemaVersion`），stuck 条件加版本匹配——升级后自动解锁重试。测试：`an upgraded build retries a stuck library`。
2. **🟠 文件夹面板未接入宽容读取**：managedFolderCountMaps / folderCoverArtifactMap / explicitFolderIgnored / syncGitignore 引用 v9/v24/v26 对象——旧库上文件夹面板崩溃。修复：4 处表/列防护 + `lenient-folder-panel.test.ts` 2/2。
3. **🟠 门禁 lockstep 无约束**：worker 导出 `TABLE_REBUILD_MIGRATION_VERSIONS`，测试断言与静态门禁集合一致；v15 拆为独立历史例外集合。
4. **🟡 LIBRARY_STRUCTURE_MISMATCH 零测试**：补 `public-error.test.ts` 2 例（映射 + 无关错误保持通用）。
5. **🟡 degradedFill 重复且与注册表脱节**：listAssets/searchAssets 改用 `degradedDefaults` + `missingColumns`（消除手写漂移）。
6. **🟡 toVersion 硬编码 0**：改记录 SUPPORTED_SCHEMA_VERSION（迁移目标版本）。

审查判断为不准确而未采纳：degradedFill 与注册表"byte_size 漂移"断言（注册表本就声明 0，一致）；STUCK 码"死代码"（banner 文案已覆盖用户提示）。

## 测试规模

新增约 150 用例：lenient 系列（columns 9 / listassets 3 / searchassets 3 / preview 3 / inspector 5 / folder-panel 2）+ 变异矩阵 27 + 原子性 37 + 失败诊断 7 + 全版本链 43 + 纪律门禁 7 + public-error 2。全绿（迁移套件 124/124，审查修复后回归 111/111）。

## 遗留（后续增强，非门禁）

- 0031 §3.2 全量数据种子（视频/音频/3D/文本/RAW、trash、AI 标签、嵌套合集、智能合集、搜索索引、文件夹树、忽略规则、artifact）与 §3.3 智能合集条件/FTS 结果集断言——当前种子为核心子集
- 失败注入覆盖度：目前 v23+ 外层事务 + v4 代表用例，未逐迁移注入
- 既有测试失败 Serpent-mwk1（derived-artifact-repair 2 + thumbnails 3）待排查
