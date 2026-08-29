# 2026-08-15 迁移版本号冲突事故与兼容性守护

## 事故

两条开发线（WebDAV 同步 `Serpent-xffq` 与 Eagle 导入/AI 抑制）并行开发，都基于"当前最新 schema 是 v36"各自把新迁移注册为 **v37**：

- Eagle 线：`AUTO_ANALYSIS_SUPPRESSION` → v37（checksum `c164ffd3…`），并已用它打开了隔离测试库，使这些库的 `schema_migrations` 固化了该 checksum。
- 同步线：`SYNC_SCHEMA` → v37（checksum 不同），推到了 dev。

用户打开旧库时报 `LIBRARY_CORRUPT`（UI 文案"所选文件夹不是有效的 Serpent 资源库"），根因是 `verifyMigrationHistory` 按当前 MIGRATIONS 数组校验 checksum，v37 语义分歧导致不匹配。

## 修复

- **迁移只加不改**：v37 归还给已占用真实数据的 `AUTO_ANALYSIS_SUPPRESSION`，`SYNC_SCHEMA` 顺延到 v38。旧库（v37=AUTO）无损直接打开，新库补跑 v38。
- 增加守护测试 `tests/worker/migration-checksum-snapshot.test.ts`：**golden checksum 快照**——任何已发布迁移的 SQL/checksum 一旦改动即红；新增迁移必须末尾追加版本号并同步更新快照。

## 规则（强制）

1. **迁移版本号是全局唯一资源**：多工作线并行时，新增迁移必须先认领一个版本号（在 dev 上落一个占位提交，或与主 agent 协调），绝不两条线各自占用同一版本号。
2. **已随真实库落地的迁移不可变**：一旦某个版本号 + checksum 被任何真实库写入 `schema_migrations`，它的 SQL 内容与版本号永久固定。改动只能通过"新增更高版本迁移"实现。
3. **每次加迁移**：末尾追加 + 更新 golden checksum 快照 + 跑 `migration-checksum-snapshot` / `migration-discipline` / `schema-downgrade-chain` 三个守护。
4. **升级验收必须真实旧库**：发布前用真实的旧版本库（含 `.bak-v34` 等历史备份）跑打开+迁移，不能只靠 synthetic 测试。

## 验证

- 隔离测试库（user_version=37, AUTO checksum）用当前代码打开 ✓
- 迁移守护三件套 + readonly 62/62 通过；typecheck / lint 干净。

## 2026-08-16 后续：反向占用的真实测试库

同步线先把 SYNC 写进 v37 后，再被当前代码补上 AUTO 作为 v38 的库（隔离图像测试库）会留下 **v37=SYNC、v38=AUTO** 的对调历史。物理表都在，但 `verifyMigrationHistory` 失败 → 损坏恢复梯度把它当成受损库只读打开。Worker `library.close` 仍对只读连接执行 `cancelJobs` 写入，切到另一个测试库失败并回滚，用户被锁在只读库里。

处理：

- 识别该精确分叉，只改写 `schema_migrations`（及必要时补 AUTO 表），不改已有表结构。
- 只读关闭/切库必须始终成功；替换库已打开后不得因旧库 close 失败而回滚。
