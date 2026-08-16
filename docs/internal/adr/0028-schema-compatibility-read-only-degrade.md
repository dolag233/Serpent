# ADR-0028：schema 版本兼容——完全兼容旧版本数据；不提供只读资源库

> 状态：已修订（2026-08-16，Serpent-e0dw）
> 原采纳：2026-08-07（Serpent-033e）
> 触发：2026-08-07 一个库被未合入代码的 v34 迁移升级后，v33 构建打开时抛 `LIBRARY_VERSION_TOO_NEW` 直接拒绝打开。产品负责人明确：**不允许因 schema 版本打不开资源库**；**完全兼容旧版本数据是硬性要求**。
> 2026-08-16 修订：产品负责人明确 **不允许有只读资源库**——只读库和没有库没有区别。损坏必须自动修复（备份，再从 Assets 抢救），而不是只读打开。

## 决策

0. **原则（硬目标）**：任何版本都必须完全兼容旧版本数据——新代码打开旧库自动无损迁移到最新，升级后全功能可用（浏览/搜索/预览/编辑）。Desktop **不提供用户可见的只读资源库**。
1. **旧代码打开新版本库 → 可写打开，绝不拒绝，也不只读**：
   - `openLibrary` 先探测 `user_version`；高于 `SUPPORTED_SCHEMA_VERSION` 时仍用可写 SQLite 连接打开，跳过迁移（不能把未知新结构改回去）。
   - 只校验当前构建认识的规范 `schema_migrations` 前缀；多余的更高版本行忽略。前缀不规范则视为损坏，走备份/抢救，而不是只读。
   - 打开结果可带 `libraryVersion` / `supportedSchemaVersion` 作诊断；**不设 `readOnly`，不显示只读横幅**。写路径按「只加不改」纪律使用当前认识的列。
   - `LIBRARY_VERSION_TOO_NEW` 仍存在于非 openLibrary 的写路径（create/import 校验），openLibrary 不抛出。
   - `SQLITE_READONLY → LIBRARY_READ_ONLY` 只用于操作系统把文件标成只读、或内部 inspection 句柄；不是资源库产品模式。
2. **损坏 → 自动修复，不是只读**：
   - 打开梯度：主库 → 校验后的 backup-1 → backup-2 → **从 Assets 抢救重建可写空库**。协议里仍保留 `'read-only'` 枚举以免旧事件解析失败，Desktop **不再发出**。
   - 迁移连续失败 3 次后，按上次可用 schema **可写**打开（`migrationStuck`），不再锁成只读；升级到更新构建后会再试迁移。
   - checksum / 结构损坏不重试迁移，直接走备份/抢救。
3. **迁移纪律（使旧代码打开新库仍然可写）**：
   - 新迁移**只允许**：新增表、新增列（可为 NULL 或有默认值）、新增索引/触发器、放宽 CHECK 约束（通过表重建时保留旧列名与旧列语义）。
   - **禁止**：删除或重命名现有表/列/索引/触发器；改变现有列的类型/语义；收紧 CHECK。
   - **每个迁移的验收必须证明「旧版本库 → 迁移后全功能可用」**。违反此纪律的迁移不合并。
   - 切库：替换库已经打开成功后，不得因为旧库 close 失败而回滚新库。

## 理由

- 用户数据是产品底线：schema 升级造成的「打不开」是发布阻断级缺陷。
- 只读资源库把人锁在不能编辑、往往也切不走的状态，和没有库没有区别（2026-08-16 绘画库事故）。
- 「只加不改」让旧构建可以对新库执行已认识的写入；损坏用备份和 Assets 文件修复，比只读浏览更接近「库永远能用」。

## 兼容性与风险

- 若未来某个迁移违反纪律（删列/改语义），旧代码可写打开后查询或写入可能报错 → 由纪律审查阻止，出现即视为迁移缺陷。
- 新 schema 上的当前构建不会运行未知迁移；额外列被忽略。
- 抢救重建会丢失合集/标签/评分等元数据，只保留 Assets 源文件——这是双备份都不可用时的最后修复，不是只读。

## 测试

- `tests/worker/library-availability.test.ts`：资源库可用性合同（打开/可写/重开/切库/新 schema/分叉/粘滞/备份/抢救）；`npm run test:library-availability` 是资源库相关改动的强制门禁。
- `tests/worker/library-schema-readonly.test.ts`：假更高版本库可写打开、可改名/删文件；`SQLITE_READONLY → LIBRARY_READ_ONLY` 仍映射操作系统只读。
- `tests/worker/database-recovery.test.ts`：双备份损坏 → Assets 抢救且可写。
- `tests/worker/schema-failure.test.ts`：粘滞后可写打开；checksum 损坏 → 抢救。
- `tests/worker/library-service.test.ts`：未来 schema 可写；篡改 checksum → 抢救。

## 实施补充（Serpent-verg，2026-08-08；e0dw 修订 2026-08-16）

- 正向兼容见 `docs/internal/implementation/0031-schema-compatibility-guarantee.md`：宽容读取是主防线。
- 迁移失败路径（0031 §2.2）：失败回滚 + `.serpent/migration-failed.json` + 3 次重试 + 粘滞后**可写**打开上次可用 schema。
- 迁移纪律静态门禁：`tests/worker/migration-discipline.test.ts`。
- 全版本链兼容测试：`tests/worker/schema-compatibility.test.ts`、`tests/worker/schema-downgrade-chain.test.ts`。
