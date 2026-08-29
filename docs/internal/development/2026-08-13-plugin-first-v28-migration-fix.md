# plugin-first v28 旧库迁移修复

日期：2026-08-13
工单：`Serpent-btgc`
范围：发布前旧库兼容性；不改变正常 canonical migration chain。

## 根因

早期 plugin-first 分支把 schema history 的 v24–v28 用于写协调、Job lease、缩略图队列、插件后台 Job 和插件派生字段。合并后的 canonical 线则把 v24–v26 用于 ignore/gitignore，并继续新增 v33–v36 的模型 artifact、内容 fingerprint、operation history 和 redo stack。

旧库识别逻辑原先只补到 plugin Job 的 v32，然后直接把 `schema_migrations` 重写为当前版本。这会让 SQLite 的 `user_version` 和 checksum 看起来是 v36，但数据库实际缺少 v33–v36 的对象。

## 修复

- 旧 plugin-first 库在重写 history 前补齐 canonical v24–v32 对象。
- 使用 canonical v33 model artifact rebuild，确保 `model_glb` 约束、关联索引和 change-sequence triggers 存在。
- 使用 v34 的幂等列补齐逻辑添加 `revisions.content_fingerprint`。
- 仅在 operation history 三张表和三个 triggers 全部不存在时创建 v35；检测到部分 schema 时 fail closed，避免把损坏布局静默当作完整布局。
- 缺少 `redo_sequence` 时应用 v36 redo stack migration。
- 所有对象完整后才重写 v24–v36 canonical checksums，并验证迁移历史。

## 可追溯证据

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
|---|---|---|---|
| plugin-first v28 旧库可升级到当前 schema，且不漏 v33–v36 对象 | `src/worker/library-service.ts` 的 `migrateLegacyPluginMigrationHistory` | `tests/worker/schema-compatibility.test.ts` 的 `legacy plugin-first v28 migration` | macOS Electron SQLite 集成测试；Windows、packaged 未执行 |
| 迁移后 operation history 可写入并可读取 | `recordOperationHistoryBarrier` / `getOperationHistoryStatus` | 同一 fixture 写入 barrier，并重开 SQLite 对账 | macOS Electron SQLite 集成测试；真实应用重启未执行 |

## 验证

- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/schema-compatibility.test.ts tests/worker/library-service.test.ts tests/worker/operation-history.integration.test.ts`：3 files，83 passed。
- `npm run test:worker`：61 files passed、4 skipped；1022 passed、10 skipped。
- `npm run typecheck`：通过。
- `npx eslint src/worker/library-service.ts tests/worker/schema-compatibility.test.ts`：通过。
- `git diff --check`：通过。

Windows/NTFS、packaged app 和跨平台真实旧库文件尚未执行，不能外推为 Windows 已验证。
