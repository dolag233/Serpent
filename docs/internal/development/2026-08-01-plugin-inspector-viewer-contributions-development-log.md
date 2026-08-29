# 2026-08-01 插件 UI Inspector/Viewer 贡献（Phase E slice 5+6）

## 范围

本增量实现 Host-rendered `inspector.sections` 与 `viewer.actions` 贡献：

- manifest `contributes.inspector` 声明 `{ id, title?, command }`；
- manifest `contributes.viewerActions` 声明 `{ id, command, title? }`；
- 激活时注册 `kind: 'inspector-section'` / `viewer-action`，停用时撤销；
- Renderer 在 Inspector 面板与资产查看器 chrome 渲染宿主区块/按钮；
- 点击经 `plugin-manager.run-command` 传递当前选中或正在查看的 `assetIds`；
- `menu-command-probe` 增加 `probe.write-inspector` / `probe.write-viewer` 与对应贡献，写入 `inspector-command` / `viewer-command` storage。

`menus.workspace`（PLUGIN-015）已实现于 Phase E slice 3，见 [菜单贡献开发日志](2026-08-01-plugin-ui-menu-contributions-development-log.md)。

## 实现位置

- `src/plugins/plugin-manifest.ts`：`inspector` / `viewerActions` schema 与命令引用校验；
- `src/plugins/plugin-contributions.ts`：`listInspectorSectionContributions` / `listViewerActionContributions`；
- `src/main/plugin-activation-coordinator.ts`：`list-contributions` / `run-command` 扩展；
- `src/shared/plugin-manager-api.ts`：新 target 与贡献 schema；
- `src/renderer/plugin-inspector-sections.tsx`：Inspector 宿主区块；
- `src/renderer/plugin-viewer-actions.tsx`：查看器宿主按钮；
- `src/renderer/InspectorPanel.tsx` / `AssetPreviewModal.tsx` / `App.tsx`：接入；
- `tests/fixtures/plugins/menu-command-probe/`：inspector/viewer 探测项。

## 验证

- `npx tsc --noEmit`
- `npx vitest run tests/unit/plugin-contributions.test.ts tests/unit/plugin-package-ipc.test.ts`

## 未验证与推迟

- 真实 Electron Inspector/查看器点击、完整进程重启、packaged、Windows 和 Computer Use 尚未验证；
- `menus.workspace` 工作区空白区右键菜单贡献（PLUGIN-015）已实现，待人类验收；
- Inspector 区块排序/分组、查看器动作图标与窄窗收纳推迟到后续打磨。
