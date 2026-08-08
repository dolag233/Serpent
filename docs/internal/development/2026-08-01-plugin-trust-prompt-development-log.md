# 2026-08-01 库插件被动信任提示

## 范围

工单 `Serpent-c2rm`：当本机发现**尚未信任**的资源库级插件时，弹出平静对话框，不限于「打开新库」。

触发面（同一抽象）：

- 打开 / 切换到含未信任库插件的资源库
- 窗口重新获得焦点或页面变为可见（覆盖在 `{库}/.serpent/plugins/` 磁盘复制插件后回到应用）
- 显式 `refresh()`（设置页关闭后依赖 suppress 解除再扫）

## 行为

- 仅提示 `awaiting-trust` + `reason: untrusted` + `selection: use-library`
- 已 `denied` 的不打扰
- 「稍后」：本会话 sessionStorage 记住 package 键，避免重复弹
- 「在设置中查看」：仅隐藏弹窗，不写入稍后记录
- 设置 → 插件 已打开时不叠弹窗
- 不阻塞开库；信任走现有 `plugin-manager.trust`

## 文件

- `src/renderer/plugin-trust-prompt.ts` — 收集与 session dismiss
- `src/renderer/use-plugin-trust-prompt.ts` — 扫描钩子
- `src/renderer/PluginTrustPromptDialog.tsx` — UI
- App Escape 栈接入 `dismiss-plugin-trust-prompt`

## 人类验收

`PLUGIN-007`
