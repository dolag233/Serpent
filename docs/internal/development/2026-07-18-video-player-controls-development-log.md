# 2026-07-18 视频播放器增强（Serpent-2j9 / REQ-VIEW-005）

## 范围

查看页视频：空格播放/暂停、倍速控制、可拖拽进度；评估是否需要更换播放器实现。

## 决策：原生 controls + 薄自定义 chrome

| 能力 | 方案 | 理由 |
| --- | --- | --- |
| 播放/暂停按钮与进度 scrub | 保留 `HTMLVideoElement` `controls` | Electron/Chromium 原生 scrub 可靠，可拖拽定位；自研进度条增加状态同步与 a11y 成本，收益有限 |
| 空格播放/暂停 | 薄自定义：`keydown` capture | 焦点常在查看层 region 而非 `<video>`，仅靠原生控件时 Space 不稳定；需避开文本输入与 chrome 按钮 |
| 倍速 | 薄自定义：速率 `<select>` | 标准 `controls` 不暴露倍速菜单 |

未引入第三方播放器（体积、CSP、协议媒体 URL、主题一致性成本更高）。

## 实现

- 纯逻辑：`src/renderer/video-player-controls.ts`（速率表、Space 判定、play/pause intent、速率解析）
- UI：`src/renderer/VideoPlayerControls.tsx`（video + 倍速 + 全屏 chip）
- 接线：`AssetPreviewModal` 在视频 ready 时渲染 `VideoPlayerControls`；不改 `App.tsx`
- i18n：`preview.playbackRateOption`（中/英）；沿用 `playbackRate` / `playbackRateAria`

## 验收

人类清单 **VIEW-009** 待验收。

## 证据（实现当时）

- `npx vitest run tests/unit/video-player-controls.test.ts` → 8 passed
- `npm run typecheck` → 通过
- 相关文件 eslint 无新增问题（`AssetPreviewModal` / `VideoPlayerControls` / `video-player-controls`）
- 人类验收：`VIEW-009` 进入待人类验收
- Computer Use：未执行

## 未覆盖

- Windows / packaged 未验证
- Computer Use 未执行
- 未关闭工单直至用户验收与合流门禁由主 agent 收口
