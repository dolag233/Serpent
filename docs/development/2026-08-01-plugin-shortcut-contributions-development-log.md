# 2026-08-01 插件快捷键贡献（Phase E slice 8 / PLUGIN-021）

## 范围

本增量实现 Host-rendered `shortcuts` 贡献（非 Input Capture Session）：

- manifest `contributes.shortcuts` 声明 `{ id, command, accelerator }`（Electron 加速器语法）；
- 激活时注册 `kind: 'shortcut'` / `target: 'shortcuts'`，停用时随实例撤销；
- Renderer `keydown` 监听匹配加速器并调用 `plugin-manager.run-command`（与菜单/工具栏共用 invoke 路径）；
- 与 `platform-shortcut-table` 冲突的加速器在注册阶段跳过；
- `menu-command-probe` 增加 `F9` → `probe.write-shortcut`，写入 `shortcut-command` storage。

**不在本切片**：`input.capture.*`、OS 全局钩子、iframe 快捷键（`Serpent-upsn.7`）。

## 实现位置

- `src/shared/plugin-accelerator.ts`：Electron 加速器解析与核心快捷键冲突检测；
- `src/plugins/plugin-manifest.ts`：`contributes.shortcuts` schema 与命令引用校验；
- `src/plugins/plugin-contributions.ts`：`listShortcutContributions`、冲突跳过；
- `src/main/plugin-activation-coordinator.ts`：`list-contributions` / `run-command` 支持 shortcuts；
- `src/shared/plugin-manager-api.ts`：`target: 'shortcuts'` 与贡献 schema；
- `src/renderer/plugin-shortcut-contributions.ts`：宿主快捷键模块；
- `src/renderer/App.tsx`：接入 `usePluginShortcutKeyboard`；
- `tests/fixtures/plugins/menu-command-probe/`：F9 探测项。

## 冲突跳过策略

注册时对照 `PLATFORM_SHORTCUT_TABLE`（mac 与 windows 双侧）。与核心 Serpent 和弦相同的加速器**不注册**贡献。示例：`CmdOrCtrl+F`（聚焦搜索）会被跳过。

探测插件使用 `F9`（未占用）。

## 验证

```bash
npx tsc --noEmit
npx vitest run tests/unit/plugin-contributions.test.ts tests/unit/plugin-accelerator.test.ts tests/unit/plugin-package-ipc.test.ts
```

## 未验证与推迟

- 真实 Electron 按键、完整进程重启、packaged、Windows 和 Computer Use 尚未验证；
- 插件快捷键与浏览/查看器内核心快捷键的运行时优先级矩阵（除核心表冲突跳过外）推迟后续打磨；
- Input Capture Session（`Serpent-upsn.7`）未实施。

## bd 备注

`Serpent-upsn.6`：PLUGIN-021 编码完成，待人类验收；工单未关闭（upsn.7 等后续切片仍在同一 epic）。
