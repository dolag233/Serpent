# 2026-09-21 视频倍速改为 0.25–4 下拉

> 工单：`Serpent-1a846c`  
> 状态：实现完成，待人类验收  
> 分支：`dev`

## 现象

视频查看页底部倍速只能加快，不能减慢。产品要求支持 0.25～4 倍，并把控件改成下拉，选项为 `0.25`、`0.5`、`1`、`1.5`、`2`、`4`。

## 根因

VIEWER-023 / `Serpent-gplm` 曾用原生 `<select>`，系统弹出菜单是白底，和底部 chrome 不一致。后来改成文字按钮，点击只调用 `stepVideoPlaybackRate(..., "faster")`。X/C 快捷键仍能升降，但按钮没有减慢入口，档位也停在 `0.5 / 0.75 / 1 / 1.25 / 1.5 / 2`，到不了 0.25 和 4。

这不是解码器拒绝慢放。HTML 视频的 `playbackRate` 本来就可以小于 1；UI 没有把慢档露出来。

## 修复

- `VIDEO_PLAYBACK_RATES` 改为 `[0.25, 0.5, 1, 1.5, 2, 4]`。X/C 仍在同一列表上降/升一档。
- 新控件 `VideoPlaybackRateSelect`：触发按钮仍用 `.preview-video-rate`，弹出 `ui-menu-surface` 选项列表（与插件下拉、排序面板同一套 option 样式），向上打开以免贴底被裁。不用原生 `<select>`。
- 空格在倍速 listbox 里选选项，不抢播放/暂停。Escape 先关下拉，不直接退出查看器。
- 下拉打开时底部 chrome 保持可见（与音量拖动时相同）。

## 命令

| 命令 | 结果 |
| --- | --- |
| `npx vitest run --config vitest.config.ts tests/unit/video-player-controls.test.ts tests/unit/video-playback-rate-select.test.tsx tests/unit/video-player-autoplay.test.tsx` | 3 files / 41 passed |
| packaged / Computer Use | 未执行 |
