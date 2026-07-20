# 2026-07-20 文本输入原生编辑右键菜单（Serpent-d8u）

## 目标

Windows / macOS 上对 `input` / `textarea`（及 contenteditable）右键弹出平台原生编辑菜单：撤销、剪切、复制、粘贴、删除、全选；启用态随选区 / readOnly / disabled 变化；不与资产/文件夹 React 右键菜单冲突。

## 方案

- Renderer（sandbox）在 capture 阶段识别可编辑文本控件，`preventDefault` + `stopPropagation`，并关闭已打开的 React context menu。
- 仅通过 preload `shell.showEditContextMenu({ x, y })` 把坐标交给 Main。
- Main 校验 sender 为主窗口后，用 Electron `role` 构建原生 Menu 并 `popup`；文案与快捷键由 Electron 按平台填充，启用态由 focused editable 状态决定。
- Renderer 不发送菜单动作或选区载荷，避免任意命令注入。

## 实现位置

| 层 | 文件 |
| --- | --- |
| 共享协议/检测 | `src/shared/edit-context-menu.ts` |
| 通道 | `src/shared/protocol/channels.ts`（`SHOW_EDIT_CONTEXT_MENU_CHANNEL`） |
| Main | `src/main/edit-context-menu.ts` + `src/main/index.ts` IPC |
| Preload | `src/preload/index.ts` |
| Renderer host | `src/renderer/edit-text-context-menu.tsx`（挂在 `ContextMenuProvider` 内） |
| 单测 | `tests/unit/edit-context-menu.test.ts` |

## 人类验收

见 `docs/qa/human-acceptance-checklist.md` → **MENU-024**。
