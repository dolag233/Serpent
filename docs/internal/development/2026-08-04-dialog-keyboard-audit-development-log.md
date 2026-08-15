# 对话框 Enter / Esc 快捷键审计

工单：`Serpent-xdmu`。

## 本次发现与修复

- 全局 `dialog-escape-stack` 已覆盖大多数 App 模态层，但序列帧导入弹窗和序列帧设置弹窗没有注册到 Escape 快捷键优先级。
- 序列帧导入弹窗也没有加入 `useDialogFocusTrap` 的激活条件，因此打开后焦点可能逃出弹窗。
- 新增两层明确的 Escape action：导入弹窗优先关闭并清理 pending offer/error；序列设置弹窗关闭当前设置状态。
- 当两个序列弹窗状态同时存在时，导入弹窗按渲染层级优先消费 Escape，不会误关闭底层设置弹窗。
- Enter 继续复用已有统一焦点陷阱的默认按钮规则；文本输入和 textarea 保留原生 Enter 行为，只有明确的 submit/primary action 才会触发。

## 验证

- `tests/unit/dialog-escape-stack.test.ts`：新增序列弹窗优先级回归；
- `tests/unit/plugin-input-capture-renderer.test.ts`：更新完整空快照契约；
- 两个定向测试文件共 16/16 通过；
- 目标文件 ESLint 通过；
- `npm run typecheck` 通过；
- `git diff --check` 通过。

整项仍保留待人类验收，需在真实窗口中确认永久删除、导入/序列、移动/恢复、设置等模态层的初始焦点、Enter 默认动作和 Esc 关闭行为。
