# 2026-07-19 音频波形预览与查看页播放开发日志

工单：`Serpent-0x5`

## 范围

音频类资产：网格/Inspector 波形封面；双击查看页播放（播放/暂停/进度）；解码失败明确降级。

## 实现

1. `mediaType: 'audio'`（共享类型 / protocol / AssetSummary）。
2. `detectMediaType` + MIME 白名单：`.wav/.mp3/.ogg/.oga/.m4a/.aac/.flac/.opus`。
3. Worker `generateAudioArtifacts`：ffprobe 元数据 + ffmpeg `showwavespic` 写入标准 `thumbnail` PNG（复用卡片封面管线，无需新 artifact kind 迁移）。
4. `getPreviewArtifact`：音频始终 `playbackMode: 'source'`（`serpent://source`）；波形就绪时经 `posterArtifactId`/`posterUrl` 暴露。
5. `AudioPlayerControls`：波形底图 + Space/scrub（复用 video transport helpers）。
6. 卡片 `AUDIO` 角标；时长 chip 对音频启用。

## 测试

```bash
node scripts/run-vitest-with-electron.mjs tests/unit/audio-media.test.ts tests/unit/asset-card-badges.test.ts
npm run typecheck
```

Computer Use：未执行。

## 人类验收

- AUDIO-001
