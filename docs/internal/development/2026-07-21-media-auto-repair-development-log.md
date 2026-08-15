# MEDIA-003 — 媒体环境恢复后的历史预览自动修复

> 状态：automated-verification
> 开始时间：2026-07-21
> 最后更新：2026-07-21

## 目标

资产导入时如果 FFmpeg/ffprobe 或 OpenImageIO 不可用，预览生成会留下
`FFMPEG_REQUIRED` / `OIIO_REQUIRED` 的失败 artifact。用户补齐运行环境后，
重新打开资源库或再次触发媒体调度时，不应逐项手动点击「重试生成」。

## 行为边界

- 只自动修复明确表示“外部媒体组件缺失”的当前 revision 失败：
  `FFMPEG_REQUIRED` 和 `OIIO_REQUIRED`。
- Worker 在自动重排队前探测对应组件；FFmpeg 组件要求 `ffmpeg` 与同目录
  `ffprobe` 都能启动，OIIO 组件要求 `oiiotool` 能启动。
- 自动修复会重置同一 revision 的失败媒体任务并重新入队；旧失败 artifact
  由正常生成路径在真正生成前失效，保留历史记录。
- 一个资源库会话中每个组件只触发一轮自动修复，避免坏的/不兼容的二进制
  在可见范围刷新时形成无限重试。组件探测失败有 30 秒负缓存，避免每个
  可见区请求同步启动子进程；关闭资源库后下一次打开允许重新检测。
- 损坏源文件、不支持格式、编码器/滤镜不兼容等非组件错误继续保持失败，
  只能通过显式重试处理。
- 自动修复范围是当前 revision 的 `thumbnail` / `video_poster` 失败；仅有
  `extracted_metadata` 的组件失败不会伪装成预览修复，仍由后续显式任务处理。

## 实现入口

- `src/worker/library-service.ts`
  - `defaultMediaComponentProbe`：真实探测 FFmpeg/ffprobe/OIIO。
  - `availableAutoRepairComponents`：筛选当前 revision 的可自动修复错误。
  - `enqueueFailedMediaRepairs`：批量重置旧失败任务或创建新任务。
  - `enqueueThumbnailJobs({ repairFailed: true })`：与已有启动/可见/预览
    调度汇合，正常缺失缩略图的启动上限仍保持 50。
- `src/worker/index.ts`：所有普通缩略图场景带上自动修复标志；队列本身仍由
  原有的原子 claim 和并发控制负责执行，探测失败由 Worker 级负缓存限流。
- `tests/worker/video-exr.test.ts`：覆盖“首次缺 FFmpeg/OIIO → 完全关闭 →
  组件可用后重开 → 自动入队并生成预览”、非组件失败不自动重试，以及缺失
  组件探测不在每个可见区请求中重复执行。

## 重要决定

没有把所有 `failed` artifact 直接改成可重试。那会把损坏文件和不支持格式
变成启动循环，也会掩盖真实失败原因。自动修复只消费明确的组件缺失错误，
并将环境探测作为测试可注入 seam，避免 Worker 测试依赖本机二进制。

## 验证记录

- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts
  tests/worker/video-exr.test.ts`：37/37 passed。
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts
  tests/worker/thumbnails.test.ts`：38/38 passed。
- `npx eslint src/worker/library-service.ts src/worker/index.ts
  tests/worker/video-exr.test.ts tests/e2e/media-preview.test.ts`：通过。
- `git diff --check`：通过。
- 交叉审查：Composer 2.5 Standards / Spec 两轴完成；无数据损坏级阻断项。
  根据审查修复了缺失组件探测热路径阻塞/重复探测、补充自动修复入队诊断
  和 OIIO 会话去重断言。Electron E2E、Windows/packaged 和人类验收仍未执行。
- 新增 `tests/e2e/media-preview.test.ts` 的完整进程重启自动修复旅程；
  当前 Windows 工作树运行该文件时 Electron 在启动阶段拒绝
  `--remote-debugging-port=0`，所以该 E2E 记为阻断/未验证，不得写成通过。
- `npm run test:worker`（修正后当前运行）：**641 passed / 4 skipped**，
  exit code 0；总计 33 个 test files（32 passed / 1 skipped）。此前一次运行
  曾触发既有 `library-import-export-soak.test.ts` 的 20k ZIP 导入性能阈值，
  本次重跑通过但该网络共享盘性能波动仍作为未关闭风险保留，不能把一次重跑
  视作性能问题已关闭。
- 全量 `npm run typecheck` 当前仍被既有
  `tests/unit/free-port.test.ts` 缺少 `scripts/free-port.mjs` 类型声明阻断；
  全量 `npm run lint` 当前仍有既有 AI 配置/连接文件的 3 个规则错误。
- 最终验证结果写入 `docs/internal/qa/2026-07-21-media-auto-repair-qa-report.md`。
本回合的 Windows 真实 Electron 操作和 Computer Use 证据尚未执行，不能替代
用户本人对 `MEDIA-003` 的验收。

## 当前风险

- Windows、packaged app 和发布媒体 bundle 仍需独立验证；仓库规则明确不能把
  当前 Windows 开发态自动化结果写成平台完成。
- `bd ready --json` 在当前 PowerShell 环境中不可用（`bd` 不在 PATH），本次
  无法同步 beads 工单认领状态。
