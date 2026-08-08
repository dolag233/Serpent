# 视频 AI 接触表失败修复记录

> 日期：2026-08-09  
> 分支：`dev`  
> 基线：`1436232`  
> 状态：接触表生成已修复并完成真实 FFmpeg 验证；云端 AI 请求尚未执行，父工单 `Serpent-6w40` 保持 open。

## 问题与根因

视频右键执行 AI 分析时显示“AI 分析失败”。根因已由交接确认：FFmpeg `drawtext`
filtergraph 中的 `%{pts:hms}` 冒号没有在运行时转义，导致 FFmpeg 以 exit 234
退出，`contact_sheet` 任务失败，AI 分析拿不到必需的接触表。

本次保留根因修复：源码中的 filter 现在使用 `%{pts\\:hms}`，运行时传给 FFmpeg
的是 `%{pts\:hms}`。接触表失败时同时保留 `[CONTACT-SHEET-FFMPEG-ERR]` 末尾 stderr，
方便区分媒体生成失败与供应商请求失败。

## 变更

- `src/worker/library-service.ts`：修正 `drawtext` 时间码转义并保留 FFmpeg 诊断输出。
- `tests/worker/video-exr.test.ts`：同步 mock 参数断言。
- `tests/worker/video-contact-sheet.real.test.ts`：新增可选真实视频回归；通过公开 API
  读取 ready artifact，使用 `sharp` 解码并校验最长边不超过 2048，避免访问私有
  `LibraryService` 状态。
- Beads：登记后续 bug `Serpent-nifb`，跟踪回收站源文件缺失导致 FFmpeg exit 254。

## 验证证据

- `npm run typecheck`：通过。
- `npx eslint src/worker/library-service.ts tests/worker/video-contact-sheet.real.test.ts`：通过。
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/video-exr.test.ts tests/worker/ai-video.test.ts`：57/57 通过。
- `TEST_VIDEO=<真实 12 秒 MP4> SERPENT_FFMPEG_PATH=resources/ffmpeg/darwin-arm64/ffmpeg SERPENT_FFPROBE_PATH=resources/ffmpeg/darwin-arm64/ffprobe node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/video-contact-sheet.real.test.ts`：1/1 通过；真实 bundled FFmpeg 生成接触表，`sharp` 成功解码，最长边校验通过。
- 开发态 `npm start`：已启动并确认视频资产右键菜单存在“AI 分析”；未点击执行云端请求。
- `git diff --check`：通过。

## 未完成与风险

- 本次没有把视频海报/接触表发送到已保存的第三方 AI 端点，因此没有声称云端 AI
  端到端成功；需要用户明确确认外发目标后再做一次代表性 UI 旅程。
- `npm run lint` 仍被既存 `src/renderer/offscreen-thumbnail/page-renderer.ts:237`
  的未使用 `directions` 错误阻断；本次改动没有触及该文件。
- `Serpent-nifb` 单独跟踪回收站视频源文件缺失的 exit 254 场景。
