# SQLite FTS5 加权 BM25 列排序调研

> 调研日期：2026-07-13
> 范围：FTS5 bm25() 逐列权重、rank 隐藏列、外部内容表、查询构造器模式、better-sqlite3 支持。
> 来源：SQLite 官方文档、SQLite Forum（Dan Kennedy 等核心开发者回复）、better-sqlite3 源码与编译配置。

## 结论

Serpent 资产搜索采用 **external-content FTS5 表 + bm25() 逐列权重 + `ORDER BY rank` 隐藏列**。FTS5 内置的 `bm25()` 直接支持逐列权重（列创建顺序对齐），在 10 万资产规模的 `LIMIT` 首屏查询中有内置优化路径；`rank` 隐藏列保证 `snippet()` 等辅助函数只在 `LIMIT` 行上求值。`better-sqlite3` 默认启用 `SQLITE_ENABLE_FTS5`，无须额外编译配置。

不与自定义 auxiliary function（C extension）绑定。FTS5 内置 `bm25()` 的 `k1`/`b` 常量虽不可调参，但对加权排序效果而言列权重已足够。若以后需要动态权重（如按文件夹深度、资产年龄衰减），可注册 FTS5 custom auxiliary function，但这不在 MVP 范围内。

## 权重定义与列顺序

bm25() 的列参数按 FTS5 虚拟表列定义顺序对齐。**未索引列（unindexed column）仍占一个位置**，权重参数须包含它的位置——让它取默认值 1.0，或显式传 0.0 均可。

```sql
CREATE VIRTUAL TABLE asset_search USING fts5(
  label,           -- 列 0  权重 12
  filename,        -- 列 1  权重 10
  tags,            -- 列 2  权重  8
  description,     -- 列 3  权重  5
  source_url,      -- 列 4  权重  3
  folder_path,     -- 列 5  权重  2
  metadata_text,   -- 列 6  权重  1
  content='assets',
  content_rowid='asset_id'
);
```

查询排序：

```sql
SELECT a.*
FROM assets a
JOIN asset_search s ON a.asset_id = s.rowid
WHERE asset_search MATCH ?
ORDER BY bm25(asset_search, 12.0, 10.0, 8.0, 5.0, 3.0, 2.0, 1.0) ASC
LIMIT 50;
```

**关键点：** `bm25()` 的第一个参数是 FTS5 虚表名，后面的数字依次对应列 0/1/2/… 的权重。未提供的列默认为 1.0。权重 0.0 等价于不参与评分。

权重值来自 ADR-0009/0019 的基线（Label 12、filename 10、tags 8、description 5、source_url 3、folder 2、metadata 1），可通过基准测试调整。

## 为什么必须用 external-content，不能用 contentless

**contentless 表不能使用 bm25()。** bm25() 需要每列的文档长度（token 总数）来计算 BM25 的长度归一律分量；contentless 表根本不存储原始文本，`Fts5ExtensionApi::xColumnTotalSize()` 返回 0，bm25() 无法产生有效分数。

external-content 表在查询时通过 `content_rowid` 从内容表读取列值，因此 bm25()、`snippet()`、`highlight()` 全部可用。两者在索引存储大小上差异不大，因为索引树本身（token -> posting list）才是空间占大头。

external-content 表需手动维护索引与内容表一致性，通过触发器是最干净的方式。

来源：[SQLite FTS5 External Content Tables](https://www.sqlite.org/fts5.html#external_content_tables)、[FTS5 contentless 限制](https://blackglory.me/notes/sqlite/SQLite3/FTS_Full-Text_Search/FTS5/Special_Table_Types/Contentless_Table)、[SQLite Forum: contentless vs external](https://sqlite.org/forum/info/b4275eb01904bc87)

## 同步触发器

内容表 (assets) 与 FTS5 索引的一致性由 AFTER 触发器维护，使用 `'delete'` 特殊命令传递 OLD 值：

```sql
-- INSERT
CREATE TRIGGER assets_fts_ai AFTER INSERT ON assets BEGIN
  INSERT INTO asset_search(rowid, label, filename, tags, description, source_url, folder_path, metadata_text)
  VALUES (new.asset_id, new.label, new.filename, new.tags, new.description,
          new.source_url, new.folder_path, new.metadata_text);
END;

-- DELETE: 必须用 'delete' 命令 + OLD 值，否则 BEFORE DELETE 下
-- INSERT OR REPLACE 等操作会导致 FTS5 读不到旧文本，索引不一致
CREATE TRIGGER assets_fts_ad AFTER DELETE ON assets BEGIN
  INSERT INTO asset_search(asset_search, rowid, label, filename, tags, description, source_url, folder_path, metadata_text)
  VALUES ('delete', old.asset_id, old.label, old.filename, old.tags, old.description,
          old.source_url, old.folder_path, old.metadata_text);
END;

-- UPDATE: delete old tokens + insert new
CREATE TRIGGER assets_fts_au AFTER UPDATE ON assets BEGIN
  INSERT INTO asset_search(asset_search, rowid, label, filename, tags, description, source_url, folder_path, metadata_text)
  VALUES ('delete', old.asset_id, old.label, old.filename, old.tags, old.description,
          old.source_url, old.folder_path, old.metadata_text);
  INSERT INTO asset_search(rowid, label, filename, tags, description, source_url, folder_path, metadata_text)
  VALUES (new.asset_id, new.label, new.filename, new.tags, new.description,
          new.source_url, new.folder_path, new.metadata_text);
END;
```

**不要用 `AFTER UPDATE` + 普通 `DELETE FROM asset_search WHERE rowid=...`：** 此时内容表已写入新值，FTS5 从内容表重读到的已是新文本，删除的是新 token 而非旧 token，导致索引泄漏旧 token。这是经 SQLite Forum 反复确认的 trap。

**迁移时的 FTS 重建：** 新增触发器不会自动索引已有数据。schema migration 在变更 FTS 结构或新增触发器后必须执行 `INSERT INTO asset_search(asset_search) VALUES('rebuild')`。

来源：[SQLite Forum: VTables, triggers and FTS5](https://sqlite.org/forum/forumpost/a9664568768b9891)、[FTS5 corruption due to wrong update triggers](https://sqlite.org/forum/forumpost/58344c9e1b88c30c)、[FTS5 rebuild command](https://www.sqlite.org/fts5.html#the_rebuild_command)

## `ORDER BY rank` 隐藏列优化

FTS5 有一个内置优化：当 `ORDER BY` 使用 `rank` 隐藏列（而非别名）时，`snippet()` 等辅助函数只在 `LIMIT` 行上求值——不会对全部匹配行都执行一遍再截断。在 10 万资产的场景下这是必须利用的优化。

```sql
-- 好：rank 是隐藏列，FTS5 将 snippet() 延迟到 LIMIT 之后
SELECT a.*, snippet(asset_search, 0, '<b>', '</b>', '...', 32) AS snippet
FROM assets a
JOIN asset_search s ON a.asset_id = s.rowid
WHERE asset_search MATCH ?
ORDER BY rank ASC LIMIT 50;

-- 差：rank 是表达式别名，snippet() 在所有匹配行上求值
SELECT a.*, bm25(asset_search, 12.0, ...) AS rank, snippet(...) AS snippet
FROM assets a
JOIN asset_search s ON a.asset_id = s.rowid
WHERE asset_search MATCH ?
ORDER BY rank ASC LIMIT 50;
```

**使用 `ORDER BY rank`（不加别名）时权重在哪里设置？** 通过 `rank MATCH` 子句：

```sql
... WHERE asset_search MATCH ?
  AND rank MATCH 'bm25(12.0, 10.0, 8.0, 5.0, 3.0, 2.0, 1.0)'
ORDER BY rank ASC LIMIT 50;
```

但 `rank MATCH` 参数必须是 SQL 字面量，不能用 `?` 绑定。对 MVP 来说权重是静态常量，这点不是问题。

**备选（同样有效）：** 直接 `ORDER BY bm25(asset_search, 12.0, 10.0, 8.0, 5.0, 3.0, 2.0, 1.0) ASC`。这两种写法的优化路径相同。

来源：[SQLite Forum: snippet performance](https://sqlite.org/forum/forumpost/44dad09005)、[SQLite FTS5 Sorting by Auxiliary Function](https://www.sqlite.org/fts5.html#sorting_by_auxiliary_function_results)

## 搜索查询构造器

产品简报定义了三个 FTS 查询要求：跨字段 AND、同字段多值 OR、单条件排除 (NOT)。FTS5 的查询语法可直接表达：

```text
// 跨字段 AND：空格分隔（隐式 AND）
label:PBR filename:helmet

// 同字段 OR：显式 OR
tags:character OR tags:prop

// 排除：NOT
tags:character NOT description:draft

// 组合
(label:PBR filename:helmet) AND (tags:character OR tags:prop) NOT folder_path:archive
```

**查询构造器（TypeScript）：**

```typescript
interface SearchClause {
  /** 字段名，null = 不限定字段 */
  field: string | null;
  /** 一个值 -> 精确 token；多个值 -> OR */
  values: string[];
  /** 是否排除 */
  exclude: boolean;
}

interface SearchQuery {
  /** 多个 clause 之间是 AND */
  clauses: SearchClause[];
}

function buildFts5Query(query: SearchQuery): string {
  const parts: string[] = [];

  for (const clause of query.clauses) {
    if (clause.values.length === 0) continue;

    // 同字段多值 -> OR
    const valueExpr = clause.values
      .map(v => escapeFts5Token(v))
      .map(v => (clause.field ? `${clause.field}:${v}` : v))
      .join(' OR ');

    const wrapped = clause.values.length > 1 ? `(${valueExpr})` : valueExpr;
    parts.push(clause.exclude ? `NOT ${wrapped}` : wrapped);
  }

  return parts.join(' '); // 隐式 AND
}

/** 将用户输入转成 FTS5 安全的 token */
function escapeFts5Token(raw: string): string {
  // 移除双引号（阻止短语注入），按空格分词，每词包双引号即安全字面匹配
  const noQuotes = raw.replace(/"/g, ' ');
  return noQuotes
    .split(/\s+/)
    .filter(Boolean)
    .map(t => `"${t}"`)
    .join(' ');
}
```

使用 prepared statement 绑定整个 MATCH 表达式：

```typescript
const searchStmt = db.prepare(`
  SELECT a.asset_id, a.filename, a.file_size, a.modified_at
  FROM assets a
  JOIN asset_search s ON a.asset_id = s.rowid
  WHERE asset_search MATCH ?
  ORDER BY rank ASC
  LIMIT ? OFFSET ?
`);

const results = searchStmt.all(fts5QueryString, limit, offset);
```

**重要：** 把整个 FTS5 查询字符串作为一个绑参传给 `MATCH ?`，不要在 JS 端拼接 SQL。这样 FTS5 查询语法注入只会影响 FTS 匹配结果（最多返回空集），不会逃逸出 MATCH 表达式。

**中文处理：** 中文 Label、标签和描述在进入 FTS 前由应用层分词为空格分隔的 token 串。具体策略（分词库选型）见 [database-and-fulltext-search.md](./database-and-fulltext-search.md)。

来源：[SQLite FTS5 Query Syntax](https://www.sqlite.org/fts5.html#full_text_query_syntax)、[better-sqlite3 MATCH bind parameter pattern](https://www.mail-archive.com/sqlite-users@mailinglists.sqlite.org/msg117429.html)

## better-sqlite3 的 FTS5 支持

- `better-sqlite3` **默认启用 `SQLITE_ENABLE_FTS5`**。`npm install better-sqlite3` 后开箱即用，不需要额外编译参数。
- `MATCH ?` 绑定与 `db.prepare().all()` 的标准 API 完全兼容，没有 FTS5 专用 API 差异。
- 同步 API（`prepare`、`all`、`get`、`run`）与 Library Worker 内的单连接模型匹配：事务内不跨 `await`，不需要连接池。
- `db.pragma('trusted_schema = ON')` 可能需要在打开资源库时执行，某些构建默认关闭此 pragma，导致触发器中修改虚表时报 `unsafe use of virtual table`。

来源：[better-sqlite3 compilation.md](https://raw.githubusercontent.com/WiseLibs/better-sqlite3/master/docs/compilation.md)、[better-sqlite3 vs node:sqlite for FTS5](https://github.com/openclaw/openclaw/issues/3776)

## 性能：10 万资产首屏 < 1s

| 因素 | 措施 |
|---|---|
| FTS5 索引结构 | 纯索引大小可控，10 万行 ≈ 数十 MB。FTS5 使用分段 B-tree，写入和查询均高效。 |
| `ORDER BY rank` 优化 | 辅助函数（snippet 等）延迟到 LIMIT 之后求值。 |
| LIMIT 分页 | 首屏 50-100 项。使用 `LIMIT + OFFSET`；深分页出现瓶颈后再改为 `rank + rowid` 游标。 |
| MATCH + ORDER BY | FTS5 的内部查询先按 token 检索 posting list，再按 bm25 排序——在 10 万级别远小于 1s。 |
| JOIN | FTS 虚表通过 `content_rowid` JOIN 到资产内容表取全字段；SQLite 内部优化为 indexed lookup。 |
| 启动路径 | FTS 表的 schema 只需在打开资源库时验证，不触碰索引数据。首屏查询在第一屏请求时才执行。 |
| WAL | 本机使用 WAL 模式，读不阻塞写，写不阻塞读。 |

**已知风险：** 如果 `MATCH` 匹配了大量行（如通用词 "image" 匹配几千条），再 ORDER BY rank 做全量排序 + LIMIT 截断，可能慢于预期。缓解措施：(1) 用 `LIMIT` + bm25 的短路；(2) 对匹配计数过高的查询合并结构化过滤条件（folder、文件格式）先缩小集。

来源：[SQLite FTS5 Internals](https://www.sqlite.org/fts5.html#implementation_details)、[Anatomy of a Ranked Search](https://loke.dev/blog/sqlite-fts5-ranked-search-internals)

## 后续进阶：自定义辅助函数

当需要**动态权重**（如按文件夹深度衰减、资产年龄衰减、或用户行为反馈调整）时，FTS5 支持通过 `sqlite3_fts5_create_function()` 注册 C 语言辅助函数，用 `Fts5ExtensionApi` 获取每行匹配的列分布、词频和偏移位。

这需要编译原生 C 扩展，或等 `better-sqlite3` 暴露 `sqlite3_create_function` 以注册 FTS5 扩展。目前这不是 MVP 需求，但架构预留了升级路径：切换自定义函数不需要重建 FTS 索引，只需在查询语句中替换 `bm25()` 为 `custom_rank()`。

来源：[SQLite FTS5 Custom Auxiliary Functions API](https://www.sqlite.org/fts5.html#custom_auxiliary_functions)、[SQLite Forum: Dynamic column weights](https://www.sqlite.org/forum/forumpost/6fe4996bf09f6996)

## 许可证

- `better-sqlite3`：MIT（Serpent 自身也是 MIT，完全兼容）。
- SQLite（包含 FTS5）：public domain。没有任何商业或分发限制。

## 跨平台注意事项

- FTS5 索引文件（`.sqlite` 中的虚表 shadow table）跨 macOS arm64 与 Windows x64 完全可移植。SQLite 文件格式是稳定跨平台的。
- `better-sqlite3` 需要每个平台独立编译（native C++ addon），但这是 `npm install`/`electron-rebuild` 的标准流程，ADR-0019 和已有调研已覆盖。
- 中文 tokenization 在应用层做，不依赖 SQLite ICU/tokenizer 扩展，跨平台一致性由 JS 代码保证。

## 参考

- [SQLite FTS5 官方文档](https://www.sqlite.org/fts5.html)
- [better-sqlite3 编译配置](https://raw.githubusercontent.com/WiseLibs/better-sqlite3/master/docs/compilation.md)
- [better-sqlite3 API 文档](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)
- [SQLite Forum: FTS5 ranking discussion (Dan Kennedy)](https://www.sqlite.org/forum/forumpost/b6a96f248e)
- [SQLite Forum: Dynamic column weights](https://www.sqlite.org/forum/forumpost/6fe4996bf09f6996)
- [SQLite Forum: snippet performance and rank optimization](https://sqlite.org/forum/forumpost/44dad09005)
- [SQLite Forum: FTS5 external content trigger corruption](https://sqlite.org/forum/forumpost/58344c9e1b88c30c)
- [Anatomy of a Ranked Search: Scaling SQLite FTS5](https://loke.dev/blog/sqlite-fts5-ranked-search-internals)
- [ADR-0009 统一加权全文搜索](../adr/0009-unified-weighted-search.md)
- [ADR-0019 采用 SQLite FTS5 与单一应用进程](../adr/0019-sqlite-fts-and-single-app-process.md)
- [数据库与全文搜索技术调研](./database-and-fulltext-search.md)
- [Serpent 产品简报](../../product-brief.md)
