# 2026-07-18 侧栏拖小自动隐藏（Serpent-4gk）

## 实现

- `panel-auto-hide.ts`：意图宽度阈值与边缘拖出位移判定
- `use-panel-resize.ts`：`pointerup` 过窄则 `onAutoHide`（不持久化窄宽）；折叠时 `beginEdgeRestore`
- App：折叠后渲染边缘 separator；保留 pane-reveal 点击

## 验收

SHELL-018
