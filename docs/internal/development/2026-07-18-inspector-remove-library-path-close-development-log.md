# Inspector 移除资源库路径与关闭按钮

> 工单：`Serpent-t4c`（取代 CU-U6）
> 分支：`codex/slice-002-asset-ingestion`
> 日期：2026-07-18

## 变更

- `InspectorPanel` 删除底部资源库/路径展示与「关闭资源库」按钮；关闭仅保留左上角资源库菜单。
- 移除 `closeLibrary` prop 接线。
- E2E 改为 `closeLibraryViaSwitcher`（`library-lifecycle` / `asset-ingestion` / `media-preview`）。

## 验证

- `npx tsc --noEmit` 通过
- `npm run test:unit` → 56 / 626 passed
- Electron E2E 本环境启动仍受 `--remote-debugging-port=0` 阻断，记为未执行

## 附带

- 关闭陈旧工单 `Serpent-2id`（SHELL-004 其他资源库列表已实现）。
