# 2026-09-03 超时策略与超大媒体处理开发日志

## 范围

- 修复 Issue #28 暴露的本地资源操作被 Main↔Worker 请求超时误判的问题。
- 审查图片预览、查看器、OIIO/FFmpeg 子进程、模型/文档渲染和媒体队列中的硬截止。
- 重点覆盖超大 TGA：不按源文件字节数、像素数、导入数量或机器配置拒绝本地资源。

## 初始状态

- 分支：`codex/timeout-policy-audit`。
- 基线：当前工作树既有主题/标签改动保留不动；本切片只提交本日志、对应源码和测试。
- 已发现的直接根因：`asset.import-linked` 不在无界本地命令集合中，仍使用 Main 侧 15 秒请求计时；OIIO 缩略图还存在输入安全门槛和 60 秒子进程截止。

## 策略

本切片将“超时”分为两类：

1. 本地资源处理的硬失败计时（Worker RPC、OIIO/FFmpeg、预览生成）不代表资源损坏或用户操作失效，改为等待完成，或只由明确的取消/应用关闭信号终止。
2. 网络下载、插件/脚本隔离、应用关闭清理和测试轮询等边界计时属于安全/生命周期控制，单独审查，不因本地大文件反馈而删除。

本地媒体仍允许在操作系统报告真实资源压力、解码器不支持或源文件不可读时失败；这些是实际执行结果，不是预先猜测资源大小或硬件能力。

## 回归测试

- Worker Client：`asset.import-linked` 不再有 Main 侧 wall-clock deadline。
- Worker OIIO：8192×8192 的大型 TGA 走真实 OIIO 调用 seam，不因尺寸拒绝，且生成调用不注入默认 wall-clock timeout。
- 本地媒体请求、OIIO/FFmpeg、Sharp、模型/文档离屏渲染、查看器代理重试均以实际完成、用户取消或应用生命周期结束为边界；不再以源字节数、像素数、导入数量或机器配置推断失败。
- OIIO 卡片输出使用 `--fit 512x512`，只约束派生缩略图的展示尺寸，不约束源文件；查看器仍走源图的完整解码路径。
- 启动缩略图场景和启动后台对账采用首个成功浏览事件驱动，不再用可见性 8 秒或启动突发 15 秒硬上限放行；资源库关闭仍会取消待处理工作。
- 保留的计时均属于边界控制：应用/Worker ready 与 shutdown、用户取消后的子进程 SIGKILL 兜底、远端下载/供应商/插件/脚本隔离、SQLite busy/租约和测试调度。媒体任务 60 秒 lease 是崩溃恢复与 fencing，不是媒体完成超时。

## 证据

- `npx vitest run --config vitest.config.ts tests/unit/startup-burst-gate.test.ts tests/worker/video-exr.test.ts tests/worker/thumbnails.test.ts tests/unit/media-retry.test.ts tests/unit/worker-client.test.ts`：5 files / 156 tests passed。
- 补充 `LibraryWriteCoordinator` 默认无界等待回归：`npx vitest run --config vitest.config.ts tests/worker/library-write-coordinator.test.ts tests/unit/startup-burst-gate.test.ts tests/unit/worker-client.test.ts`：3 files / 26 tests passed；覆盖持有者释放后继续获取租约，不因默认计时器失败。
- `npm run lint`：通过；`npm run typecheck`：通过。
- `npm run test:library-availability`：9 files / 210 tests passed。
- `npm run pretest:e2e && node scripts/run-e2e.mjs tests/e2e/document-preview.test.ts tests/e2e/tiff-image-preview.test.ts`：5 tests passed；其中 PDF/HTML 文档和 TIFF 查看器均通过。
- Computer Use：在隔离临时资源库中导入用户提供的 192.0 MB、8192×8192 TGA；卡片缩略图、Inspector 预览、色卡和查看器均实际出现，未出现预览生成失败/查看失败提示。测试库已清理。
- 最终 `npm run test`：508 files passed / 15 skipped，4384 tests passed / 25 skipped；`npm run test:perf:search`：1 file / 5 tests passed。此前单独运行出现过一次 reconciliation P95 83.8ms > 75ms，但最终 verify 重跑通过，仍不把一次重跑当成性能稳定性证明。
- 最终 `npm run verify:mainline` 的全量 Electron E2E 为 83 passed / 3 skipped / 3 failed：两项 `folder-context-menu` 的缩进断言（期望 21、实得 7）来自既有 UI 工作树差异，另有一项 `plugin-management` 启用状态断言失败；TIFF、媒体预览和文档预览相关用例通过。故 verify 未全绿，且这些失败不是本轮超大媒体超时路径。
- 独立 Luna 扫描复核了媒体相关 timeout/size/deadline 命中：固定视频确认等待、文档 400ms sleep、启动缩略图 8 秒上限已处理；媒体 lease 保留为恢复安全边界。Windows、packaged 和用户正式验收仍未执行。

## 当前状态

实现与本轮 macOS 开发态验证完成；全量测试仍受单个性能阈值波动影响，不能宣称全套通过。Windows、packaged 和用户正式验收待后续执行。
