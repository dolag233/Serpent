# GIF webm_proxy 生成路径移除记录（Serpent-43d32f）

> 日期：2026-08-22
> 分支：`dev`（基线 `593c64d`）
> 工单：`Serpent-43d32f`（关联 `Serpent-azf6` 动机考古、`Serpent-140fe2` 媒体任务洪水同域）
> 状态：代码与自动化证据完成；真实 Electron 的 GIF hover/查看视觉验收待人类/Computer Use。

## 评估结论（三选一 → 移除）

1. **考古（Serpent-azf6，已关闭）**：GIF webm_proxy 源自 2026-08-10「MCP 批量导入后缩略图生成过慢」性能工单，取舍为「GIF 类似视频（快静帧缩略图 + 后台 proxy + 预览走 proxy）」，消费方为 hover 卡片、Inspector hero 与查看器（`<video>` 播放 720p webm，规避多 MB 原始 GIF 解码）。当时 macOS 实测 107 GIF 16.9s 全排空 0 失败。
2. **Windows 长期坏点**：`tests/worker/thumbnails.test.ts`『animated GIF webm proxy』持续失败多日（2026-08-17 开发日志记录）。本次复现确认失败模式：缩略图链正常入队 `generate_webm_proxy`，但 `generateVideoProxy` 全 profile（h264_mf → libvpx-vp9）失败，预览永远回退 thumbnail/source——即 Windows 用户实际一直运行在「无 proxy」路径上，同时每个动画 GIF 白跑一次注定失败的 FFmpeg 转码。
3. **按需语义不适配**：视频 proxy 的按需触发（Serpent-cljb）依赖「真实解码失败」信号；Chromium `<img>` 渲染动画 GIF 不会失败，没有可依赖的触发条件。
4. **移除无功能损失**：`resolveLivePreviewMedia` 既有 `kind:'gif'` 分支以 `<img src=serpent://source>` 原生播放动画 GIF（Eagle 同做法），既有单测覆盖；网格卡片静帧缩略图不变。
5. 产品负责人立场：GIF 是浏览器原生格式，不需要 proxy。

## 变更

- `src/worker/library-service.ts`：
  - 删除 `getPreviewArtifact` 的 GIF proxy-first 块（ready proxy 返回 `kind:'webm_proxy'` + 未就绪时入队 priority 300），动画 GIF 落入原生图片路径（`playbackMode:'source'`）。
  - 删除缩略图任务完成后为动画 GIF 链式入队 `generate_webm_proxy`（priority 100）的块。
  - 删除因此零调用的私有方法 `enqueueVideoDerivativeJob`（140fe2 已移除 contact_sheet 主动入队后，其唯一剩余调用方即 GIF 两处）。
  - 新增 `retireLegacyGifProxyJobs`：开库恢复（`recoverInterruptedThumbnailJobs` 之后）将遗留 queued/paused 的 GIF `generate_webm_proxy` 任务置 `cancelled`/`GIF_PROXY_RETIRED`，避免升级后每 GIF 排空一次注定浪费的转码；活租户运行中的任务不干预。
- `src/renderer/asset-card-hover-preview.ts`：`resolveLivePreviewMedia` 删除 `kind === 'webm_proxy'` 特判（`getPreviewArtifact` 对 video 恒返回 `kind:'webm_proxy'`，由 `mediaType==='video'` 分支覆盖；mediaType image 不再可能携带该 kind）。
- `src/renderer/AssetPreviewModal.tsx`：查看器 `<video>` 分支条件 `(mediaType === "video" || kind === "webm_proxy")` 收窄为 `mediaType === "video"`。
- 视频按需 proxy 路径（cljb 源优先、真实失败后 `retryArtifact('webm_proxy')`、hover ready-proxy 优先）**未改动**；`SECONDARY_MEDIA_JOB_KINDS`/`MEDIA_JOB_KINDS` 中的 `generate_webm_proxy` 为视频按需路径所需，保留。

## 测试

- `tests/worker/thumbnails.test.ts`：describe 改名『animated GIF native playback (Serpent-43d32f)』；原『入队』用例改为断言不入队 + `resolvePreviewArtifact` 返回 `playbackMode:'source'`；原『proxy 就绪后预览走 proxy』用例替换为遗留任务退役用例（插入 legacy queued job → 重开库 → 断言 `cancelled`/`GIF_PROXY_RETIRED`）；静态 GIF 用例保留。**该文件此前长期失败，现已全绿。**
- `tests/unit/asset-card-hover-preview.test.ts`：删除 webm_proxy→video 用例（azf6 特判已不存在）。

## 验证证据（2026-08-22，Windows 开发态）

- `npm run typecheck`：通过。
- `npm run lint`：本改动文件无新增 finding；5 个 error 均为既有（`session-log.ts`、`App.tsx`、`library-service.ts` NapiCanvasFactory/Eagle 导入计时，均非本次触碰区域）。
- `node scripts/run-vitest-with-electron.mjs run tests/worker/thumbnails.test.ts`：60/60 通过。
- `npx vitest run tests/unit/asset-card-hover-preview.test.ts`：21/21 通过。
- `tests/worker/derived-artifact-repair.test.ts` + `video-contact-sheet-selfheal.test.ts`：通过；`video-exr.test.ts` 唯一失败为既有「硬件编码器 1 帧探测」坏点（2026-08-17 日志与 `593c64d` 提交信息在案，本次未触碰探测代码）。
- `npm run test:library-availability`：**9 文件 190 passed / 1 skipped，完整通过**。
- `npm run test` 全量（两轮）：3947 passed / 8 failed 与 3948 passed / 7 failed / 21 skipped；失败全部 ⊆ 既有坏点集合（session-log ×4、ui-patterns modal Escape、win32-file-clipboard CF_HDROP 中文编码、video-exr 编码器探测；首轮另含既有 fbx 间歇失败）。**`thumbnails-gif` 从失败集合消失。**
- media E2E（`run-e2e.mjs media-preview + media-video-playback`）：2 failed（media-preview『自动色卡预览不可见』『生成失败诊断断言』，与 `Serpent-140fe2` 2026-08-22 stash 对照记录的 Windows 既有基线完全一致）/ 2 skipped（process-restart 用例与 darwin-only video-playback）。无新失败。

## 未验证与移交

- 真实 Electron 中动画 GIF 的 hover/Inspector/查看器**视觉**回归（原生 `<img>` 动画播放）无既有 E2E 覆盖（azf6 时代亦仅有 worker+unit 证据）；本环境无 Computer Use，该项记为未执行，移交人类验收/Computer Use。
- macOS 上 proxy 曾可用（azf6 实测），移除后 hover 由 `<video>` proxy 变为 `<img>` 原图：超大 GIF 的解码开销变化未在 macOS 实测；产品已裁决接受原生渲染。
