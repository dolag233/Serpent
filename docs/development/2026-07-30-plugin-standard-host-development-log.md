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
- 信任变更即时 refresh（当前依赖重开库或后续 IPC 钩子）
- packaged / Windows 证据

## 验证

```bash
npm run typecheck
node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts \
  tests/unit/plugin-runtime-utility-protocol.test.ts \
  tests/unit/plugin-standard-host.test.ts \
  tests/unit/plugin-runtime-supervisor.test.ts \
  tests/unit/plugin-activation-coordinator.test.ts
```
