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

## 追加：批量导入性能与自动 AI 入队（2026-08-09）

用户继续反馈视频导入后预览异常缓慢、自动 AI 未入队，并明确要求 AI 的视频/3D
视觉输入不得等待浏览用预览图。使用当前 `npm start` Electron 实例创建隔离资源库，按
下载目录修改时间倒序一次导入 10 条 MP4（约 125 MiB，5 秒至 1 分 19 秒，含
1080p/竖屏/60fps）后记录：导入操作本身没有卡住，约 15.8 秒时 10 张卡片均已可见；
但第一个 VP9 WebM proxy 实际耗时约 58.5 秒，期间 10 个 `generate_contact_sheet`
任务全部仍为 queued。

根因不是单张联系表渲染慢：同一 5.005 秒、1920×1080 样本，以当前 bundled FFmpeg
和同一 contact-sheet filter 单独执行为 0.82 秒；同一视频的 poster 单独执行约 1.23
秒。根因是 `runFfmpeg` 将 **ffprobe、poster、contact sheet 和 WebM proxy** 共用一个
全局并发数为 1 的 semaphore，而 queue 又把 proxy priority（100）排在 contact sheet
（-100）之前。两个 queue consumer 都会先进入长 proxy，使联系表和 AI 输入长期饥饿。

本轮实现：

- 全局 FFmpeg/ffprobe 上限调为受控的 4 路；不会无界地拉起媒体进程。
- 视频 metadata 独立成 durable `extract_metadata` job；成功后立即排 `contact_sheet`，
  不再把 poster 当作联系表或 AI 的前置条件。联系表复用该 metadata 的尺寸，避免第二次
  ffprobe。
- `contact_sheet` 和 metadata 优先于 poster/WebM proxy；proxy 仍保留为低优先级后台播放
  派生物。
- 视频 AI 仅读取/上传受 2K 限制的 JPEG 联系表；不读取 video poster。所有供应商 adapter
  使用实际 JPEG MIME，而不是原先错误标成 PNG。
- 联系表 ready 后 Worker 发出内部 `asset.ai-input.ready`，Main 在自动分析开启时才重新入队
  此 asset 并触发 AI scheduler。导入刚结束时的「0 个 ready sheet」不再成为永久漏入队。

自动验证：`npm run typecheck`、本次变更涉及文件的 ESLint、定向 Vitest 覆盖
metadata→sheet 顺序、四路全局 FFmpeg 上限、contact sheet 无 poster 的 AI 入队、只读取联系表
的 AI 输入、Worker→Main ready 协议和现有视频衍生任务恢复，结果 `89/89` 通过；此前同一轮完整
定向回归为 `228/228` 通过。完整 `npm run lint` 仍被基线文件
`src/renderer/offscreen-thumbnail/page-renderer.ts:237` 的未使用 `directions` 阻断。

在当前源码重启后的 `npm start` 实例中再次新建隔离资源库并导入下载目录最新 10 个 MP4：
`extract_metadata`、`generate_contact_sheet`、`generate_thumbnail` 均为 `10/10 succeeded`；
contact sheet 首个完成耗时 `0.971s`，整批最后一个在 `7.994s` 完成。`ai.video.analysis`
为 `10/10 succeeded`，最后一个在 `14.054s` 完成；此时 `generate_webm_proxy` 仍为
`8 queued + 2 running`，说明 AI 只依赖联系表，不等待 proxy。计算后的界面显示 10 张视频卡片、
应用保持响应，未出现导入冻结。

补充基准：对 80 秒 H.264 样本直接使用 FFmpeg `-skip_frame nokey` 抽关键帧约 `0.40s`，
完整顺序解码约 `4.71s`；因此“先生成 VP9/Opus proxy，再从 proxy 做 contact sheet”不是新导入
的更快路径——会先付出完整转码成本，并把 AI 等待时间拉长。当前方案优先从原视频走关键帧快路径，
关键帧不足时回退普通抽帧；若 proxy 已经 ready，未来可复用它，但不应让 contact sheet 依赖 proxy。

## 追加：视频 proxy 默认 H.264（2026-08-09）

用户要求牺牲部分画质换取更快的编码/解码。`generate_webm_proxy` 保留为数据库兼容的派生物
类型，但运行时先探测 FFmpeg 可用的 H.264 编码器，优先生成 H.264/AAC MP4；当前 bundle
无 H.264 编码器或实际编码失败时，回退到实时参数的 VP9/Opus WebM。预览状态会使用实际产物
的 MIME，不再把 proxy 默认写死为 `video/webm`。contact sheet、AI 输入及其队列依赖没有改回
等待 proxy。

使用同一隔离视频样本、同一 720px 缩放与 1Mbps
目标码率，通过仓库 bundled FFmpeg 进行对比：

| proxy | 编码耗时 | 解码耗时 | 文件大小 | 产物 |
| --- | ---: | ---: | ---: | --- |
| H.264 VideoToolbox + AAC/MP4 | 1.19s | 0.12s | 2,546,120 B | 720×406，ffprobe 可读 |
| VP9 realtime + Opus/WebM | 1.22s | 0.22s | 3,194,825 B | 720×406，ffprobe 可读 |
| VP9 原默认参数 + Opus/WebM | 12.25s | 0.27s | 2,811,972 B | 720×406，ffprobe 可读 |

同一批下载目录最新 10 个视频的 bundled FFmpeg 对比汇总：H.264/AAC/MP4 总编码
`10.26s`、总视频解码 `1.38s`、总大小 `25,978,158 B`；实时 VP9/Opus/WebM 总编码
`14.84s`、总视频解码 `2.22s`、总大小 `30,061,723 B`。20/20 个产物均通过 ffprobe
并按对应 codec 解码；个别短视频的绝对差距很小，但 H.264 在长视频上更稳定地占优。

另有真实 media bundle 回归：`real-media-bundle.test.ts` 1/1、`real-common-av-formats.test.ts`
1/1 通过；H.264/AAC MP4 在 AVI/WMV 输入上生成并可再次解码。定向回归为 91/91 通过，
`npm run typecheck` 和改动文件 ESLint 通过。
