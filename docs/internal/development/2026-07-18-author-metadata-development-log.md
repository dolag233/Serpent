# 2026-07-18 「作者」资产元数据（Serpent-7x0）

## 需求

用户第四批反馈点名新增「作者」元数据字段（映射 Serpent-7x0，P2）。范围：

1. schema 新增 `author` 字段，可人工编辑，跨完整重启持久化。
2. 支持按作者排序；筛选按可选/低成本处理，不做分组模式（分组模式属于 P4 Serpent-84m，本次不实现）。
3. 图片首次生成缩略图时，若作者为空，尽力从 EXIF/IPTC/XMP 自动提取创作者信息回填，不覆盖用户已填写或已提取过的值。
4. 中英文 i18n。

## 实现

### 数据层（schema v14 → v15）

- `src/worker/library-service.ts`：新增迁移 `AUTHOR_METADATA_SCHEMA_SQL`（v15）：
  - `ALTER TABLE asset_metadata ADD COLUMN author TEXT`（就地加列，沿用仓库既有 `ALTER TABLE` 惯例，无需重建表/触发 FK 检查）。
  - FTS5 虚拟表 `asset_search` 的 content table 无法就地加列，因此按 v14 退役 `label` 时的既定模式整体重建：`DROP TABLE asset_search` → `ALTER TABLE asset_search_index ADD COLUMN author` → 重新 `CREATE VIRTUAL TABLE asset_search USING fts5(...)`（新增 `author` 列）→ 重建 `_ai`/`_ad`/`_au` 三个触发器 → `INSERT INTO asset_search(asset_search) VALUES('rebuild')`。
  - `SUPPORTED_SCHEMA_VERSION` 通过 `MIGRATIONS.at(-1)!.version` 自动跟随数组末项，新增一行即生效（v15）。
- `bm25` 排名权重：`author` 权重设为 `3.0`，与 `source_url` 同级（低于 `filename`/`tags`/`description`，高于路径/元数据文本），两处调用点（`searchAssets` 主查询与 total 计数子查询）同步更新。

### 类型/协议层

- `src/shared/asset-types.ts`：`assetMetadataResultSchema` 新增 `author: nonBlankString.nullable()`；`sortDefinitionSchema.field` 与 `searchClauseSchema.field` 枚举新增 `'author'`。
- `src/shared/protocol/requests.ts`：新增 `assetAuthorSchema`（镜像 `sourcePageUrlSchema` 的“空字符串=清空”契约，去掉 URL 形状约束，改为 `nonBlankString.max(255)` + 禁止首尾空白）；`asset.metadata.set.request` / `asset.metadata.set` 均新增 `author: assetAuthorSchema.optional()`。
- `src/shared/library-api.ts` / `src/preload/index.ts`：`setAssetMetadata` 入参新增 `author?: string`；`searchAssets` 的 `sort.field` 联合类型新增 `'author'`（这两个文件各自维护一份独立字面量联合类型，未复用 `SortDefinition`，需要单独加，typecheck 才发现遗漏）。
- `src/main/index.ts`：`asset.metadata.set.request` → `asset.metadata.set` 命令映射新增 `author: request.author` 透传。

### Worker CRUD

- `getAssetMetadata`：`SELECT` 与返回体新增 `author`。
- `setAssetMetadata`：新增 `author?: string` 入参；用 `assetAuthorSchema.safeParse` 校验；`UPDATE`/`INSERT` 语句新增该列；空字符串规整为 `null`，未传入时保留旧值（乐观锁模式与既有字段一致，`expectedVersion` 冲突检测不变）。
- `backfillAssetMetadata` 与 `setAssetsRating` 的 upsert 语句：新增行时 `author` 显式写 `NULL`（新建行时其余字段的既定模式）。
- `syncAssetSearchContent`：`SELECT` 增加 `m.author`；写入 `asset_search_index` 时用 `tokenizeForFts` 对 `author` 分词，与 `description`/`source_url` 一致。
- `search-query.ts`：`FTS5_COLUMNS` 新增 `'author'`，供查询解析器识别显式字段查询（如 `author:某人`）。
- 排序：`searchAssets` 的 `orderBy` 新增 `case 'author'`：`COALESCE(m.author, '') = '' ASC, COALESCE(m.author, '') COLLATE NOCASE ${dir}, a.asset_id ASC` —— 空值永远排最后（首个子句固定 `ASC`，不随 `dir` 翻转），非空值按大小写不敏感的 `dir` 排序，`asset_id` 兜底稳定排序。

### EXIF/IPTC/XMP 自动提取

- 新增 `src/worker/author-from-exif.ts`：
  - 依赖 `exifr`（`npm install exifr`；`vite.worker.config.ts` 的 `rollupOptions.external` 新增 `'exifr'`，因其内部有环境探测代码，打包进 worker bundle 会在解析阶段报错，需保持为外部依赖，运行时按 CJS `require` 加载）。
  - `extractAuthorFromExif(absoluteFilePath, parser?)`：对 `exifr.parse` 输出按优先级取值——`creator`/`Creator`（XMP `dc:creator`，现代创作工具导出时的权威字段）→ `Byline`/`By-line`（IPTC，早于 XMP 出现）→ `Artist`（EXIF 遗留字段，历史最久、语义最不明确，故放最低优先级）；数组值（XMP 多值字段）取首个非空项；结果 trim 并截断到 255 字符（对齐 `assetAuthorSchema` 上限）。
  - 解析失败、文件不存在或没有任何候选字段时返回 `null`，不抛出（尽力而为，绝不阻塞缩略图生成）。
- `library-service.ts` 新增私有方法 `backfillAuthorFromExif(assetId, absoluteFilePath)`：调用提取函数，若拿到非空作者，用 `INSERT ... ON CONFLICT(asset_id) DO UPDATE SET author = excluded.author WHERE asset_metadata.author IS NULL OR asset_metadata.author = ''` 写入——`WHERE` 子句保证绝不覆盖用户已编辑或此前已提取过的非空值；不递增 `entity_version`（镜像 `setAssetsRating` 批量写入的既定模式，避免仅因后台增强触发客户端乐观锁的“版本已变”提示）。
- 调用点：`generateImageThumbnail` 在缩略图 artifact 写入之后、`onAssetsChanged` 通知之前调用 `backfillAuthorFromExif`（`await`，失败仅记录诊断日志 `metadata.author-exif-extract`，不影响缩略图流程）。视频路径未接入自动提取（`exifr` 面向图片容器，视频不做同等处理，符合“best-effort，跳过视频”的范围约定）。

### 渲染层

- `src/renderer/inspector-multi-edit.ts`：`InspectorMultiEditModel`/`MultiEditMetadataSlice` 新增 `author` 标量字段；`buildInspectorMultiEdit`/`toMultiEditSlice` 按既有「值相同可编辑，不同显示多个值」模型纳入 `author`。
- `src/renderer/InspectorPanel.tsx`：在描述与源链接之间新增作者输入框（单选可编辑；多选值不同时禁用并提示多个值），复用源链接字段的既有交互结构与样式。
- `src/renderer/App.tsx`：新增 `editAuthor` state、`handleAuthorInput`/`handleAuthorSave`（单选与多选选择合并保存路径，镜像既有 `editSourceUrl`/`handleSourceUrlSave` 实现）；`applyLoadedMetadata`/`rebuildMultiEditFromCache`/`syncEditorsFromMultiEdit` 同步纳入 `author`。
- `src/renderer/SortModeControl.tsx`：`SECONDARY_SORT_FIELDS` 新增 `'author'`；`labelForSortField` 新增对应的本地化标签分支。

### i18n

- `en.ts` / `zh-CN.ts`：`filter.sortAuthor`（"Author" / "作者"）、`inspector.author`（同上）、`inspector.authorPlaceholder`（"Enter author…" / "输入作者…"）。

## 验证

| 命令 | 结果 |
| --- | --- |
| `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker` | 31 files, 616 passed / 1 skipped |
| `npm run test:unit` | 77 files, 731 passed |
| `npx vitest run tests/unit/author-from-exif.test.ts` | 14/14（含真实 `exifr` 解析构造的最小 EXIF/IPTC/XMP JPEG fixture，以及优先级/trim/截断/异常路径的 mock 用例） |
| `npm run typecheck` | 通过 |
| `npm run lint` | 通过（仅剩 2 个与本次改动无关的既有问题：`NavigationSidebar.tsx` set-state-in-effect、`library-service.ts` `_storedManualPalette` 未使用变量，均已通过 `git stash` 核实为改动前基线已存在） |

修复的既有测试问题（因新增迁移暴露，非新引入回归）：

- 多处硬编码 `user_version: 14` 断言（`library-service.test.ts`、`linked-folders.test.ts`、`search.test.ts`、`thumbnails.test.ts`、`trash-relink.test.ts`）随 `SUPPORTED_SCHEMA_VERSION` 变为 15 一并更新为 `15`，这些断言语义上是“全量迁移后的当前版本”而非“v14 特有形状”。
- `library-service.test.ts` 的 v13→v14 迁移回归夹具原先只 `DELETE FROM schema_migrations WHERE version = 14`，v15 迁移落库后遗留的 `version = 15` 记录未被清理，导致 `verifyMigrationHistory` 在重新迁移前误判历史不匹配（`LIBRARY_CORRUPT`）。改为 `WHERE version >= 14`，与同文件内 `downgradeLibraryToV1`/`downgradeLibraryToV2` 等既有降级夹具的 `>= N` 模式一致（根因修复，非绕过）。
- `protocol.test.ts` 与 `organization.test.ts` 中直接构造 `assetMetadataResultSchema` 形状的固定数据补充 `author: null`。

## 已知范围外

- 分组/分类模式（先分类再排序，含按作者分组）属于 Serpent-84m（P4，MVP 后），本次未实现，也未在 UI 露出分组入口。
- 按作者过滤（维度过滤条）未实现——用户原始反馈未点名过滤，且当前过滤条已有较多维度，评估为非必需的“低成本附加项”暂缓；后续如有需求可复用 `author` 已入库的 FTS/排序基础设施低成本追加。
- 视频文件的自动提取为空白（无 EXIF 容器可读），符合范围约定，非缺陷。

## 人类验收

新增队列条目 `META-009`（`docs/internal/qa/human-acceptance-checklist.md`），操作步骤含手动编辑/清空、真实 EXIF 自动提取（需要一张来自真实相机或 Photoshop/Lightroom 等工具写入过创作者字段的图片，而非本次单测中构造的最小 JPEG fixture）、多选「多个值」三项。Computer Use 未执行（当前环境无桌面控制能力），移交人工 QA。
