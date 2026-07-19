# 2026-07-19 音频波形预览与查看页播放开发日志

工单：`Serpent-0x5` → 修复 `Serpent-13v`

## 范围

音频类资产：网格/Inspector 波形封面；双击查看页播放（播放/暂停/进度）；解码失败明确降级；查看页波形区时间轴/播放头。

## 实现

1. `mediaType: 'audio'`（共享类型 / protocol / AssetSummary）。
2. `detectMediaType` + MIME 白名单：`.wav/.mp3/.ogg/.oga/.m4a/.aac/.flac/.opus`。
3. Worker `generateAudioArtifacts`：ffprobe 元数据 + ffmpeg `showwavespic`；经 sharp `flatten` 落到不透明底，写入标准 `thumbnail` PNG。
4. `enqueueThumbnailJobs` 纳入音频扩展名（此前遗漏导致导入后永不入队）；并失效无 `waveform-cover` 标记的旧透明细线封面以便重生成。
5. `getPreviewArtifact`：音频始终 `playbackMode: 'source'`（`serpent://source`）；波形就绪时经 `posterArtifactId`/`posterUrl` 暴露。
6. `AudioPlayerControls`：波形底图 + **波形内播放头时间轴** + Space/scrub（复用 video transport helpers）。
7. 卡片 `AUDIO` 角标；时长 chip 对音频启用。

## 测试

```bash
node scripts/run-vitest-with-electron.mjs \
  tests/unit/audio-media.test.ts \
  tests/unit/audio-waveform-timeline.test.ts \
  tests/unit/asset-card-badges.test.ts \
  tests/worker/video-exr.test.ts -t 'audio|EnqueueAudio|waveform'
npm run typecheck
```

Computer Use：未执行。

## 人类验收

- AUDIO-001（待复验：可见波形封面 + 查看页波形时间轴/播放头）
