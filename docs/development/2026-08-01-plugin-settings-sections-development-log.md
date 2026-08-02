# 2026-08-01 插件 Host-rendered 设置行（Phase E slice 3）

## 范围

本增量实现 `settings.sections` Host-rendered 设置行：

- manifest `contributes.settings` 在激活时注册为 `settings.sections` 贡献；
- 设置值由既有 `PluginSettingsStore` 持久化（用户默认 / 资源库 `.serpent/plugin-settings/` / 本机覆盖三层合并；UI 写入 `user-default` 或 `library` 层）；
- 保存时镜像到 `PluginStorageStore` 的 `settings.<id>` 键，已激活插件可通过 `serpent.storage.get('settings.<id>')` 读取；
- Renderer 插件设置页对已安装有效包展示宿主渲染字段（boolean/number/string/select）。

`settings.pages` iframe、设备覆盖层 UI、设置变更事件推送仍未实现。

## 实现位置

- `src/plugins/plugin-contributions.ts`：`settingType`、`listSettingsContributions`；
- `src/shared/plugin-manager-api.ts`：`settings.sections` target、`get-plugin-settings` / `set-plugin-setting` IPC；
- `src/main/plugin-settings-store.ts`（既有）：持久化；
- `src/main/plugin-package-ipc.ts`：get/set + storage 镜像；
- `src/main/plugin-activation-coordinator.ts`：`listContributions` 支持 `settings.sections`；
- `src/renderer/plugin-host-settings-fields.tsx` / `PluginSettingsPage.tsx`：宿主 UI；
- `tests/fixtures/plugins/menu-command-probe/`：新增 `enabled-demo` boolean 设置与 storage 读取。

## 验证

- `npx tsc --noEmit`
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/unit/plugin-contributions.test.ts tests/unit/plugin-settings-sections.test.ts`
  - 定向单测通过（settings 注册 + IPC round-trip + storage 镜像）。

## 未验证与推迟

- 真实 Electron 设置页操作、完整进程重启、packaged、Windows、Computer Use 尚未验证；
- `select` 类型尚无 manifest options，UI 暂按文本字段处理；
- 设置变更不向 Host 推送独立事件（采用 storage 镜像方案）。
