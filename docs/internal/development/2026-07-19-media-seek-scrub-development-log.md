# MEDIA-001 / Serpent-jh2 — 视频/音频 seek/scrub 播放失败

> 日期：2026-07-19  
> 工单：`Serpent-jh2`  
> 状态：已实现；待人类验收

## 根因

两条链路叠加，不是单一 UI 补丁能收口：

1. **协议未声明 streaming 特权**  
   `serpent://` 用 `protocol.handle` + `createArtifactResponse` 返回 Range/`206` 流，但从未调用 `protocol.registerSchemesAsPrivileged`。Electron 文档要求媒体方案设 `stream: true`，否则 `<video>`/`<audio>` 按「整包缓冲」期待响应；seek 时 Range 取消/重开易落到 `MEDIA_ERR_NETWORK`。

2. **自定义 scrub 在 `seeking` 期间连写 `currentTime`**  
   `VideoPlayerControls` / `AudioPlayerControls` 在 `pointermove` 上每次赋值 `currentTime`，取消上一笔未完成的 Range 拉取。取消路径偶发 `MEDIA_ERR_ABORTED`/`NETWORK`，`AssetPreviewModal.handlePlaybackError` 再画致命错误条（视频源路径还会误触发 proxy fallback）。

## 修复

- `src/main/serpent-protocol-privileges.ts` + `index.ts`：`app.ready` 前注册 `standard/secure/supportFetchAPI/stream/corsEnabled`。
- `createArtifactResponse`：接入 `AbortSignal`，seek 取消时销毁读流；忽略 abort/premature-close 类 stream error 日志噪声。
- `src/renderer/media-seek-session.ts`：按帧合并 seek；`seeking===true` 时只排队最新目标，在 `seeked` 再提交；`pointerup`/`键盘` 走 `commit`。
- Viewer 音视频 `preload="auto"`；`MEDIA_ERR_ABORTED` 视为瞬时，不弹致命条、不踢 proxy。

## 验证

- `npx vitest run tests/unit/media-seek-session.test.ts tests/unit/serpent-protocol-privileges.test.ts tests/unit/artifact-response.test.ts tests/unit/video-player-controls.test.ts tests/unit/audio-waveform-timeline.test.ts`
- `npm run typecheck`（本回合执行）
- Electron E2E / Computer Use：未在本回合前台执行（避免抢占窗口）；单 seek 既有覆盖见 `tests/e2e/media-video-playback.test.ts`。

## 人类验收

见 `docs/internal/qa/human-acceptance-checklist.md` **MEDIA-001**。
