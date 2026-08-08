# 2026-07-19 侧栏连续拖拽（SHELL-018）开发日志

工单：`Serpent-kro`

## 问题

人类验收：从完全隐藏向内拖出时，侧栏一显示就强制结束拖拽，光标/状态退出 col-resize，必须重新按下才能继续调宽。

## 根因

`beginEdgeRestore` 在 `shouldRestorePanelFromEdge` 为真时立刻 `removeEventListener` + `setResizing(null)`。隐藏方向的 `collapseFromDrag` 同样结束会话。

## 修复

1. `panel-drag-session.ts`：纯函数 `resolvePanelDragMove` 描述 resize ↔ collapse ↔ restore 步进，转换不表示会话结束。
2. `use-panel-resize.ts`：单一 `attachContinuousDrag`；hide/restore 只回调 `onAutoHide` / `onEdgeRestore` 并改 phase；**仅 pointerup** 清监听。

## 测试

```bash
node scripts/run-vitest-with-electron.mjs \
  tests/unit/panel-drag-session.test.ts \
  tests/unit/panel-auto-hide.test.ts
```

Computer Use：未执行；移交人工按 SHELL-018 复验。
