# 2026-08-14 Windows 浏览快捷键（Serpent-g8u9）

> 状态：实现中，待 Windows 真机复验  
> 关联：COMMAND-002 / COMMAND-005 / SHORTCUT-001

## 用户反馈

第一次代码修复（仅 `code`/`keyCode` 回退 + capture 派发）后，Windows 复验：

- F2 完全无效（资产与文件夹）
- Delete 完全无效
- Ctrl+C、Ctrl+Shift+C、Ctrl+F、F5 有效
- Ctrl+V 有问题，另议

产品口径补充（后一次纠正）：

- 链接文件夹与托管文件夹在操作上同等。
- 删除文件/文件夹默认进回收站，**不弹确认**。托管进应用回收站；链接进系统回收站。
- 「从库中移除」只取消索引、不碰磁盘，是另一条动作，可保留确认。
- Shift+Delete / 从硬盘删除仍为永久删除，保留确认。

## 根因

1. 浏览键盘把 F2/Delete 限成 `locationKind === "managed"`。链接库里 Ctrl+C 仍能复制（不过滤托管），F2/Delete 则静默无操作。这与「C 有用、F2/Delete 没用」的报告一致。
2. Windows 无边框壳把应用菜单设为 `null` 后，F2/Delete 没有系统级快捷键通道。视频查看器 D/F/X/C 已经用隐藏菜单解决同类问题（VIEWER-018）。
3. 链接删除原先是独立命令 + `DeleteLinkedDialog` + 主进程危险确认（「删除链接资产源文件？」）。即使用户按 Delete，也会先弹出「仅删记录 / 同步删磁盘」选择，再弹原生永久删除确认。这与「链接与托管同等、默认回收站、不确认」冲突。

「加速键」= Electron 菜单项上绑定的快捷键。Windows 上看不见菜单栏，但仍可保留隐藏菜单，让系统把 F2/Delete 交给应用。

## 实现

- F2 重命名：任意可用、未删除资产（托管或链接）。Worker 本就可改链接文件名。
- Delete：托管 → 应用回收站；链接文件 → `deleteLinkedAssets({ deleteSourceFile: true })` 进系统回收站，无对话框；链接文件夹（含子树与根）→ `deleteLinkedFolderSubtree(..., deleteFromDisk: false)` 进系统回收站，无 `window.confirm`。
- 已删除功能代码，不只改菜单文案：`DeleteLinkedDialog`、`asset.delete-linked` 渲染层命令、Escape 栈层、i18n 对话框文案、主进程 `asset-linked-source` 危险确认。Worker 协议 `asset.delete-linked` 仍保留，供回收站删除与测试/恢复路径使用；渲染层不再提供「仅删记录」入口。
- 「从库中移除」仍走 `removeLinkedFolder`，确认保留。
- Windows：隐藏菜单绑定 F2 / Delete / Shift+Delete；输入框/对话框/查看器期间禁用，避免搜索框 Delete 删资产。主进程 `before-input` 作回退，渲染层 120ms 去重。

## 验证

定向单测：`browse-key-command`、`browse-keyboard-shortcuts`、`folder-shortcut-dispatch`、`shortcut-matcher`、`asset-commands`、`sidebar-commands`。

E2E `linked-folders` 改为右键「移入回收站」、断言无确认框、源文件离开磁盘。未在本回合前台跑 Electron E2E（会抢窗口）。Ctrl+V 不在本回合。
