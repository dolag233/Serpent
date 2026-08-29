# 2026-08-02 Windows 关闭生命周期开发记录

## 问题

Windows 使用 Renderer 自绘标题栏。产品期望点击关闭按钮后隐藏主窗口，但 Serpent 继续驻留在 Windows 通知区域；此前实现把关闭误做成了退出，导致通知区域没有可恢复入口。

## 实施

- Windows 自绘关闭按钮改为隐藏 `BrowserWindow`，主进程继续运行。
- 新增 Windows `Tray`：单击/双击托盘图标恢复窗口，右键菜单提供显示窗口和退出应用；语言切换会同步托盘菜单。
- portable 打包额外携带 `app.png` / `app.ico`，托盘图标不依赖安装器注册。
- `before-quit` 完成 Worker 清理后使用 `app.exit(0)` 结束从托盘发起的已授权退出流程，避免再次进入 quit 生命周期。
- macOS 继续使用 `BrowserWindow.close()`，保留关闭最后一个窗口但应用进程继续运行的原生语义。
- 新增平台策略函数、Windows 托盘模块和 Windows 生命周期 E2E（在非 Windows 平台自动跳过）。

## 验证

- `npm run typecheck`：通过（主工程与扩展工程 TypeScript 检查均通过）。
- `npm run lint`：通过。
- `npx vitest run --config vitest.config.ts tests/unit/window-controls.test.ts`：通过，1 个文件、5 个测试。
- `node scripts/run-e2e.mjs tests/e2e/process-lifecycle.test.ts --grep "Windows custom close" --reporter=line`：通过，窗口隐藏且进程保持运行，1 个测试通过。
- 本地 Windows packaged 构建：`npm run package` 在 `SERPENT_MEDIA_SKIP_PROVENANCE=1` 下完成；`npx playwright test tests/e2e/packaged-startup.test.ts --grep "packaged Windows close" --reporter=line` 通过，1 个测试通过。该构建仅用于本地行为验证，不是发布包。
- packaged 输出确认包含 `out/Serpent-win32-x64/resources/app.png` 与 `app.ico`。
- 用户在 Windows portable 构建上实际点击关闭、查看通知区域、恢复窗口并退出，验收通过。
- 未跳过门禁的 `npm run package` 仍会因项目现有 Windows 媒体发布来源证明缺失而阻断。
