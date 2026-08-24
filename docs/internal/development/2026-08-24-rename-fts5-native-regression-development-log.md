# 2026-08-24：重命名失败与 FTS5 native 探针回归

## 现象

Windows 下文件夹和资产的原地重命名同时失败，界面提示 SQLite 数据库引擎不可用。
诊断日志显示两个命令都在更新搜索索引时失败：`syncAssetSearchContent` 收到
`SqliteError: no such module: fts5`。

## 根因

当前 `better-sqlite3` native 模块仍能打开普通 SQLite 数据库，但没有编译进 Serpent
依赖的 FTS5。原有 `scripts/ensure-native.mjs` 只检查 `new Database(':memory:')`，因此
把这份不完整的 native 模块当成可用模块放行；重命名、标签等需要同步全文搜索索引的写入
随后才暴露错误。

这不是重命名 UI 或重命名事务分别失效，也不是测试和 `npm start` 使用不同的业务 API。
两者都加载同一个 Electron ABI native 模块；问题在于启动前能力检查不完整。

## 修复

- 将启动探针改为在 Electron 运行时创建 FTS5 虚表，验证数据库能力而不只验证 ABI 加载。
- FTS5 探针失败时沿用现有 `scripts/rebuild-native.mjs`，以 `VcpkgEnabled=false` 重建并再次
  验证；重建脚本同时拒绝残留的 `sqlite3.dll`。
- 将资产/文件夹重命名的人工验收状态标为回归待复验，工单为 `Serpent-a19a45`。

## 验证

- `npm run rebuild:native`：通过，Electron FTS5 probe OK。
- `node scripts/ensure-native.mjs`：通过，报告 Electron ABI 匹配。
- Electron 直接创建 FTS5 虚表：通过。
- `npm run test:library-availability`：9 个文件，198 通过，1 跳过。
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/folder-rename.test.ts tests/worker/asset-rename.test.ts`：20 通过。
- `npm run typecheck`、定向 ESLint、`git diff --check`：通过。

应用必须完全退出后重新启动，才能加载重建后的 native 模块；旧 Worker 不会在运行中替换
SQLite native 二进制。
