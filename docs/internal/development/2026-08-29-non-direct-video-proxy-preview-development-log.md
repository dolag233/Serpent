# 2026-08-29 不可直连视频生成 proxy 后仍无法预览

## 问题

用户反馈：无法直接播放的视频类型（例如 `.mov`），即使已经生成了 proxy，查看器/预览仍然播不出来。

## 根因

两处叠加：

1. **协议 MIME 错误（主因）**。播放代理在 FFmpeg 有 H.264 时写成 `.mp4`（`video/mp4`），VP9 回退才是 `.webm`。`serpent://preview` / `serpent://proxy` 却按扩展名映射 MIME，表里只有 `.webm`，`.mp4` 落到 `application/octet-stream`。Chromium 自定义协议下不会把 octet-stream 当视频解码，所以 **proxy 文件已经就绪，`<video>` 仍然失败**。失败时代理路径 `playbackMode === 'proxy'`，不会再次走 fallback，表现为「生成了也播不了」。

2. **查看器始终先挂原片**。`getPreviewArtifact('viewer')` 对所有视频容器都返回 `playbackMode: 'source'`。hover 已经会在有就绪 proxy 时用代理（Serpent-c8a1a3，专门覆盖部分 `.mov`）。查看器没有这条路径：MOV/AVI/WMV/MKV 在 proxy 已存在时仍先挂无法解码的原片。

REQ-VIEW-002 的本意是 **MP4/WebM 这类可直连容器继续播原片**，不是让无法直连的容器在代理已就绪后继续卡原片。

## 修复

- `artifactProtocolMimeForExtension`：`.mp4` → `video/mp4`，与图像/音频/WebM 共用同一张表，协议处理走共享函数。
- 查看器：非 Chromium 直连容器（`.mov` / `.avi` / `.wmv` / `.mkv`）在 `webm_proxy` 已 `ready` 时直接返回代理；`.mp4` / `.webm` / `.m4v` 仍 source-first。hover 行为不变；proxy 就绪事件会清掉 hover 上缓存的原片 URL。

## 测试

```bash
node scripts/run-vitest-with-electron.mjs run tests/unit/media-formats.test.ts tests/worker/video-exr.test.ts
# 2 files / 73 passed

node scripts/run-vitest-with-electron.mjs run tests/worker/thumbnails.test.ts tests/unit/direct-play-capability.test.ts
# 2 files / 79 passed
```

Electron 媒体 E2E、packaged、Computer Use 本轮未执行。

## 验收

见人类验收清单 `VIEWER-PROXY-001`。
