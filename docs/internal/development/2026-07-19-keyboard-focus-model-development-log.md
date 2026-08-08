# 2026-07-19 键盘焦点模型开发日志

工单：`Serpent-vvn`

## 范围

查看页 nav/close 的 focus-visible、LibrarySwitcher / SortModeControl 的 roving focus、TagPicker 单一焦点、对话框首焦点与 Tab trap。

## 实现

1. `roving-list-keyboard.ts`：Arrow/Home/End/Escape 与索引纯函数；单测覆盖索引环绕。
2. `LibrarySwitcher` / `SortModeControl`：`tabIndex={-1}`、打开首焦点、Esc 回触发器、键盘 focus 样式。
3. `TagPickerMenu` + Inspector 建议项：`tabIndex={-1}` + `mousedown` preventDefault；Home/End。
4. 查看页 CSS：accent `box-shadow` 焦点环；`:has(.preview-chrome-fade:focus-visible)` 在 idle 时仍显示 chrome。
5. `use-dialog-focus-trap.ts`：覆盖设置/导出/AI/配对/媒体任务/链接规则等对话框；Escape 关闭同步扩展。
6. 右键菜单补齐 Home/End 实际跳转。

## 测试

```bash
node scripts/run-vitest-with-electron.mjs tests/unit/roving-list-keyboard.test.ts
# 1/1 passed
npm run typecheck  # green
```

Computer Use：未执行。

## 人类验收

- A11Y-001 / A11Y-002 / A11Y-003
