# 2026-08-01 插件 UI 工具栏贡献（Phase E slice 4）

## 范围

本增量实现 Host-rendered `toolbar` 贡献：

- manifest `contributes.toolbar` 声明 `{ id, command, title? }`；
- 激活时注册 `kind: 'toolbar'` / `target: 'toolbar'`，停用时撤销；
- Renderer 在工作区工具栏（`workspace-tools`）渲染宿主按钮；
- 点击经 `plugin-manager.run-command` 传递当前选中 `assetIds`（若有）；
- `menu-command-probe` 增加 `probe.write-toolbar` 命令与工具栏项，写入 `toolbar-command` storage。

iframe 自定义视图、Inspector/viewer/settings 页面、快捷键仍未在本切片实现。

## 实现位置

- `src/plugins/plugin-manifest.ts`：`contributes.toolbar` schema 与命令引用校验；
- `src/plugins/plugin-contributions.ts`：`listToolbarContributions`；
- `src/main/plugin-activation-coordinator.ts`：`list-contributions` / `run-command` 支持 toolbar；
- `src/shared/plugin-manager-api.ts`：`target: 'toolbar'` 与贡献 schema；
- `src/renderer/plugin-toolbar-contributions.tsx`：宿主按钮模块；
- `src/renderer/App.tsx`：接入 `PluginToolbarButtons`；
- `tests/fixtures/plugins/menu-command-probe/`：toolbar 探测项。

## 验证

- `npx tsc --noEmit`
- `npx vitest run tests/unit/plugin-contributions.test.ts tests/unit/plugin-package-ipc.test.ts`

## 未验证与推迟

- 真实 Electron 工具栏点击、完整进程重启、packaged、Windows 和 Computer Use 尚未验证；
- 工具栏图标、分组、溢出收纳与窄窗行为推迟到后续打磨。
