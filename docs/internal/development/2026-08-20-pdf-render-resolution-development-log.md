# PDF 查看器缩放与窗口尺寸清晰度

日期：2026-08-20
工单：`Serpent-c27316`
关联验收：`VIEWER-030`

## 问题与根因

用户反馈 PDF 放大后发虚：查看器的缩放标签和页面 CSS 盒先切换到新尺寸，但上一轮 canvas 位图仍被拉伸到新盒子，造成 CSS 像素尺寸超过位图实际采样分辨率。快速连续缩放时，多个旧的 PDF.js 渲染任务还会继续完成，进一步让中间缩放的位图短暂覆盖当前视图。

窗口或面板尺寸变化也存在同一类风险：旧的 canvas 可以被重新布局到新的页面宽度，却没有按新宽度重新栅格化。

## 修复

- 缩放/尺寸变化时保留旧页作为过渡占位，但保持旧页原有 CSS 盒；只有目标缩放和尺寸的 canvas 完成后才原位替换，避免旧位图被放大后发虚，也保留无白屏切换。
- 使用 `ResizeObserver` 配合 `requestAnimationFrame` 合并宿主宽度变化，按新的 CSS 内容宽度和 `devicePixelRatio` 重新创建 PDF.js canvas 位图。
- 目标变化时取消上一轮仍在进行的 `RenderTask`，避免过时缩放任务继续消耗资源或覆盖最新视图。
- 回归测试把“可见 canvas 位图宽度 / CSS 宽度 / DPR 不低于 0.95”作为不变量，并覆盖工具栏缩放、Ctrl+滚轮、连续放大、拖拽平移和窗口变宽后的重新栅格化。

## 四列证据

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 放大后当前可见页不使用低于当前 CSS 尺寸的位图 | `src/renderer/PdfViewerSurface.tsx`：旧页过渡占位、目标 RenderTask、DPR 采样 | `tests/e2e/document-preview.test.ts`：125%、141%、344% 缩放后的分辨率断言 | macOS 开发态 Electron E2E 已通过；真实大 PDF 人工观感、Windows、packaged 未执行 |
| 窗口/面板变宽后按新宽度重栅格化 | `src/renderer/PdfViewerSurface.tsx`：宿主宽度 ResizeObserver | 同一 E2E：恢复 100% 后扩大窗口，校验页面 fit 宽度和 canvas/DPR 比例 | macOS 开发态 Electron E2E 已通过；真实窗口拖拽、Windows、packaged 未执行 |
| 连续缩放不让过时渲染任务覆盖当前页面 | `src/renderer/PdfViewerSurface.tsx`：RenderTask 集合与 cleanup cancel | 同一 E2E：连续 4 次工具栏放大后仍满足分辨率不变量 | macOS 开发态 Electron E2E 已通过；人工验收待执行 |

## 验证记录

```text
node scripts/run-e2e.mjs tests/e2e/document-preview.test.ts
# 4 passed (11.2s)

npx vitest run --config vitest.config.ts tests/unit/pdf-viewer-layout.test.ts
# 1 file / 4 passed

npx eslint src/renderer/PdfViewerSurface.tsx tests/e2e/document-preview.test.ts
# 0 errors

npm test
# 446 passed / 12 skipped / 5 failed test files; 3916 passed / 19 skipped / 6 failed tests.
# 失败集中在视频编码探针、webm 代理、ffmpeg lavfi 夹具、macOS 临时路径比较和 IME 对话框，PDF 相关测试无失败。
```

回归断言在修复前稳定复现：连续放大到 344% 时分辨率比约为 `1.5989`，而当前 Electron 的 DPR 为 `2`；修复后同一断言通过。

未执行 `npm run test:library-availability`：本次没有修改资源库 Worker、数据库或资源库协议。`npm run typecheck` 仍被仓库已有的 `tests/unit/ticket-script.test.ts` 对 `*.mjs` 的 4 个声明错误阻断；Windows、packaged 和 Computer Use 人工验收未执行。
