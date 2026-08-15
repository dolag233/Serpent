# 2026-07-30 标准插件 QuickJS Host 垂直切片

工单：`Serpent-upsn.3`（进行中）。在脚本 UtilityProcess 模式之外新增长驻 `plugin-runtime.*` Host，开库后按解析/信任结果激活 standard 插件，Main 只读取入口字节并经 IPC 下发，不在 Main/Renderer 执行插件代码。

## 本切片内容

- 协议：`src/shared/plugin-runtime-utility-protocol.ts`
- Host：`plugin-standard-host*.ts` + `vite.plugin-runtime.config.ts` → `plugin_standard_host.js`
- Main：`PluginRuntimeSupervisor`、`PluginActivationCoordinator`；`library.opened/imported/closed` 接线
- Guest：复用 QuickJS 沙箱，`serpent.__waitUntilDeactivate` 停放 activate 生命周期
- Gateway：`automationSourceSchema` 增加 `plugin`；权限映射 `plugin-permission-capabilities.ts`
- 人类验收：`PLUGIN-002`

## 明确推迟

- 可信 Node Host（`Serpent-upsn.4`）
- UI contributions / Hook / Provider
- packaged / Windows 证据

## 后续增量

- 插件管理 IPC `afterMutation`：信任 / Safe Mode / 安装卸载后刷新已打开资源库的 Host 激活（无需重开库）。
- Host 心跳：`plugin-runtime.heartbeat`；Main 失联后 `HEARTBEAT_TIMEOUT` 终止 Host 并计入 quarantine。
- 隔离对抗单测：`plugin-standard-host-isolation.test.ts` 覆盖 process/require/import/fs/network 不可见，以及 CPU/内存/输出洪水可终止；Supervisor.activate 不阻塞等待 guest 完成。
- 固定探测插件：`tests/fixtures/plugins/standard-host-probe/`；guest 激活写 `.serpent/plugin-data` 单测；E2E `plugin-standard-host-activation.test.ts`；`run-e2e.mjs` 补建 `plugin_standard_host.js` / `plugin_trusted_host.js`；`verify:package` 校验 ASAR 内 Host 产物。
- E2E 修复：剥离 `ELECTRON_RUN_AS_NODE`；Zod 4 禁止重复 `disabled` 判别导致安装响应在 preload 失败；探测清单补 `library.read`；Host `asset.search` 与脚本共用 `normalizeAutomationAssetSearchInput`。`plugin-management` 与 `plugin-standard-host-activation` E2E 均 1 passed。
- Contribution 描述符：激活后从 manifest 写入 `createContributionRegistry()`；关库 / Safe Mode / 解析变更时按 instance 完整撤销（UI 路由仍属 Phase E）。

## 验证

```bash
npm run typecheck
node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts \
  tests/unit/plugin-standard-host-isolation.test.ts \
  tests/unit/plugin-standard-host-probe-fixture.test.ts \
  tests/unit/plugin-manager-response-parse.test.ts
node scripts/run-e2e.mjs tests/e2e/plugin-management.test.ts
node scripts/run-e2e.mjs tests/e2e/plugin-standard-host-activation.test.ts
```
