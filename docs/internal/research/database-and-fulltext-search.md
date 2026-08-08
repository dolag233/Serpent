# Serpent 数据库与全文搜索技术调研

> 调研日期：2026-07-11
> 范围：Electron + TypeScript、每库 10 万资产、多库、加权全文检索、智能文件夹、NAS/同步目录。
> 来源：SQLite、Electron、Node 与候选驱动官方文档和官方源码。

## 结论

MVP 采用 `better-sqlite3 + SQLite FTS5`：

- 数据库只在 Electron Library Worker（UtilityProcess）中打开。
- 每个已打开资源库一个长期连接和写入队列；多个库不使用 `ATTACH`，也不跨库查询。
- 本机与直连移动盘使用 WAL；NAS 使用 DELETE rollback journal，并明确标记为实验性、自担风险。
- 同步目录只建议在资源库关闭后同步，或同步导出快照；不承诺活动数据库的实时多设备同步安全。
- 搜索使用 FTS5 BM25 字段权重，文件名精确/前缀和 URL 子串另走普通索引或专用规范化列。
- 智能文件夹保存结构化查询 JSON/AST，不保存 SQL 字符串。
- 启动只加载资源库骨架和首屏 50–100 项，完整性检查、扫描、缩略图与 AI 恢复延后。

`better-sqlite3` 官方源码明确启用了 FTS5，并提供事务、超时、在线备份等能力。[better-sqlite3 官方仓库](https://github.com/WiseLibs/better-sqlite3)、[官方编译参数](https://raw.githubusercontent.com/WiseLibs/better-sqlite3/master/deps/defines.gypi)

## 搜索表与权重

建议搜索列：

```sql
CREATE VIRTUAL TABLE asset_search USING fts5(
  label,
  filename,
  tags,
  description,
  source_url,
  folder_path,
  metadata_text,
  content='asset_search_content',
  content_rowid='asset_id'
);
```

MVP 初始权重：

```text
Label       12
文件名      10
标签         8
描述         5
源链接       3
文件夹       2
其他元信息   1
```

权重是可基准测试调整的起点，不是不可变产品常量。FTS5 的 `bm25()` 支持逐列权重；官方还说明，按隐藏 `rank` 列排序通常更适合 `LIMIT` 首屏查询。[SQLite FTS5 BM25](https://www.sqlite.org/fts5.html#the_bm25_function)、[SQLite FTS5 rank](https://www.sqlite.org/fts5.html#sorting_by_auxiliary_function_results)

使用 external-content FTS 表避免重复保存全文字段，并以触发器维护一致性。新增触发器不会自动索引历史数据，迁移时必须执行 `rebuild`。[SQLite FTS5 external content](https://www.sqlite.org/fts5.html#external_content_tables)

## 中文与子串搜索

FTS5 默认 `unicode61` tokenizer 并不是中文分词器。[SQLite FTS5 tokenizer](https://www.sqlite.org/fts5.html#tokenizers)

MVP：

- Label、标签和描述在进入 FTS 前做应用层中文分词。
- 文件名精确、前缀搜索使用规范化列和普通索引。
- URL、文件名中间子串可以使用独立 trigram 索引，但不拿 trigram 结果替代主要 BM25 排序。
- 后续确有需要时实现 FTS5 custom tokenizer；SQLite 提供正式注册接口。

## 分页与三秒启动

- 首屏查询 50–100 项，滚动时预取下一页。
- MVP 使用稳定 `ORDER BY rank, asset_id LIMIT/OFFSET`。
- 先在 10 万资产基准中测量深分页；出现实测瓶颈后再换成基于 `rank + asset_id` 的游标分页。
- Renderer 永不一次接收或渲染 10 万条记录。

启动关键路径：

1. 显示窗口与最近资源库列表。
2. 启动 Library Worker。
3. 打开每库连接，读取 schema/application 版本。
4. 查询根文件夹、聚合数量与首屏。
5. 开放滚动、过滤和搜索。

延后 quick check、文件扫描、缩略图检查、AI 队列恢复及 FTS 优化/重建。

## 本地、NAS 与同步目录

SQLite WAL 依赖同一主机共享内存，官方明确说明它不适用于网络文件系统。[SQLite WAL](https://www.sqlite.org/wal.html)

SQLite 还指出网络文件系统的锁与同步刷盘可靠性因实现而异，rollback journal 只能降低风险，不能让跨网络场景获得本地磁盘同等保证。[SQLite over network](https://www.sqlite.org/useovernet.html)

| 位置 | 模式 | 产品级别 |
| --- | --- | --- |
| 本机 SSD/HDD | WAL + FULL synchronous | 正式支持 |
| 直连移动盘 | WAL + FULL synchronous | 支持，提示拔盘风险 |
| NAS/SMB/NFS | DELETE rollback + FULL synchronous | 实验性、自担风险 |
| 同步目录 | 活动时不建议同步 | 关闭后同步或导出快照 |

同步软件若分别复制活动数据库、journal 或 WAL 文件，可能产生不匹配的数据库状态。SQLite 官方列出了复制热 journal/WAL 不完整导致损坏的场景。[SQLite 数据库损坏场景](https://www.sqlite.org/howtocorrupt.html)

## 连接与事务

SQLite 同一时刻只有一个写事务，竞争可能返回 `SQLITE_BUSY`。[SQLite transactions](https://www.sqlite.org/lang_transaction.html)

因此：

- 每库一个连接，无需连接池。
- Library Worker 是应用内唯一数据库写入者。
- 批量导入按小批次短事务提交。
- 文件复制、缩略图、AI 与网络请求都在事务外执行。
- 事务中不跨 `await`；`better-sqlite3` 的 transaction wrapper 也是同步边界。[better-sqlite3 transaction API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#transactionfunction---function)
- 多个独立 Serpent 进程同时运行会重复文件监控和任务调度，因此 MVP 应使用 Electron 的操作系统级单实例锁，把第二次启动请求转发到首实例。该锁不写入资源库，不会被 NAS 或同步工具上传。[Electron single instance lock](https://www.electronjs.org/docs/latest/api/app#apprequestsingleinstancelockadditionaldata)

这不是团队资产锁，也不会造成资源库陈旧锁文件。

## 迁移、导出与检查

- 使用 `PRAGMA application_id` 识别 Serpent 数据库。
- 使用 `PRAGMA user_version` 管理只向前 schema migration；每次迁移在单一事务完成。[SQLite user_version](https://www.sqlite.org/pragma.html#pragma_user_version)
- FTS schema 或 tokenizer 变化时新建索引、重建后切换，不原地破坏旧索引。
- 新 schema 被旧客户端打开时拒绝写入，可给出只读提示。

产品不做自动定时备份，但“导出资源库”必须使用 SQLite Online Backup API 生成一致数据库快照，不能直接复制正在写入的 `library.db`。[SQLite Online Backup](https://www.sqlite.org/backup.html)

资源库打开后低优先级执行 `quick_check`；用户手动“检查资源库”运行 `integrity_check` 和 `foreign_key_check`。完整检查不放入三秒启动路径。[SQLite integrity check](https://www.sqlite.org/pragma.html#pragma_integrity_check)

## Electron 打包

`better-sqlite3` 是 native Node module，必须针对 Electron ABI 和 Windows x64、macOS x64/arm64 分别构建测试。Electron 官方要求原生模块针对 Electron 重新编译，并可使用 `@electron/rebuild`。[Electron native modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules/)

每个平台安装包必须做真实 smoke test：创建库、迁移、写入、建立 FTS5、执行 MATCH、在线备份和重新打开。

## 最终建议

`better-sqlite3 + SQLite FTS5 + 单个 Library Worker` 足以支撑 MVP 的 10 万资产目标，并保持搜索可解释、可离线和易备份。最大的已知边界不是数据量，而是：

- 中文需要应用层分词；
- NAS 只能实验性支持；
- 活动数据库不能安全地当普通文件做实时多设备同步；
- 文件系统操作必须通过持久操作日志与短数据库事务协调。
