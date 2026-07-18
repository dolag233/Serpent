# REQ-VIEW-002 开发日志 — 查看页直出原图/原视频

> 工单：`Serpent-0am`
> 需求：`REQ-VIEW-002`
> 日期：2026-07-18
> 状态：已实现；待人类验收（`VIEW-008`）；Computer Use 未执行

## 问题

打开查看页时，主画面可能被「正在生成预览」+ 加载态占满，即使资产本身是浏览器可直出的 PNG/JPEG/GIF/MP4/MOV/WebM。用户预期是「查看就是查看」：打开即看原文件，衍生预览/转码只做后台增强。

## 根因

1. **Worker `getPreviewArtifact`**：对视频（及非原生图）若已有 `webm_proxy`/`thumbnail` 且状态为 `generating`/`pending`/`failed`，会提前返回 `pending`/`failed`，**不回落到**已写好的 native `playbackMode: 'source'` 路径。注释已写明「浏览原件与衍生生成相互独立」，实现却先截断。
2. **Renderer `AssetPreviewModal`**：`ensureProxyFallback` 在直出能力判定失败或播放错误时，会把 resolution 改成 `status: 'pending'` 并清空 `url`，把主画面切成阻塞式「正在生成预览」。直出能力 gate 也会在 `directApproved` 之前挡住 `ready`。

## 修复

| 层 | 变更 |
| --- | --- |
| Worker | Native MIME（png/jpg/gif/webp/bmp/mp4/mov/webm）在衍生未 ready 时回落到 source；仅非 native 格式继续暴露 pending/failed。Ready 的 proxy 仍可优先用于视频。 |
| Renderer 策略 | 抽出 `viewer-preview-policy.ts`：有可挂载 URL 则主表面为 `media`；仅无 URL 的 pending 才是 `waiting`。 |
| Viewer | 乐观展示 source URL；能力判定只预热 proxy，不再清空 URL；播放错误保留错误条并后台 `retryArtifact`。 |

## 测试

- 单元：`tests/unit/viewer-preview-policy.test.ts`
- Worker：`tests/worker/thumbnails.test.ts` — native 视频在 proxy `generating`/`failed` 时仍 `playbackMode: 'source'`

## 验收

人类验收项：`VIEW-008`（见 `docs/qa/human-acceptance-checklist.md`）。

## 未执行

- Computer Use / 真实桌面截图：当前环境无桌面控制能力，移交人工 QA。
- 完整 Electron E2E：本增量以单元 + worker 策略覆盖为主；核心旅程回归待主线合流后跑。
