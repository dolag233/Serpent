# 2026-07-18 macOS 红绿灯内嵌顶栏（Serpent-4ze）

## 实现

- Main：`darwin` 下 `titleBarStyle: hiddenInset` + `trafficLightPosition`
- Renderer：`body.platform-darwin .toolbar-leading { padding-left: 78px }`
- Windows 窗口配置不变

## 验收

**SHELL-015**（仅 macOS）
