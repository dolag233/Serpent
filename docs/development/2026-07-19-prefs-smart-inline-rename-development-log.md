# 2026-07-19 设置面板 / 智能合集加号 / 资产原地重命名

## 范围

- `Serpent-str` REQ-PREF-001：接通接已有 `AppSettingsDialog`（主题/语言/画布）与工具栏 `workspace.app-settings`。
- `Serpent-uu9` REQ-SMART-001：智能合集侧栏「+」聚焦发现栏智能合集名称输入框。
- `Serpent-wfj` REQ-MENU-008：资产重命名改为画布卡片内联输入（去掉 RenameDialog）；扩展名旁注；Enter 提交 / Esc 取消。
- `Serpent-o5b`：与 `Serpent-0x5` 重复，已关闭。
- `Serpent-zhh`：清除 AppSettings 未使用导致的 3 个 lint error；`exhaustive-deps` 17 条仍在 `App.tsx`/`InspectorPanel`，与巨型组件拆分 `Serpent-uye` 一并处理更安全，本 tick 不整文件加 deps（避免误触发循环）。

## 验证

- `npm run typecheck` 通过。
- `npm run lint`：0 error / 17 warning（仅剩 exhaustive-deps）。

## 验收 ID

- PREF-001、SMART-007、MENU-023（见 human-acceptance-checklist）。
