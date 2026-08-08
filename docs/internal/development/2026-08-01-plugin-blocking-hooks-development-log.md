# 2026-08-01 插件阻断 Hook（Phase D slice 2）

## 范围

`Serpent-upsn.5` 第二个可验收增量：blocking `onWill` Hook 与 Automation Execution Plan 集成。

首条垂直切片：

- Hook 事件：`asset.trash`
- 插入点：Worker 只读 `automation.file-operation-plan` 之后、桌面确认之前
- 决策：`allow` / `warn`（并入确认文案）/ `block`（需 `hook.blocking`）
- 超时：默认 fail-open（2s）
- 排序：`pluginId` 稳定升序

## 实现要点

- `src/plugins/plugin-hooks.ts`：决策 schema、聚合、invoke 队列、`PluginHookBlockedError`
- Host 协议：`hook-invoke` / `hook-decision`（standard + trusted）
- Standard：guest `serpent.hooks.onWill` 经 `__nextInvoke` / `__respond` 桥接
- Trusted：Node bridge 内 handler Map
- `PluginActivationCoordinator.runWillHooks`
- `createDesktopAutomationFilePlanApprovalHandler` 可选 `runWillHooks`
- Gateway 映射 `PLUGIN_HOOK_BLOCKED`
- 固定探测插件：`tests/fixtures/plugins/hook-blocking-probe/`
- 人类验收：`PLUGIN-006`

## 明确推迟（仍属 upsn.5）

- 插件 Job handler
- 更细粒度 onWill / onDid 事件
- 桌面 UI 直连回收站路径上的 Hook
- 用户优先级排序、per-plugin fail-closed 设置
- packaged / Windows / Computer Use

## 验证

定向单测：`plugin-hooks`、`plugin-standard-host`（hook-decision）、`automation-file-plan-approval`（hooks before confirm / block）。
