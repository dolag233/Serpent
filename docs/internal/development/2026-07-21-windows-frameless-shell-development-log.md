# 2026-07-21 Windows 无边框一体壳（Serpent-znex）

## 产品决定

Windows 去掉系统标题栏与 File/Edit/View/Window 菜单栏；在顶栏右上角自绘最小化 / 最大化·还原 / 关闭，表现接近原生，与 macOS SHELL-015 红绿灯内嵌形成平台对称。

`Serpent-j5x`（Windows 菜单本地化）在 Windows 侧改为「隐藏 menu bar」，由本工单阻塞。

## 实现

- Main：`win32` 使用 `titleBarStyle: "hidden"`；`Menu.setApplicationMenu(null)`；`window-control` IPC + maximize 状态推送
- Preload / `SerpentShellApi`：`windowControl` / `onWindowMaximizedChanged`
- Renderer：`WindowsWindowControls`（独立模块，不内联进 App.tsx）；`platform-win32` 顶栏右侧留白；caption hover/close 红接近 Win 原生
- 顶栏既有 `-webkit-app-region: drag`，空白区可拖移；双击拖区走 Chromium 最大化惯例

## 交叉审查（2026-07-21）

- Standards（grok）：conditional pass → 已修 close 后 `isMaximized`、effect cancelled、`data-platform=windows` 复用、destroyed 守卫。
- Spec（grok）：covered with residual risks（无 HARD 缺口）；双击最大化依赖 Chromium drag 惯例；Win11 Snap Layouts 自绘控件不提供；待 Windows 人类验收 SHELL-024。
- 广度（grok）：macOS 路径未回归；IPC sender 门控 OK。

菜单栏用 `Menu.setApplicationMenu(null)` 而非仅隐藏：避免 View Reload 等仍作为隐形加速键存在。
