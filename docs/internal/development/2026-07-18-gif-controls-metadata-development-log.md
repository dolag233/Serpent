# 2026-07-18 GIF 暂停/逐帧与时长帧数元数据（Serpent-6s1 / CU-D8）

## 范围

1. 查看页 GIF：暂停 / 播放，以及在可行时逐帧。
2. GIF 元数据：时长与帧数（对齐视频 `durationMs` 展示路径），Inspector + 网格时长角标。

悬停网格预览已有动图播放（CANVAS-014）；本工单不在卡片上加暂停控件（成本高、收益低）。

## 决策

| 能力 | 方案 | 理由 |
| --- | --- | --- |
| 暂停 | 播放时用原生 `<img>` 动画；暂停时 `canvas.drawImage` 抓当前绘制帧作 still | Chromium 对 animated GIF 的 `drawImage` 会抓当前帧；无需自研解码即可「停在所见」 |
| 空格 | 捕获阶段 Space → play/pause；`ZoomableImage` 对 GIF 仅保留 F 回正 | 与 VIEW-009 视频空格语义一致，避免与回正冲突 |
| 逐帧 | 若 `ImageDecoder` 可用则 decode 指定 `frameIndex`；否则禁用 prev/next | Electron/Chromium 有 ImageDecoder；无多帧解码时不强行假步进 |
| 时长/帧数 | thumbnail 生成时用 sharp `pages` + `delay[]` 写入 `extracted_metadata`，`duration_ms` 列供列表投影 | 复用视频同一 artifact 路径；卡片角标逻辑（CANVAS-012）已对 GIF 读 `durationMs` |
| 旧库回填 | `enqueueThumbnailJobs` 对「有 thumb、无 ready extracted_metadata」的 GIF 失效 thumb 一次 | 与 CU-D7 gifstill 失效同模式；避免永久缺元数据 |

未做：悬停卡暂停、精确「暂停时对齐 ImageDecoder 帧号」、Windows/packaged、Computer Use。

## 实现

- Worker：`src/worker/gif-metadata.ts`；`library-service` 在 GIF 缩略图路径持久化 metadata，并回填入队
- Schema：`extractedVideoMetadataSchema.frameCount` 可选
- Viewer：`gif-player-controls.ts` + `GifPlayerControls.tsx`；`AssetPreviewModal` 按扩展名分流；不改 `App.tsx`
- Inspector：GIF 也拉 `getExtractedMetadata`，紧凑行显示时长 +「N 帧」
- i18n：`preview.gif*`、`inspector.gifFrameCount`（en / zh-CN）

## 验收条目

- **VIEW-010** 查看页 GIF 暂停与逐帧 → 待人类验收
- **META-010** GIF 时长与帧数元数据 → 待人类验收

## 证据（实现当时）

- `npx vitest run tests/unit/gif-metadata.test.ts tests/unit/gif-player-controls.test.ts` → 10 passed
- `npx vitest run tests/unit/video-metadata-format.test.ts tests/unit/asset-card-badges.test.ts` → 12 passed（合计 22）
- `npm run typecheck` → 通过
- Computer Use：未执行（当前环境无桌面控制能力）

## 诚实能力边界

| 项 | 状态 |
| --- | --- |
| 空格/按钮暂停并冻结当前画面 | 预期可用（Chromium drawImage） |
| 再按空格继续播原 GIF | 预期可用 |
| ImageDecoder 逐帧 + 帧号 | Electron 下预期可用；失败时按钮禁用 |
| Inspector / 卡片时长 | 依赖缩略图（或回填）跑完后 `durationMs` 投影 |
| 帧数文案 | 依赖 `extracted_metadata.frameCount`；列表摘要本身不带 frameCount |
| 暂停帧号与 ImageDecoder 索引对齐 | **未做**（暂停抓屏，步进从独立 decode 索引） |
| 网格悬停暂停 | **未做**（有意跳过） |

## 工单

`Serpent-6s1` 保持 `in_progress`；不提交；合流与门禁由主 agent 收口。
