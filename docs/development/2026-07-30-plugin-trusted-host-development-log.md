# 2026-07-30 可信插件 Node Host 垂直切片

工单：`Serpent-upsn.4`（进行中）。每个可信插件独立 UtilityProcess，完整 Node 能力；Main 只下发已校验的 `packageDirectory` + 入口相对路径，不在 Main/Renderer 执行入口。

## 本切片

- 协议：`src/shared/plugin-trusted-runtime-protocol.ts`
- Host：`plugin-trusted-host*.ts` + `vite.plugin-trusted-runtime.config.ts` → `plugin_trusted_host.js`
- Main：`PluginTrustedRuntimeSupervisor`（一实例一进程）
- 激活协调：resolved + `runtime.mode === 'trusted'` 走可信 Host
- 人类验收：`PLUGIN-003`

## 明确说明

- 权限只约束 Gateway RPC；**不能**拦截子进程内的任意 Node/FS/网络。
- UI 风险文案、原生模块 ABI 校验、packaged/Windows 证据仍待后续。

## 验证

```bash
npm run typecheck
node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts \
  tests/unit/plugin-trusted-host.test.ts \
  tests/unit/plugin-trusted-runtime-supervisor.test.ts \
  tests/unit/plugin-activation-coordinator.test.ts
```
