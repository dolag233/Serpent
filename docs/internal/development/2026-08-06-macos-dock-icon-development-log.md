# macOS Dock 图标尺寸开发记录

## 工单与范围

- 工单：`Serpent-o71z`
- 用户反馈：macOS 底部 Dock 中 Serpent 图标比正常图标大一圈，Windows 正常。
- 当前状态：实现完成，待人类验收；packaged 与 Windows 尚未执行。

## 根因

macOS 启动流程中的 `applyDevAppIcon()` 通过 `appIconImage()` 读取
`assets/icons/app.png` 并调用 `app.dock.setIcon()`。PNG 主图的 artwork 贴近
1024×1024 画布边缘，直接作为 Dock 图标时显示偏大。仓库已有 `app.icns` 可供
Forge 打包器使用，但 Electron 运行时的 `nativeImage.createFromPath()` 对该 ICNS
资源返回空图，不能直接用于 `app.dock.setIcon()`。

## 实现

- `scripts/generate-app-icons.mjs` 新增 `app-dock.png`：将主图缩小到 896×896，
  在 1024×1024 透明画布中居中，保留 macOS Dock 的安全边距。
- 新增 `src/main/app-icon-paths.ts`，集中定义平台与开发态/打包态的资源优先级：
  - macOS 运行时：`app-dock.png` → `app.png`；
  - Windows 打包态：保持 `app.png` → `app.ico`。
- `src/main/app-icon.ts` 使用该路径解析，开发态与打包态 macOS Dock 均优先读取
  带安全边距的 PNG。
- `forge.config.ts` 将 `app-dock.png` 纳入 `extraResource`；`app.icns` 仍由
  `packagerConfig.icon` 作为 macOS 安装包图标来源。
- 新增 `tests/unit/app-icon-paths.test.ts`，覆盖 macOS 开发态、macOS 打包态及
  Windows 回退顺序。

## 验证

已执行：

```text
npm run icons:generate
npx vitest run tests/unit/app-icon-paths.test.ts
npm run typecheck && npm run lint
```

`nativeImage.createFromPath("assets/icons/app.icns")` 实测 `empty=true`，确认 ICNS
不适合作为 Electron 运行时 Dock 输入。Dock 的实际尺寸仍需用户在 macOS Dock 中
观察；Computer Use、当前 HEAD packaged 构建和 Windows 尚未执行。

