# 2026-07-18 REQ-FOLDER-009 包含子文件夹显式开关

## 背景

FOLDER-001 人类验收不通过：默认递归不符合预期。用户要求显式勾选后才显示子文件夹资产（`Serpent-1lx` / REQ-FOLDER-009）。

## 实现

- `folderBrowseScope(scope, recursive)`：统一构造浏览/搜索的 folder scope；`all` 无 scope，`root` 始终非递归。
- `folderRecursive` 默认 `false`；进入托管/链接文件夹时，范围栏（面包屑旁）显示「包含子文件夹」复选框。
- 浏览与文件夹内搜索共用同一开关（勾选后 FILTER-012 语义仍成立）。
- 会话恢复使用当前开关值，不再强制 `recursive: true`。

## 验证

- `npx vitest run tests/unit/folder-browse-scope.test.ts`：通过。
- `npx tsc --noEmit`：通过。
- `tests/e2e/folder-recursive-scope.test.ts`：已按默认不递归 + 勾选后递归重写断言；本机 Electron E2E 若仍受 `--remote-debugging-port=0` 阻断则记未跑通。

## 人类验收

清单条目：`FOLDER-009`（待人类验收）。`FOLDER-001` 已撤回，由本条目承接。
