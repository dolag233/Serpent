# 视频 AI 接触表失败修复记录

> 日期：2026-08-09  
> 分支：`dev`  
> 基线：`1436232`  
> 状态：接触表生成与视频 AI 分析已在当前 `npm start` 开发实例完成真实端到端验证；父工单 `Serpent-6w40` 待收口。

## 问题与根因

视频右键执行 AI 分析时显示“AI 分析失败”。根因已由交接确认：FFmpeg `drawtext`
filtergraph 中的 `%{pts:hms}` 冒号没有在运行时转义，导致 FFmpeg 以 exit 234
退出，`contact_sheet` 任务失败，AI 分析拿不到必需的接触表。

本次保留根因修复：源码中的 filter 现在使用 `%{pts\\:hms}`，运行时传给 FFmpeg
的是 `%{pts\:hms}`。接触表失败时同时保留 `[CONTACT-SHEET-FFMPEG-ERR]` 末尾 stderr，
方便区分媒体生成失败与供应商请求失败。

进一步复现发现，旧失败并不是只靠修正 filter 就会自动恢复：已有 `video_poster` 的
视频不会再次经过“生成海报后顺带生成接触表”的路径，而失败的 `contact_sheet`
artifact 又会阻止同名任务重入队。因此 AI 门控看到的必需 artifact 数量不足，直接回退
为同步分析失败，既没有创建 `ai.video.analysis` job，也没有发出供应商请求。

## 变更

- `src/worker/library-service.ts`：修正 `drawtext` 时间码转义并保留 FFmpeg 诊断输出。
- `src/worker/library-service.ts`：启动缩略图队列时，为已有 ready `video_poster` 但缺少
  ready `contact_sheet` 的视频独立补入接触表任务，使历史失败和缺失 artifact 可恢复。
- `src/worker/derived-artifact-repair.ts`：把 `contact_sheet` 纳入派生 artifact repair，
  失败接触表会按 retry policy 失效并重新入队。
- `tests/worker/video-exr.test.ts`：同步 mock 参数断言。
- `tests/worker/derived-artifact-repair.test.ts`：覆盖 ready video poster + failed contact
  sheet 的失效与重新入队。
- `tests/worker/video-contact-sheet.real.test.ts`：新增可选真实视频回归；通过公开 API
  读取 ready artifact，使用 `sharp` 解码并校验最长边不超过 2048，避免访问私有
  `LibraryService` 状态。
- Beads：登记后续 bug `Serpent-nifb`，跟踪回收站源文件缺失导致 FFmpeg exit 254。

## 验证证据

- `npm run typecheck`：通过。
- `npx eslint src/worker/library-service.ts tests/worker/video-contact-sheet.real.test.ts`：通过。
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/video-exr.test.ts tests/worker/ai-video.test.ts`：57/57 通过。
- `TEST_VIDEO=<真实 12 秒 MP4> SERPENT_FFMPEG_PATH=resources/ffmpeg/darwin-arm64/ffmpeg SERPENT_FFPROBE_PATH=resources/ffmpeg/darwin-arm64/ffprobe node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/video-contact-sheet.real.test.ts`：1/1 通过；真实 bundled FFmpeg 生成接触表，`sharp` 成功解码，最长边校验通过。
- 开发态 `npm start` Computer Use：重启当前开发实例后，历史缺失接触表的视频自动产生
  8 个 `generate_contact_sheet` job，全部 `succeeded`；目标视频的 `contact_sheet`
  artifact 为 `ready`。
- 同一实例右键目标视频点击“AI 分析”：UI 显示「AI 分析完成。」；数据库新增
  `ai.video.analysis` job（`succeeded`，2026-08-09T02:07:39Z–02:07:41Z），
  `ai_content` 新增 `qwen3-vl-flash` 的 description/rating（2026-08-09T02:07:41Z）。
- `npm start` 终端仍有既存 React warning：`MenuSurface` 列表子项缺少 `key`；与本次
  视频 AI 失败路径无关。
- `git diff --check`：通过。

## 未完成与风险

- `npm run lint` 仍被既存 `src/renderer/offscreen-thumbnail/page-renderer.ts:237`
  的未使用 `directions` 错误阻断；本次改动没有触及该文件。
- `Serpent-nifb` 单独跟踪回收站视频源文件缺失的 exit 254 场景。
