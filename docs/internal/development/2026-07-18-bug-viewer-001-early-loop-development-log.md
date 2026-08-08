# BUG-VIEWER-001 开发日志 — 查看页视频提前“循环”

> 工单：`Serpent-ond`
> 分支：`codex/slice-002-asset-ingestion`
> 日期：2026-07-18
> 状态：已实现；待人类验收 / Computer Use

## 根因

`AssetPreviewModal` 在 ready 后仍每 1.5s 轮询 `requestPreview`，并在每次成功回调里对直出视频执行 `setDirectApproved(false)`。  
`ready` 依赖 `directApproved`，于是 `<video>` 被反复卸载/挂载，`autoPlay` 从头播放，表现为约 1.5–2 秒就“循环”。

代理播放路径不受影响（不走 direct gate）。WebM 代理时长探针正常（5s→5s），不是转码截断。

## 修复

- 抽出 `src/renderer/preview-poll.ts`：轮询终止条件、playback 等价比较、directApproved 身份保持。
- ready 且可播放后停止轮询；相同 playback identity 不再撤销 `directApproved`。
- 单测：`tests/unit/preview-poll.test.ts`
- E2E：`media-video-playback` 增加空闲播放不回跳断言

## 验证

- `npm run test:unit`：56 files / 626 tests passed（含 `preview-poll`）
- E2E `media-video-playback`：本环境 Electron 启动失败（`bad option: --remote-debugging-port=0` / kill EPERM），记为未执行；断言已写入测试文件待可跑环境验证
