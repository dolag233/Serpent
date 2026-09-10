# 插件对话框打开后无法输入（切窗口后才能输入）

## 问题

从资源卡片右键打开批量重命名后，输入框无法打字，点击也没有光标。切到其他 Windows 窗口再切回来就 100% 可以输入。安装插件后当场打开不行；完全退出再开、且不再走原生选择器，就可以。

## 根因

Windows 原生文件框关掉后，Electron 仍报告 `BrowserWindow.isFocused() === true` 且 `webContents.isFocused() === true`，但渲染页 `document.hasFocus()` 一直是 `false`。

第四次实测（`SetForegroundWindow` 抢顶层窗口之后）日志：

- Main：`stolenForeground: true`，`windowFocused: true`，`webContentsFocused: true`
- Renderer：每次点击仍是 `hasFocus: false`，`active` 已是 `input#prefix`

把 `SetFocus` 打在无边框外壳 `Chrome_WidgetWin_*` 上，键盘进了窗口壳，进不了 Chromium 真正收 `WM_CHAR` 的子窗口 `Chrome_RenderWidgetHostHWND`。鼠标命中页面，所以有 `pointerdown`、没有 caret。Alt-Tab 会重新激活这个子窗口。每次点击再抢一次顶层 HWND，等于一直把焦点抢错。

## 修复

- `windows-foreground.ts` 遍历子 HWND，只对 `Chrome_RenderWidgetHostHWND` 做 `SetFocus`，不再 `SetFocus` 顶层外壳。
- 原生对话框 / 插件对话框打开时：如果窗口已经 `isFocused()`，先 `blur()` 再激活（让 Chromium 收到 `WM_ACTIVATE`，等价于一次微型 Alt-Tab）。
- 渲染进程不再在每次 `pointerdown` 上抢前台；只在打开后延迟一次，且有冷却，避免和 Main 的 blur 周期对打。
- 会话日志会多 `renderWidgetFound`、`focusedClass`、`Renderer document focus after steal`（`documentHasFocus`）。

工单 `Serpent-e3fe21` 已关闭。验收 `PLUGIN-054`：2026-09-10 用户确认安装后当场可输入。临时探针已删除。

## 验证

- `tests/unit/windows-foreground.test.ts`
- `tests/unit/renderer-keyboard-focus.test.ts`
- `tests/unit/plugin-ui-dialog-focus.test.ts`（17 passed）
- 2026-09-10 用户在同一进程里走完原生选择器后打开批量重命名，确认可打字。
