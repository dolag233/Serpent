# ADR-0019：采用 SQLite FTS5 与单一应用进程

> 2026-07-16 更新：其中 Label 索引、分词和权重部分已被 [ADR 0022](0022-retire-asset-label.md) 取代；当前权重从文件名 10 开始，不再存在 Label 列。

- 状态：已接受
- 日期：2026-07-11
- 替代：ADR-0014 中“多个独立 Serpent 进程并行”的部分

## 背景

MVP 需要在 Electron 中支持每库 10 万资产、多库同时打开、加权全文搜索、三秒渐进启动和用户选择 NAS/同步目录。多个独立应用进程会重复文件监听、迁移和任务调度，即使数据库能协调短写事务，也无法可靠协调跨文件系统操作。

详见[数据库与全文搜索技术调研](../research/database-and-fulltext-search.md)。

## 决策

- 使用 `better-sqlite3` 和 SQLite FTS5。
- 数据库只在 Library Worker 中打开；每个打开的资源库使用一个长期连接和独立写入队列。
- 每台电脑只运行一个 Serpent 应用进程。第二次启动通过 Electron 操作系统级单实例机制把打开请求转交首实例；不在资源库内创建锁文件。
- 多个资源库不使用 SQLite `ATTACH`，不执行跨库事务或搜索。
- 本机与直连移动盘使用 WAL、`synchronous=FULL`。
- NAS 使用 DELETE rollback journal、`synchronous=FULL`，标记为实验性、自担风险；MVP 明确不支持同一资源库被多台电脑同时打开。
- 同步目录允许用户选择，但只把“资源库关闭后同步或同步导出快照”视为安全路径；活动数据库同步明确提示风险。
- FTS5 使用 BM25 字段权重，初始基线为 Label 12、文件名 10、标签 8、描述 5、源链接 3、文件夹 2、其他元信息 1，并通过基准与用户测试调整。
- 中文 Label、标签和描述在进入 FTS 前执行应用层分词；文件名精确/前缀和 URL 子串使用独立规范化索引。
- 智能合集保存结构化查询 JSON/AST，不保存拼接 SQL。

## 后果

- 三秒启动只加载资源库骨架与首屏 50–100 项；完整性检查、扫描、缩略图和 AI 恢复延后。
- schema 使用 `application_id` 和 `user_version`，只向前事务迁移。
- 导出活动资源库时通过 SQLite Online Backup API 获取一致数据库快照。
- 低优先级执行 quick check；用户手动“检查资源库”执行完整完整性与外键检查。
- `better-sqlite3` 需要针对 Electron ABI 和每个目标平台/架构构建测试。
- NAS/同步目录永远无法仅凭 SQLite 配置获得与本地磁盘相同的保证。
