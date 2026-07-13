# 第0005垂直切片：搜索、过滤、排序与智能合集

> 状态：功能实现完成（含 AI 查询转换）；完整平台与人工 QA 待收口
> 日期：2026-07-13

## 目标

让用户在已打开的资源库中对资产执行加权关键词搜索、结构化过滤和多字段排序，并将搜索/过滤/排序组合保存为智能合集；搜索结果支持分页，首屏在 1 秒内返回。搜索、过滤和排序是三个独立的用户动作，分别建模（ADR-0009）；智能合集保存查询定义而非资产副本。

## 用户主线

1. 在搜索框输入关键词，资产列表实时过滤并按相关性降序排列；命中片段高亮。
2. 在过滤面板选择标签、文件格式、评分、喜欢状态等条件（字段间 AND，同字段多值 OR，单条件可切换排除），结果取交集。
3. 选择排序字段（名称、修改时间、添加时间、文件大小、时长、评分）和方向，列表重排。
4. 将当前搜索、过滤和排序条件保存为智能合集；智能合集出现在侧边栏合集区域。
5. 点击智能合集，按保存的条件重新执行查询，结果随资产和元信息变化自动更新。
6. 编辑或删除智能合集；删除只移除定义，不删除资产。

## 范围

### 包含

- schema v5→v6 migration：保留 migration checksum 审计，重建 FTS 索引。
- `asset_search_content` 内容表 + `asset_search` FTS5 external-content 虚表 + AFTER 触发器组（INSERT/DELETE/UPDATE）。
- bm25() 逐列加权排序：Label 12、文件名 10、标签 8、描述 5、源链接 3、文件夹路径 2、其他元信息 1（ADR-0019 基线）。
- 中文 Label、描述、标签在入库 FTS 前经应用层分词为空格分隔 token 串；unicode61 tokenizer，不依赖 ICU 扩展。
- 关键词搜索覆盖全部可索引字段；支持字段限定（`label:PBR`）、多 token AND（隐式）、同字段 OR（显式）、排除 NOT。
- `ORDER BY rank ASC` 隐藏列优化：`snippet()` 等辅助函数延迟到 LIMIT 后求值。
- 结构化过滤：文件格式、标签、评分、喜欢、源链接、可用性（字段间 AND；同字段多值 OR；单条件可切换排除）。
- 排序：名称、修改时间、添加时间、文件大小、时长、评分（均为升/降序）。
- `smart_collections` 表：保存结构化查询 JSON 与排序定义；执行时重新查询当前数据库状态。
- 智能合集 CRUD 与执行；同一资源库内名称唯一。
- 分页：`LIMIT + OFFSET`，首屏默认 50 项。
- FTS 查询构造器（TypeScript）：`SearchClause[]` → 安全 FTS5 MATCH 表达式字符串，整个表达式作为一个 `?` 绑参传入 `WHERE asset_search MATCH ?`，不拼接 SQL。
- 在 Worker 单连接模型内同步执行搜索（事务内不跨 `await`），复用现有 `better-sqlite3` Database 实例。
- Renderer 只发语义请求，不接收绝对路径、文件系统能力或数据库能力；Worker 是数据库和 FTS 索引唯一所有者。
- 单元与 Worker 集成测试；10 万资产规模搜索性能基准测试。
- 搜索框 AI 模式：Main 使用现有 BYOK 配置，将自然语言交给 OpenAI / Gemini / Anthropic
  的结构化输出接口；输出必须通过受限的关键词、同义词、排除词、现有 FilterClause 与
  SortDefinition schema，再由 Worker 的普通参数化搜索执行。供应商不能接触数据库、SQL
  或文件系统路径。

### 不包含

- 向量/语义搜索、视觉相似搜索（ADR-0011 决定 MVP 不使用 embedding）。
- 任意嵌套 AND/OR 条件组（MVP 仅一层 flat clauses）。
- 动态权重：时间衰减、文件夹深度衰减、用户行为反馈调整（后续通过 FTS5 custom auxiliary function 升级）。
- `rank + rowid` 游标深分页（首版 `LIMIT + OFFSET`；出现瓶颈后再改）。
- 保存搜索历史或最近使用过滤条件。
- 跨资源库联合搜索。
- 分辨率、长宽比、时长的实际值来源（需切片 0006 提取的技术元信息填充；过滤基础设施与空结果行为本切片定义）。
- 颜色排序（需切片 0006 自动色卡）。
- 上传用户排序（MVP 无用户身份系统）。

## schema v6

```text
asset_search_content
  asset_id TEXT UNIQUE NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  filename TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  folder_path TEXT NOT NULL DEFAULT '',
  metadata_text TEXT NOT NULL DEFAULT ''
-- 无显式 INTEGER PRIMARY KEY；SQLite 生成隐式 rowid。
-- FTS5 content_rowid 默认对齐 content table 隐式 rowid，无需显式指定。

CREATE VIRTUAL TABLE asset_search USING fts5(
  label,            -- 列 0  权重 12
  filename,         -- 列 1  权重 10
  tags,             -- 列 2  权重  8
  description,      -- 列 3  权重  5
  source_url,       -- 列 4  权重  3
  folder_path,      -- 列 5  权重  2
  metadata_text,    -- 列 6  权重  1
  content='asset_search_content'
);

smart_collections
  collection_id TEXT PRIMARY KEY,
  library_id TEXT NOT NULL REFERENCES library(library_id),
  name TEXT NOT NULL,
  query_definition_json TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
```

不变量：

- `asset_search_content` 每项资产至多一行。行随资产创建（导入/链接）、元数据变更和标签关系变更由 Worker 在对应写入路径中维护；FTS5 AFTER 触发器自动同步虚表索引。
- FTS5 触发器组：
  - **INSERT**：`INSERT INTO asset_search(rowid, label, ...) VALUES (new.rowid, new.label, ...)`。
  - **DELETE**：必须使用 `'delete'` 特殊命令传递 OLD 值（`INSERT INTO asset_search(asset_search, rowid, label, ...) VALUES('delete', old.rowid, old.label, ...)`），禁止使用 `DELETE FROM asset_search WHERE rowid=...`——后者在内容表已更新时删除错误 token（经 SQLite Forum 反复确认的陷阱）。
  - **UPDATE**：先 `'delete'` 旧 row，再 INSERT 新 row（两条语句在同一事务内）。
- `metadata_text` 内容：文件扩展名（从 `relative_file_path` 提取）、文件大小区间标签（`"small"` < 1 MB、`"medium"` 1–10 MB、`"large"` 10–100 MB、`"xlarge"` > 100 MB）、可用性文本（`"available"` 或 `"missing"`）；后续切片提取的格式专有元信息追加至此列。
- 中文 Label、描述、标签在写入 `asset_search_content` 前由应用层（TypeScript）分词为空格分隔 token 串后存储；unicode61 tokenizer 原生处理 ASCII/Unicode 混合，无需编译 ICU 扩展或自定义 tokenizer。
- `smart_collections` 同一资源库内 `(library_id, name)` 唯一。
- `query_definition_json` 是 Worker 校验的结构化 JSON，包含 `search`（可选）、`filters`（FilterClause[]）和 `sort`（SortDefinition）；不存拼接 SQL、不引用绝对路径。智能合集执行时始终重新查询当前数据库，不缓存成员列表。
- schema migration v5→v6 在创建 FTS 虚表及触发器后执行 `INSERT INTO asset_search(asset_search) VALUES('rebuild')` 为已有资产建立初始索引。
- `db.pragma('trusted_schema = ON')` 在打开资源库时执行，确保触发器中对 FTS5 虚表的写入不被拒绝。

## 协议

### Renderer 语义请求

Renderer 只发起以下请求；不传输绝对路径、SQL 片段或数据库能力：

```text
AssetSearch {
  libraryId, query?, filters?, sort?,
  limit?: number (default 50), offset?: number (default 0)
}
SaveSmartCollection   { libraryId, name, queryDefinition }
UpdateSmartCollection { libraryId, collectionId, name?, queryDefinition? }
DeleteSmartCollection { libraryId, collectionId }
ListSmartCollections  { libraryId }
ExecuteSmartCollection{ libraryId, collectionId }
```

Main 将 `AssetSearch` 直转为 Worker 内部命令（无需额外路径选择对话框）。其他请求均为简单 CRUD 转发。

### 搜索查询定义

`query` 和 `queryDefinition.search` 共享同一结构：

```typescript
interface SearchClause {
  field: string | null;    // null = 不限字段；否则为 fts5 列名
  values: string[];        // 同字段多值 → FTS5 OR
  exclude: boolean;        // true → FTS5 NOT 前缀
}

type FilterClause =
  | {
      field: 'format' | 'tag' | 'rating' | 'favorite' | 'source_url' | 'availability';
      values: string[];        // 同字段多值 → OR
      exclude: boolean;
    }
  | {
      field: 'width' | 'height' | 'aspect_ratio' | 'duration_ms';
      ranges: Array<{ min?: number; max?: number }>;
      exclude: boolean;        // ranges 内 OR；与其他 FilterClause 之间 AND
    };

interface SortDefinition {
  field: 'name' | 'modified_at' | 'created_at' | 'byte_size' | 'duration' | 'rating';
  order: 'asc' | 'desc';
}
```

数值过滤边界通过 Zod 校验后作为 SQLite bind 参数传递，不接受字符串形式的比较表达式。
正向数值过滤不匹配尚未提取技术元数据（`NULL`）的资产；排除数值范围时保留这些资产，
避免 SQL 三值逻辑把“未知”误判为“属于被排除范围”。`duration_ms` 明确使用毫秒，Renderer
展示和输入时负责与人类可读时长/秒互转。

### Worker 内部命令

```text
asset.search            { libraryId, query?, filters?, sort?, limit, offset }
smart-collection.create { libraryId, name, queryDefinition }
smart-collection.update { libraryId, collectionId, name?, queryDefinition? }
smart-collection.delete { libraryId, collectionId }
smart-collection.list   { libraryId }
smart-collection.execute{ libraryId, collectionId }
```

### 响应

新增以下成功结果类型，加入现有 `WorkerResult`/`RendererResult` 的 discriminated union：

```text
asset.search.result {
  items: AssetSummary[],
  total: number,
  offset: number,
  snippets?: { assetId: string; text: string }[]
}
smart-collection.created  { collectionId, name }
smart-collection.updated  { collectionId }
smart-collection.deleted  { collectionId }
smart-collection.list     { collections: SmartCollectionSummary[] }
smart-collection.executed {
  items: AssetSummary[],
  total: number,
  offset: number
}
```

`SmartCollectionSummary`：`{ collectionId, name, queryDefinition, position }`。`queryDefinition` 不包含绝对路径，Renderer 安全展示。

### 查询执行流程概览

1. Worker 解析 `query?.clauses`，调用 `buildFts5Query()` 生成安全 MATCH 表达式字符串。
2. 如存在 `filters`，构建额外的 SQL WHERE 条件（字段间 AND，同字段多值 OR/排除通过 `IN`/`NOT IN` 等标准 SQL 表达）。
3. 构建最终 SQL：`SELECT a.* FROM assets a JOIN asset_search_content sc ON a.asset_id = sc.asset_id JOIN asset_search s ON sc.rowid = s.rowid WHERE asset_search MATCH ? [AND filter条件] ORDER BY bm25(asset_search, 12.0, 10.0, 8.0, 5.0, 3.0, 2.0, 1.0) ASC LIMIT ? OFFSET ?`。
4. 整个 MATCH 表达式、limit、offset 作为绑参传入 `db.prepare().all()`。
5. 如需 snippet，通过独立 `snippet()` 查询仅对返回的 LIMIT 行获取（利用 FTS5 延迟求值优化）。

## 测试接缝

- schema v5→v6 migration、重复打开幂等、migration checksum 篡改审计、`rebuild` 后已有资产可搜。
- FTS5 触发器一致性（通过 `db.pragma('integrity_check')` 和具体 token 验证）：
  - INSERT 新资产→`asset_search` 包含对应 token。
  - UPDATE 标签/描述→旧 token 移除、新 token 新增，无旧 token 泄漏。
  - DELETE 资产→`asset_search` 对应行移除；CASCADE 同时清理 `asset_search_content` 行。
  - 分别验证 `'delete'` 命令与误用 `DELETE FROM asset_search WHERE rowid=...` 的差异（后者在内容表已更新时删除错误 token）。
- 中文分词：Label 为"角色概念设计"→入库 token 为"角色 概念 设计"→搜索"概念"命中、搜索"角色概念"也命中（分词后子串匹配）。
- bm25 权重排序：同关键词命中 Label 的资产排在命中文件名的资产之前；命中描述的在更后。
- 关键词搜索组合：单 token、多 token AND（空格）、字段限定（`label:机甲`）、排除（`NOT tags:草图`）、组合（`label:PBR (tags:角色 OR tags:道具) NOT folder_path:archive`）。
- FTS5 查询注入免疫：恶意输入（`" OR 1=1 --`、`*`、超长字符串、特殊字符）不逃逸出 MATCH 表达式，最多返回空结果。
- 结构化过滤：多格式 OR、格式 AND 标签取交集、排除标签、空过滤条件=不附加 WHERE、不兼容值组合返回空结果。
- 排序：各字段升序/降序，NULL 排序位置稳定（rating 未评分=0、duration 未提取=NULL排最后）。
- 分页：首屏 LIMIT、第二页 OFFSET、边界（空结果 total=0、offset 超界返回空 items）、total 在过滤/搜索后正确计数。
- 智能合集：保存/更新/删除/执行/列表；同名冲突拒绝；queryDefinition JSON 格式错误拒绝；执行后 items 随元数据变更而不同。
- 智能合集执行路径复用搜索+过滤+排序代码路径（通过共享 query builder 和 SQL 构造器验证）。
- Renderer 不能提交 SQL、绝对路径或数据库能力；queryDefinition JSON 不暴露内部存储路径。
- 性能基准：10 万资产 FTS5 索引下关键词搜索首屏（50 项）< 1s；过滤+排序组合查询首屏 < 1s；使用 WAL 模式读不阻塞并发导入写入。
- `ORDER BY rank` 与 `snippet()` 延迟求值验证：通过计时确认 snippet 只在 LIMIT 行上求值（非全部匹配行）。
- 错误可观测性：搜索语法错误返回安全错误信息（不暴露内部 SQL），完整错误链写入应用日志。

## 完成标准

- 全部自动化门禁通过；macOS 打包搜索与智能合集冒烟有明确结果，Windows 保留为显式未验证项。
- FTS5 触发器组进/删/改后索引与内容表无 token 泄漏或不一致（通过 integrity_check + token 抽样验证）。
- 关键词搜索首屏（50 项）在 10 万资产规模下 1 秒内返回。
- 过滤和排序在 1 秒内返回首屏。
- 智能合集保存/执行/删除正确；执行结果随元数据变更自动更新。
- 搜索框不拼接 SQL；整个 MATCH 表达式作为一个 `?` 绑参传入。
- Renderer 不接收绝对路径或数据库能力。
- 开发日志、双轴审查与 QA 报告完整。
