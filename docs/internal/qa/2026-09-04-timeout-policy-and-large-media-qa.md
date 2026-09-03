# 超时策略与超大媒体 QA 报告

## 范围

验证 Issue #28 关联的本地大媒体导入、缩略图、查看器和后台媒体调度；审查本地资源处理是否因源大小、像素、导入数量或机器配置被任意墙钟截止。

## 四列追溯

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 本地 Worker 请求等待真实结果，不因默认 wall-clock deadline 失败 | `src/main/worker-client.ts` / `src/main/library-request-broker.ts` | `tests/unit/worker-client.test.ts`；相关定向 5 files / 156 tests 通过；租约等待回归 3 files / 26 tests 通过 | Computer Use 导入并打开大 TGA 未出现请求超时；Windows、packaged 未执行 |
| OIIO/FFmpeg/Sharp 本地媒体处理不因源字节数或像素数预拒绝 | `src/worker/library-service.ts` / `src/worker/media-memory-budget.ts` / `src/shared/media-concurrency.ts` | `tests/worker/video-exr.test.ts`、`tests/worker/thumbnails.test.ts`；资源库门禁 210 项通过 | 8192×8192 TGA 真实 OIIO 调用、缩略图和查看器通过；其他超大格式矩阵未完整人工执行 |
| 模型/文档离屏渲染和视频查看重试不使用任意完成截止 | `src/worker/index.ts` / `src/main/offscreen-thumbnail-renderer.ts` / `src/main/document-thumbnail-renderer.ts` / `src/renderer/AssetPreviewModal.tsx` / `src/renderer/media-retry.ts` | 文档/TIFF Electron 回归 5/5；协议和 renderer 定向测试包含在本轮回归 | PDF、HTML、TIFF Electron 路径通过；模型、大视频和 Windows 未执行 |
| 启动媒体场景不因首屏迟到被 8 秒/15 秒硬放行 | `src/worker/index.ts` / `src/worker/startup-burst-gate.ts` | `tests/unit/startup-burst-gate.test.ts`；定向通过 | 真实大库启动专项未执行；启动门闩无独立 GUI 证据 |

## 命令与结果

- `npm run lint`：通过。
- `npm run typecheck`：通过。
- `npx vitest run --config vitest.config.ts tests/unit/startup-burst-gate.test.ts tests/worker/video-exr.test.ts tests/worker/thumbnails.test.ts tests/unit/media-retry.test.ts tests/unit/worker-client.test.ts`：5 files / 156 tests passed。
- `npx vitest run --config vitest.config.ts tests/worker/library-write-coordinator.test.ts tests/unit/startup-burst-gate.test.ts tests/unit/worker-client.test.ts`：3 files / 26 tests passed；新增回归证明默认省略 `timeoutMs` 时会持续等待租约释放。
- `npm run test:library-availability`：9 files / 210 tests passed。
- `npm run pretest:e2e && node scripts/run-e2e.mjs tests/e2e/document-preview.test.ts tests/e2e/tiff-image-preview.test.ts`：5 tests passed。
- Computer Use：隔离临时资源库导入 192.0 MB、8192×8192 TGA；卡片缩略图、Inspector 预览、自动色卡和全分辨率查看器均出现，未显示超时失败。测试库已清理。
- 最终 `npm run test`：508 files passed / 15 skipped，4384 tests passed / 25 skipped；`npm run test:perf:search`：1 file / 5 tests passed。此前单独运行出现过一次 reconciliation P95 83.8ms > 75ms，但最终 verify 重跑通过，仍不把一次重跑当成性能稳定性证明。
- 最终 `npm run verify:mainline` 的全量 Electron E2E：83 passed / 3 skipped / 3 failed。失败为两项 `folder-context-menu` 缩进断言（期望 21、实得 7）和一项 `plugin-management` 启用状态断言；TIFF、媒体预览和文档预览相关用例通过，以上失败不是本轮超大媒体超时路径。

## 保留的边界

应用/Worker ready 与 shutdown、用户取消后的子进程终止兜底、远端下载与供应商/插件/脚本隔离、SQLite busy/租约和测试调度计时仍保留。媒体任务 lease 只用于崩溃恢复与 fencing，不用于以固定时长判定媒体完成失败。

## 结论

本轮 macOS 开发态和定向自动化证据支持“本地大媒体不再因任意完成超时失败”。`verify:mainline` 的单测/搜索性能门禁通过，但全量 Electron E2E 仍有 3 个非本轮路径失败；Windows、packaged、真实大型库和用户正式验收尚未完成，不能标记为全平台/全套验收通过。
