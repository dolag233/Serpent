# 2026-08-01 插件 Phase D：领域事件与 cause chain

工单：`Serpent-upsn.5`（进行中）。脚本/MCP 开发态收口后恢复插件平台实施；Phase C（`upsn.3`/`.4`）编码态已关，packaged/Windows 验证转到 `Serpent-b6x6`。

## 本增量

- 契约：`src/plugins/plugin-domain-events.ts`（`library.changed` / `asset.changed`、eventId、cause chain 深度/循环校验、有界事件队列）
- 协议：标准/可信 Host 增加 `*.domain-event` 下发与 `host-command.causeChain`
- Main：`publishLibraryChanged` / `publishAssetChange` → `PluginActivationCoordinator.fanOutDomainEvent`；Gateway 执行前校验 cause chain
- Host：`serpent.events.next` / `serpent.events.on`；事件处理期间自动附着 cause chain
- 标准 Host 会话墙钟改为长生命周期（以 deactivate 为边界），避免 parked 插件被 60s wall 误杀
- 人类验收：`PLUGIN-005`

## 明确推迟（仍属 upsn.5）

- 阻断 `onWill*` Hook 与 Execution Plan 集成
- 插件 Job handler / paused-blocked 恢复
- 更细粒度领域事件（导入单项、标签变更等）
- packaged / Windows / Computer Use

## 验证

```bash
npm run typecheck
node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts \
  tests/unit/plugin-domain-events.test.ts \
  tests/unit/plugin-standard-host.test.ts \
  tests/unit/plugin-contract.test.ts
```
