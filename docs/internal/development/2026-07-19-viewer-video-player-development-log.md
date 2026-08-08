# 2026-07-19 查看页视频播放器功能增强（Serpent-60k / REQ-VIEW-005 复验）

## 范围

从 `Serpent-2j9`（REQ-VIEW-005）拆出、复验失败后重新跟踪：查看页 MP4 空格播放/暂停、可拖拽进度、倍速。GIF 暂停/逐帧不在本工单范围（产品确认降级为不做，见 `VIEW-010`）。

## 背景：为什么重做而不是修补

`Serpent-2j9` 的实现（基线 `c539804`）保留 `HTMLVideoElement` 原生 `controls` 作为播放/暂停与 scrub UI，只叠加了 Space 判定与倍速 `<select>` 两个薄自定义层（见
[前一轮开发日志](2026-07-18-video-player-controls-development-log.md)）。人类验收结论：**REQ-VIEW-005 不通过（MP4 空格/进度不可用）**，`VIEW-009` 已撤回。

复核当时的方案说明，"保留原生 controls" 的理由是"Electron/Chromium 原生 scrub 可靠"——这个假设被验收结果证伪。根因排查（本轮）定位到两个原生层与自定义层互相打架的地方，而不是单个可以打补丁修复的点，因此没有在原实现上加 patch，而是把整条播放器 transport 链路（播放/暂停、scrub、倍速）都改为完全自绘：

1. **两套独立的“闲置自动隐藏”系统叠加**：查看页自身的 `useViewerChromeIdle`（2 秒无操作后把 `.preview-chrome-fade` 的自定义 chrome 淡出）只覆盖倍速/全屏两个薄 chip；原生 `<video controls>` 的 scrub/播放按钮有浏览器自己的、时间参数不同、不受 React 状态控制的隐藏计时器。两套计时器不同步，用户会在"自定义 chrome 还在但原生 scrub 刚好隐藏"或反过来的窗口期里操作，体验上就是"进度不可用"。
2. **原生控件的 shadow DOM 吃掉/改写键盘语义**：`<video controls>` 元素本身对 Space/方向键有浏览器内置默认行为（可聚焦、Space 触发原生播放/暂停），与查看页 `window` 级 capture 阶段的自定义 Space 监听在焦点落在 video 元素本身时的交互路径不透明、难以在真实 Electron 环境稳定复现调试。放弃在原生控件上叠加，避免继续依赖一个黑盒的默认行为集合。

修复方案：整条 transport（播放/暂停按钮、scrub 轨道、倍速）改为一个统一的自绘控制条，只由查看页现有的 `useViewerChromeIdle` 驱动淡出/淡入，不再有第二套隐藏计时器；`<video>` 元素本身不再带 `controls` 属性。

## 实现

- 纯逻辑（新增于既有文件，未新建重复模块）：`src/renderer/video-player-controls.ts`
  - 保留：`VIDEO_PLAYBACK_RATES`（0.5/0.75/1/1.25/1.5/2）、`shouldHandleVideoSpaceKey`（space-guard：跳过 input/textarea/select/contenteditable/`[role="dialog"]` 与已聚焦的按钮/链接类 chrome）、`parsePlaybackRate`、`nextPlaybackIntent`。
  - 新增（scrub position math）：`scrubRatioFromClientX`（指针 clientX + 轨道几何 → 0..1 比例，纯函数、不依赖 DOM）、`scrubTimeFromRatio`（比例 → 秒，clamp）、`scrubRatioFromTime`（当前时间 → 比例，用于渲染填充/滑块）、`clampScrubTime`（方向键步进的边界钳制）、`formatVideoClockTime`（`mm:ss` / 超一小时 `h:mm:ss`）。
- UI：`src/renderer/VideoPlayerControls.tsx` 重写为完全自绘 transport：
  - 播放/暂停按钮（点击 + 全局 Space，`shouldHandleVideoSpaceKey` 判定聚焦目标；按钮本身聚焦时交给浏览器原生 Space→click 语义，不会双触发）。
  - scrub 轨道：`div[role="slider"]`，`onPointerDown`/`onPointerMove`/`onPointerUp`/`onPointerCancel` + `setPointerCapture` 实现 mousedown / 拖拽 / 点击定位；方向键 ←/→ 步进 5 秒，Home/End 跳首尾；拖拽期间用本地 `scrubRatio` 状态覆盖显示，避免与 `timeupdate` 竞争；松手/取消时立即用 `video.currentTime` 同步显示状态，避免回跳闪烁。
  - 倍速 `<select>`：沿用既有 `VIDEO_PLAYBACK_RATES` 与 i18n key。
  - 全屏按钮：迁入统一控制条内（原来是独立浮动 chip）。
  - 所有 transport 元素包在同一个 `.preview-video-controls.preview-chrome-fade` 容器内，与查看页其它自定义 chrome 共用同一套闲置淡出逻辑，不再有第二套隐藏计时器。
- 样式：`src/renderer/styles.css` 新增 `.preview-video-controls` 及子元素（`-playpause` / `-time` / `-track` / `-track-fill` / `-track-thumb` / `-rate` / `-fullscreen`）；未改动 `.preview-fullscreen-chip` / `.preview-speed-control`（GIF、图片查看器仍在用，未涉及本工单范围）。
- i18n：新增 `preview.videoPlay` / `preview.videoPause` / `preview.videoScrubAria`（en + zh-CN）；沿用既有 `playbackRate` / `playbackRateOption` / `playbackRateAria` / `fullscreen` / `videoUnsupported`。
- 接线：`AssetPreviewModal.tsx` **未改动**——`VideoPlayerControls` 的 props 接口（`onError` / `onFullscreen` / `onReady` / `posterUrl` / `src`）保持不变，改动完全封装在组件与其纯逻辑模块内。
- E2E 兼容性核对：`tests/e2e/media-video-playback.test.ts` 通过 `video.preview-video` class selector + `element.evaluate` 直接操作 `currentTime`/`play()`，未依赖原生 `controls` 属性或原生 scrub UI 的可点击性，移除 `controls` 不影响该测试的既有断言路径（未运行——需要本机 darwin-arm64 LGPL FFmpeg bundle，见「未覆盖」）。

## 四列验收追溯

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| Space 播放/暂停（查看页打开、非输入焦点） | `VideoPlayerControls.tsx:65-74`（`window` capture 监听 + `shouldHandleVideoSpaceKey`）/ `video-player-controls.ts:64-75` | `tests/unit/video-player-controls.test.ts`「shouldHandleVideoSpaceKey」4 项 | 未执行（无 Computer Use 能力，移交人工 QA） |
| 文本输入框焦点时不抢 Space | `video-player-controls.ts:30-42`（`isEditableKeyboardTarget`：input/textarea/select/contenteditable/`[role="dialog"]`） | `tests/unit/video-player-controls.test.ts`「isEditableKeyboardTarget」2 项 + shouldHandleVideoSpaceKey 的 INPUT 用例 | 未执行 |
| 可见且可 scrub 的进度条（mousedown/拖拽/点击） | `VideoPlayerControls.tsx:142-219`（自绘 `role="slider"` 轨道 + pointer capture）/ `video-player-controls.ts` 的 `scrubRatioFromClientX`/`scrubTimeFromRatio`/`scrubRatioFromTime` | `tests/unit/video-player-controls.test.ts`「scrubRatioFromClientX」「scrubTimeFromRatio」「scrubRatioFromTime」共 9 项 | 未执行 |
| 倍速控制（至少 0.5/1/1.25/1.5/2） | `VideoPlayerControls.tsx:223-238`；`video-player-controls.ts:13`（含 0.75） | `tests/unit/video-player-controls.test.ts`「VIDEO_PLAYBACK_RATES」「parsePlaybackRate」 | 未执行 |
| 非 GIF 范围（GIF 播放器不受影响） | 未改动 `GifPlayerControls.tsx` / `gif-player-controls.ts`；`AssetPreviewModal.tsx` 的 GIF 分支路由不变 | 既有 `tests/unit/gif-player-controls.test.ts`（本轮未改动，随全量单测一起跑绿） | 未执行 |
| 真实 MP4 直出/代理播放不回归（VIEW-008/VIEWER-003 相关基线） | 未改动直出/代理逻辑（`AssetPreviewModal.tsx`、`viewer-preview-policy.ts`） | `tests/e2e/media-video-playback.test.ts`（本机缺 darwin-arm64 LGPL FFmpeg bundle，未运行；见下） | 未执行 |

## 证据（本轮）

- `npx vitest run tests/unit/video-player-controls.test.ts` → **21 passed**（8 项既有 + 13 项新增：`scrubRatioFromClientX` 3、`scrubTimeFromRatio` 2、`scrubRatioFromTime` 3、`clampScrubTime` 2、`formatVideoClockTime` 3）。
- `npx vitest run tests/unit`（全量单测）→ **93 files / 894 tests passed**，无回归。
- `npm run typecheck` → 通过（`tsc --noEmit` + extension 项目）。
- `npm run lint` → 0 errors（17 条 pre-existing `react-hooks/exhaustive-deps` 警告，均在 `App.tsx`/`InspectorPanel.tsx`，与本次改动文件无关，未新增）。
- `tests/e2e/media-video-playback.test.ts` → **未运行**：该测试 `test.skip` 依赖 `resources/ffmpeg/darwin-arm64/ffmpeg` 或 `.media-build` 下的真实 LGPL FFmpeg bundle 生成测试视频，本地未安装；已核对该测试的断言路径（class selector + 直接 `element.evaluate` 操作媒体元素）不依赖被移除的原生 `controls` 属性，理论上不受影响，但**未实际执行**，按验收纪律记为「未验证」而非「通过」。
- Computer Use：**未执行**（当前环境无真实桌面控制能力），按规则移交人工 QA 或具备 Computer Use 能力的 agent。

## 人类验收清单更新

新增 `VIEW-011`（`docs/internal/qa/human-acceptance-checklist.md` F 节），状态「待人类验收」。操作步骤：

1. 双击一个 MP4 资产进入查看页。
2. 不点击任何按钮，直接按空格：视频应播放/暂停切换；确认光标不在任何文本框/下拉框中时空格始终生效。
3. 把光标移进搜索框或任意文本输入框，按空格：应输入空格字符，视频不应播放/暂停切换。
4. 用鼠标在底部进度条上按下并拖动：播放位置应跟随拖动实时跳转；松开后从新位置继续播放。
5. 直接点击进度条上任意一点（不拖动）：应立即跳到该位置。
6. 打开倍速下拉，依次选择 0.5×/1×/1.25×/1.5×/2×：播放速度应随之改变。

## 未覆盖 / 已知限制

- Windows / packaged 环境未验证（无 runner，符合仓库既定约束）。
- `tests/e2e/media-video-playback.test.ts` 因本机缺真实 FFmpeg bundle 未实际运行；下次具备该 bundle 或 CI 环境时必须补跑，且需在**当前 HEAD** 重新构建后跑，不得用旧证据顶替。
- Computer Use 未执行；`VIEW-011` 在用户或具备桌面控制能力的 agent 完成上述操作步骤前，不得改为「人类验收通过」。
- 触摸屏/触控板手势（如双指快退快进）不在本工单范围内，未实现。
- 未 `bd close`（按任务要求，最终关闭工单留给独立验收角色/用户确认后处理）。
- 未创建 git 提交（按任务要求）。
