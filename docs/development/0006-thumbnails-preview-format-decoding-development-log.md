# Slice 0006 development log: thumbnails, preview, and format decoding

> Status: fixing
> Started: reconstructed 2026-07-13
> Last updated: 2026-07-14
> Record provenance: **流程偏差**——实现先于本文完成；内容由提交、测试与 working-tree diff 重建，不是持续开发日志。

## References and ranges

- Spec: `docs/implementation/0006-thumbnails-preview-format-decoding-vertical-slice.md`
- Base: `8dc24705413f4964b682cf452ba65bb39d3e00e3`
- Original review range: `8dc2470...cdc2247`
- Relevant commits: `9f3774e`、`f588404`、`b4bcbb3`
- Re-review: current uncommitted working tree on 2026-07-13.

## Reconstructed implementation

- schema adds `revision_artifacts` and `jobs`; Sharp creates WebP thumbnails; FFprobe/FFmpeg create metadata, poster, contact sheet and WebM proxy; OIIO CLI handles EXR/TGA basic previews.
- `serpent://preview` keeps absolute artifact paths out of Renderer; cards show generated images and the app offers a modal preview and external-open action.
- `spawnFn` is injectable for Worker tests; Sharp is externalized in the Worker Vite build to avoid treating native `.node` files as text.

## Working-tree reliability fixes

- Bundled FFmpeg/ffprobe/oiiotool paths are used only when the file exists and is executable; otherwise resolution falls back to PATH. Environment overrides remain explicit.
- Retry invalidates the prior current artifact rows before inserting replacements, avoiding the `(revision_id, kind)` partial unique index collision and leaving one current ready/failed row.
- A missing/failed video poster now raises `MEDIA_PROCESSING_FAILED`; Worker/Main cannot publish a ready event or an empty artifact ID. Retry returns the protocol shape Preload expects.
- Subprocess stdout/stderr are bounded at 8 MiB/512 KiB and preserve the tail; surfaced diagnostics retain the last 200 characters.
- Preview IPC now returns a renderer-safe artifact state (`ready` / `pending` / `failed` / `missing`) instead of assuming every asset is an image thumbnail. Video previews prefer the current `webm_proxy` and may carry an opaque poster URL; paths remain inside Worker/Main.
- `serpent://proxy` serves seekable single-range responses with `206`, `Content-Range` and streaming reads. Protocol lookup/read/stream failures are persisted to `serpent.log` without exposing paths to Renderer.
- The Renderer now has a video preview modal backed by native `<video controls>` (play/pause, timeline, volume), explicit full-screen, pending/failed reasons, retry, and renderer playback/full-screen diagnostic reporting. Image previews use the same safe resolution flow.
- Retry now enqueues and acknowledges immediately instead of holding a 15-second Main↔Worker request open around a decoder that may run for 600 seconds. The modal polls single-flight with request sequencing and unmount invalidation.
- Artifact serving is limited to the current ready, non-invalidated artifact and the requested host's allowed kinds. Worker rejects symlink/non-regular/out-of-root targets; Main opens with `O_NOFOLLOW` (where supported) and verifies the file descriptor is a regular file before streaming.
- MP4/MOV/WebM now use capability-probed source playback first and fall back once to a generated WebM proxy; AVI/WMV use proxy playback. `serpent://source` enforces the current revision and seekable Range reads.
- Media jobs expose list/pause/resume/cancel/retry. Active FFmpeg/OIIO children receive abort, TERM and then KILL; cancelled or paused jobs cannot publish late artifacts. Decoder limits are process-global across libraries (Sharp 2, FFmpeg/ffprobe 1, OIIO 1).
- Real FFmpeg testing found two mock blind spots: the old `thumbnail+fps` poster graph could emit no frame for a one-second clip, and `drawtext` required fontconfig which the LGPL bundle intentionally disables. The poster filter now always yields a selected frame and the contact sheet omits timestamp text until a licensed bundled font exists.
- Import and watcher mtime persistence now use the same millisecond representation. The prior precision mismatch could create a phantom external revision immediately after import and invalidate a just-generated artifact.
- A pinned macOS arm64 LGPL-only bundle was built with vcpkg (FFmpeg 8.1, ffprobe 8.1, OpenImageIO 3.1.12.0 and OCIO studio config). The scripts verify architecture, dynamic imports, license/config evidence, executable identity and every manifest hash before packaging.
- Local representative-colour extraction now runs as the existing persistent `extract_palette` media job after an image thumbnail or video poster becomes ready. A deterministic bounded histogram + weighted clustering pass reads only the 64px sRGB derivative, writes an `extracted_palette` JSON artifact (`hex` + normalized ratio), inherits pause/cancel/retry/crash recovery, and logs full failures while exposing only a safe reason.
- schema v12 adds indexed `dominant_hue` and `dominant_lightness` projections to palette artifacts. Discovery and smart collections accept `color` sorting with NULL palettes last and `asset_id` as the stable tie-break.
- Asset metadata resolution exposes automatic and effective palettes with explicit provenance. The inspector labels automatic/manual state, preserves the automatic palette when a user overrides it, and falls back to the automatic palette when the manual palette is cleared.
- 真实已有资源库验收发现 Renderer CSP 的 `img-src` / `media-src` 漏掉 `serpent:`，导致所有已经生成成功的缩略图和预览在到达 Main 协议处理器前被 Chromium 拦截。此前 E2E 只断言 `<img>` 可见，坏图元素也会通过。修复后 E2E 断言非零解码尺寸，并覆盖关闭/重新打开资源库后的缩略图和放大预览。
- 同一轮验收发现 WebM 代理参数误写为 `-row-mv`；真实 FFmpeg 8.1 报 `Unrecognized option`，而 mock 只检查了 `libvpx-vp9`。参数已改为 `-row-mt`，Worker 回归测试现在同时要求正确参数存在、错误参数不存在。
- 缩略图改为等比 `contain`，支持格式缺少衍生物时自动幂等调度；原生可解码图片/视频可立即打开源文件，不等待后台 poster/proxy。查看页嵌入中央并支持前后切换、统一 Ctrl+Wheel/pinch 缩放与视频控件。
- 资产画布统一由 `.workspace-canvas` 滚动，移除分页 UI，支持平铺/瀑布流连续加载和卡片尺寸视觉锚点。修复 Grid 垂直居中超高瀑布流导致的顶部负溢出，E2E 验证首尾资产完整可达。
- Main 以原子、0600 状态文件保存最近资源库，Renderer 仅保存不含绝对路径的浏览范围和资产身份；完整退出 Electron 后可自动恢复资源库、选中并聚焦上次资产。
- 真实媒体矩阵不再直接调用 `generateThumbnail()` 绕过调度，而是通过 `enqueueThumbnailJobs()` / `processThumbnailQueue()` 完整消费持久任务。MP4/MOV/AVI/WMV 均验证 poster、metadata、contact sheet；AVI/WMV 的真实 WebM 代理进一步由 ffprobe 验证 VP9 + Opus、可 seek 解码，并在关闭/重开资源库后验证 artifact/job 原样复用。
- 新增 Electron 成功视频 E2E：H.264 MP4 走 `serpent://source/`，MPEG-4 AVI 自动走 `serpent://proxy/`；两者均要求真实 metadata、非零尺寸、播放进度和 seek。测试已加入默认 `test:e2e` 文件清单。
- WebM 代理的缩放从固定宽度 `scale=720:-2` 改为横竖统一的最长边 720、保持比例且不放大小素材；真实测试覆盖 64×48 横屏 AVI 与 48×64 竖屏 WMV。代理输出增加 512 MiB 安全上限，超限文件立即删除，job/artifact 失败并保留完整本地诊断。
- `SERPENT_REQUIRE_REAL_MEDIA=1` 将真实 bundle 缺失从 skip 提升为硬失败；macOS arm64 的 `verify:mainline` 默认启用，避免主开发平台在没有真实媒体覆盖时静默全绿。

## Verification record

- Full TypeScript and ESLint: passed.
- Full unit/Worker suite: **631 passed, 1 platform skip**.
- Media lifecycle and format scoped suite: **96/96 passed**; full Worker suite: **456 passed, 1 platform skip**.
- Real promoted-bundle format matrix repeatedly passed for PNG, JPEG, GIF, TIFF, TGA, EXR, MP4, MOV, AVI and WMV.
- Full Electron E2E reached **12/13** after the job-scope rename; the sole failure was a stale assertion for `worker.thumbnail-queue`. It was corrected to assert `worker.media-job.failed` plus `FFMPEG_REQUIRED`, and the targeted media E2E then passed **2/2**.
- Extension and media package build stages compile successfully; `git diff --check` passed.
- Bundle evidence hashes: FFmpeg `8644635579ae81a7fd415e45f87a9a67a2071224311aa5e0df2f3ac6f4da3774`; ffprobe `745d4634a2ca0cb6eb75711bab2ac0a50ade3828b1495d9eb8db03439082d1fb`; oiiotool `8fd8eef3415be4f90e887813b67584792e3ee69df7d75bdfb352b5b1b776f0d7`; bundle ZIP `79e31c1360b4e8988e39b169c638a583ec45d017174d10caf81996e30da7fbe2`.
- Palette-specific unit/Worker/protocol suite: **220/220 passed** across the new algorithm/artifact tests and affected media, organization, discovery and protocol suites. Full Electron-runner suite reached **738 passed, 1 skipped, 1 unrelated ZIP streaming timeout**; the ZIP file passed **27/27** immediately in isolation.
- 2026-07-13 预览事故回归：修复前新的图片解码 E2E 稳定失败；修复后媒体 E2E **2/2 passed**。对 `/Users/dolag/Documents/Temp/我的资源库` 的临时副本抽查前 20 个缩略图均有非零尺寸，GIF 放大预览解码成功；失败的视频代理点击重试后生成成功并达到 `HAVE_METADATA`（720×900），原资源库未被修改。
- 最终合并树 `npm run verify:mainline` 通过：lint、typecheck、扩展构建、774 个单元/Worker 测试（1 个平台跳过）、4 个 10 万资产性能测试和 16 个 Electron E2E 全部通过。
- 2026-07-13 本轮最终合并树再次通过 `npm run verify:mainline`：lint、typecheck、扩展构建、777 个单元/Worker 测试（1 个平台跳过）、4 个 10 万资产性能测试和 16 个 Electron E2E 全部通过。新增覆盖无分页连续加载、瀑布流首尾可达、统一缩放/视觉锚点以及完整进程重启后的资源库和资产聚焦恢复。
- 2026-07-14 定向媒体门禁：`video-exr.test.ts` + `real-media-bundle.test.ts` **30/30 passed**；成功视频 Electron E2E **1/1 passed**。Computer Use 在最终代码上完成创建资源库、导入真实 MP4/AVI、缩略图、source 播放、proxy 播放、前后切换和窄窗口检查；证据见 `docs/qa/evidence/0006-video-playback/`。
- 2026-07-14 最终合并树 `npm run verify:mainline` 通过：lint、typecheck、扩展构建、**778 passed / 1 platform skip** 单元+Worker、**4/4** 搜索性能测试、**17/17** Electron E2E。

## Open scope and risks

- **Release blocking:** the verified macOS archive is local build evidence only. It still needs an approved immutable HTTPS publication location plus `bundle-lock.json` acquisition receipt before Forge packaging is allowed. Windows bundle build/verification is also unexecuted.
- Direct-play capability selection, one-time proxy fallback, native controls and the spacebar full-screen shortcut are implemented. A real packaged Electron playback smoke remains open.
- OCIO studio-config display transform and deterministic exposure seam are implemented. Renderer exposure controls and a representative professional EXR/TIFF corpus remain open.
- GIF animated hover/client playback is not implemented; the current GIF path produces a static thumbnail.
- macOS manual media QA, packaged QA, and all Windows media/packaging QA are unexecuted.

This slice remains **fixing** and must not be described as accepted.
