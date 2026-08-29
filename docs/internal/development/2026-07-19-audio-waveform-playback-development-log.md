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

## Serpent-dxk（AUDIO-001 复验修复）

人类验收不通过：网格/Inspector 封面过扁（640×160）且 flatten 底为近黑 `#1a2030`。

修复：

1. 封面几何改为 **640×480（≈4:3）**；查看页 `.preview-audio-waveform*` 壳层 CSS 未改。
2. flatten 底改为亮色友好 `#e8eae7`（对齐 light `--canvas`）；波形描边 `#3B7DD8`。
3. generator → `waveform-cover3`；`enqueueThumbnailJobs` 失效非 `waveform-cover3` 的音频缩略图以便重生成。
4. 常量与纯函数在 `src/shared/audio-media.ts`；单测覆盖比例与亮度门禁。

```bash
node scripts/run-vitest-with-electron.mjs \
  tests/unit/audio-media.test.ts \
  tests/worker/video-exr.test.ts -t 'audio waveform thumbnail'
```

## Serpent-muc（AUDIO-001 再次复验修复）

人类验收不通过（2026-07-19）：查看页把 4:3 封面 PNG 用 `object-fit:contain` 放进宽壳，左右信箱导致波形居中、播放头按壳宽定位而分离；网格封面 flatten 底 `#e8eae7` 与 light `--canvas` 同色融合。

修复：

1. 查看页 `.preview-audio-waveform-shell` 改为固定高度宽条；波形图 `object-fit:cover` full-bleed（网格/Inspector 仍用 4:3 封面 PNG）。
2. 封面底改为 raised 白 `#ffffff`；generator → `waveform-cover4`；新增 `contrastsWithLightCanvas` 门禁。
3. AUDIO-001 清单改回「待人类验收」。

```bash
node scripts/run-vitest-with-electron.mjs \
  tests/unit/audio-media.test.ts \
  tests/unit/audio-waveform-timeline.test.ts
npm run typecheck
```

## 人类验收

- AUDIO-001（待人类验收：`Serpent-muc` — 网格/Inspector ≈4:3 + 封面底与画布可辨；查看页波形满宽无错位空白、播放头对齐；Seek 另见 `Serpent-jh2`）
