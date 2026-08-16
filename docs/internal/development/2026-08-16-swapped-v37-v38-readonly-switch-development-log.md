# 2026-08-16 绘画资源库只读囚禁与 v37/v38 分叉 — 开发日志

> 工单：`Serpent-e0dw`
> 触发：切换到绘画资源库后再切到 meme 资源库，界面显示「由更新版本的 Serpent 创建，当前为只读模式」，且无法离开。

## 根因

两件事叠在一起，不是 meme 库本身太新。

1. **绘画资源库是同步线先占用 v37 的真实库**。磁盘上 `user_version=38`，两套表都在（`asset_auto_analysis_suppression` 与 `sync_manifest_cache` / `assets.sync_id`），但 `schema_migrations` 是 v37=SYNC、v38=AUTO。当前代码期望相反。`verifyMigrationHistory` 报 `LIBRARY_CORRUPT` 后，损坏恢复梯度把它当受损库只读打开。只读横幅和 `LIBRARY_READ_ONLY` 文案都写成「更新版本」，所以看起来像版本过新。
2. **只读库切不走**。ADR-0028 要求只读关闭跳过写清理，但 Worker `library.close` 在 `closeLibraryAsync` 之前无条件调用 `cancelJobs`（UPDATE `jobs`）。SQLite 只读连接拒绝写入 → 关闭失败。Renderer 先打开新库，旧库 close 失败就回滚新库，用户被锁在只读绘画库里。

meme / 素材资源库的 v37/v38 历史是规范的 AUTO/SYNC，单独打开可写。

## 修复

- 识别该精确分叉（v1–v36 规范，且 v37 为 SYNC checksum），只改写 `schema_migrations`；若停在 sync-first v37 则补 AUTO 表并记 v38。不改已有表。下次打开绘画资源库应直接可写。
- 产品修订（同日）：**不允许只读资源库**。损坏打开梯度改为主库 → 备份 → Assets 抢救（可写）；新 schema 用可写连接打开；迁移粘滞按上次可用 schema 可写打开。协议保留 `'read-only'` 枚举以免旧事件解析失败，Desktop 不再发出。
- Renderer：替换库已经打开成功后，旧库 close 失败不再回滚新库。恢复横幅只用于备份/抢救，不再提示只读。

## 验证

定向 Worker 测试覆盖：分叉改写（`schema-compatibility.test.ts`）、新 schema 可写（`library-schema-readonly.test.ts`）、双备份损坏抢救（`database-recovery.test.ts`）、粘滞可写与 checksum 抢救（`schema-failure.test.ts`）。资源库可用性底线套件为 `npm run test:library-availability`（含 `library-availability.test.ts` 合同）。本机若被 `better-sqlite3` 的 vcpkg `sqlite3.dll` 挡住，用 `node scripts/run-vitest-with-electron.mjs` 并先 `npm run rebuild:native`。人类验收：2026-08-16 用户确认绘画资源库可写、切到 meme 可写、无只读横幅。
