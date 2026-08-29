# MEDIA-003 QA：媒体环境恢复后的历史预览自动修复

> 状态：QA incomplete
> 日期：2026-07-21
> 分支：`codex/windows-adaptation`

## 范围

验证之前因 FFmpeg/ffprobe 或 OpenImageIO 缺失而失败的当前 revision 预览，
在组件恢复后能自动重新入队并生成；同时验证普通解码失败不会被自动循环
重试。

## 实现与自动化证据

| 需求 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 组件可用后自动修复 `FFMPEG_REQUIRED` / `OIIO_REQUIRED` | `src/worker/library-service.ts`：`availableAutoRepairComponents`、`enqueueFailedMediaRepairs` | `tests/worker/video-exr.test.ts`：自动修复回归 | Windows 真实 Electron 待执行 |
| 非组件失败不自动重试 | `src/worker/library-service.ts`：错误码白名单 | `tests/worker/video-exr.test.ts`：`does not automatically retry a non-component thumbnail failure` | 待人工确认 |
| 单次会话避免重复自动重试、缺失组件探测负缓存 | `src/worker/library-service.ts`：`autoRepairAttemptedByLibrary`、`autoRepairProbeFailedAtByLibrary` | `tests/worker/video-exr.test.ts`：会话去重与 probe throttle | Windows/packaged 待执行 |
| 自动修复入队可观测 | `src/worker/library-service.ts`：`media-auto-repair.enqueued` diagnostic | 定向 Worker 回归覆盖入队主路径；日志结构需真实 Electron 复核 | Windows/packaged 待执行 |

自动修复只覆盖当前 revision 的 `thumbnail` / `video_poster` 组件缺失失败；
仅有 `extracted_metadata` 失败不代表预览失败，不在本增量自动重试范围内。

## 命令记录

以下结果会随最终验证更新；未执行或失败的命令不能写成通过：

- `npm run typecheck`：当前工作树存在既有的
  `tests/unit/free-port.test.ts` → `scripts/free-port.mjs` 缺少声明文件错误；
  需区分该基线问题与本次变更。
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts
  tests/worker/video-exr.test.ts`：**37/37 passed**。
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts
  tests/worker/thumbnails.test.ts`：**38/38 passed**。
- `npx eslint src/worker/library-service.ts src/worker/index.ts
  tests/worker/video-exr.test.ts`：**passed**。
- Composer 2.5 Standards / Spec 两轴审查已完成；审查指出的同步探测热路径、
  入队可观测性和 OIIO 会话去重缺口已处理。审查结论仍要求真实 Electron、
  Windows 和人工证据，不能据此标记 accepted。
- `npm run test:worker`（当前修正后运行）：**641 passed / 4 skipped**，
  exit code 0；33 个 test files 中 32 个通过、1 个跳过。此前一次运行曾因
  网络共享盘上的既有 20k ZIP soak 性能阈值失败，本次重跑通过；该性能波动
  仍按验收纪律记录为未关闭风险，不归因于 MEDIA-003。
- `npm run lint`：失败，当前工作树已有 AI 配置/连接文件的 3 个 ESLint
  规则错误，与本功能文件无关。
- `node scripts/run-e2e.mjs tests/e2e/media-preview.test.ts`：未通过。当前
  Windows Electron 启动阶段拒绝 Playwright 注入的
  `--remote-debugging-port=0`（两个既有媒体用例启动失败；新增自动修复用例
  因未配置可用真实 FFmpeg 而跳过），因此真实媒体解码/完整重启证据仍缺失。
- 新增 E2E 旅程：`tests/e2e/media-preview.test.ts` 的
  `repairs a historical video preview after a full process restart`；代码已
  编译并在具备真实 FFmpeg/ffprobe 时才运行，当前环境未得到通过证据。
- `npm run test:e2e`：未执行；媒体子集已先执行并被上述 Electron 启动阻断。
- `npm run verify:mainline`：待当前合流树完成后执行。

## 平台与人工 QA

- Windows 开发态：未执行 Computer Use/真实桌面操作。
- macOS 开发态：未执行。
- packaged app、发布媒体 bundle、Windows 打包：未执行。
- 用户验收入口：`docs/internal/qa/human-acceptance-checklist.md` 的 `MEDIA-003`。

## 结论

当前不能标记为通过或 accepted。自动化修复回归、核心 Electron 旅程和用户
本人操作仍需完成；Windows 媒体与打包风险继续保留。
