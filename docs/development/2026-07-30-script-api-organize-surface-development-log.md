# 2026-07-30 脚本 API 整理表面扩展

工单：`Serpent-ptn3`。对应此前天气/云素材采集反馈中「无法在脚本内建标签与分类」的缺口，以及 0023/0024 对脚本 vs 插件边界的重新划分。

## 范围

- 把 Gateway 已有只读命令暴露给 Desktop Script：`library.inspect`、`linked-folder.list`、`tag.list`、`collection.*`、`smart-collection.list`、`media.jobs.list`、`ai.jobs.status`、`asset.extracted-metadata.get`。
- 新增 Gateway + 脚本整理写入：`tag.create` / `tag.assign` / `tag.remove` / `folder.create`。
- 新增能力 `folder.write`（自动化 capability 与插件 permission 同步）。
- QuickJS `serpent` 绑定、类型声明、授权对话框文案、脚本使用说明与人类验收条目 `AUT-007`。

## 明确不做（属插件 / 可信宿主）

- `net.fetch` / 外网下载
- `library.create`
- `file.import`

## 证据

```bash
npm run typecheck
node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts \
  tests/unit/automation-command-gateway.test.ts \
  tests/unit/quickjs-sandbox-prototype.test.ts \
  tests/unit/automation-script-ipc.test.ts \
  tests/worker/automation-readonly-command-executor.test.ts
```

结果：typecheck 通过；上述 4 个文件 / 49 tests 通过。`tag.create` 仍被 readonly Worker dispatch 拒绝。
