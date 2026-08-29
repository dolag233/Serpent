# 2026-07-30 插件命名空间 Storage

工单：`Serpent-upsn.3` / `Serpent-upsn.4`（Phase C 设置与命名空间存储）。插件通过 Host 协议读写自己的 KV，不经 Automation Gateway；脚本不可用。

## 本切片

- `PluginStorageStore`：library → `.serpent/plugin-data/{pluginId}.json`；user → `userData/plugin-storage/{pluginId}/user.json`
- 协议：`plugin-runtime.storage-request/result`、`plugin-trusted.storage-request/result`
- Guest：`serpent.storage.get/set/delete/listKeys`
- 权限：`storage.read` / `storage.write`
- 人类验收：`PLUGIN-004`

## 验证

```bash
npm run typecheck
node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts \
  tests/unit/plugin-storage-store.test.ts \
  tests/unit/plugin-runtime-utility-protocol.test.ts \
  tests/unit/plugin-runtime-supervisor.test.ts \
  tests/unit/plugin-trusted-runtime-supervisor.test.ts
```
