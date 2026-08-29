# 2026-07-19 查看页/检查器/画布打磨 开发日志

## 范围

5 张已认领的 P2 工单，均来自用户真实使用反馈：

- `Serpent-627`：查看页底部缩放面板半透明（不透明度不要太低）。
- `Serpent-ayf`：查看页左右切图不应唤醒 chrome，只有鼠标移动才唤醒。
- `Serpent-qto`：描述输入框默认单行高度，超一行自动增高换行。
- `Serpent-akz`：资产卡片大小滑块更细粒度。
- `Serpent-a9n`：Inspector 单选时循环播放视频/动图，多选不播放。

来源：`docs/internal/implementation/mvp-ui-ux-requirements-backlog.md` 2026-07-18/19 用户反馈；5 张工单均已在开工前 `bd update <id> --claim` 认领（assignee: dolag, in_progress）。

## Serpent-627：查看页 chrome 半透明

**现状**：`preview-zoom-controls`（缩放条）、`preview-video-controls`（视频 transport）、`preview-gif-controls`（GIF 控制条）、`preview-speed-control`（倍速面板）、`preview-fullscreen-chip`（全屏按钮）五个 chrome 面板的背景都是 `color-mix(in srgb, var(--raised) 94%, transparent)`——94% 不透明，视觉上几乎是实底色，谈不上「半透」。

**方案**：新增共享 token `--viewer-chrome-bg: color-mix(in srgb, var(--raised) 72%, transparent)`（`styles.css` `:root`），五个面板背景统一改为 `var(--viewer-chrome-bg)`。72% 是在「明显半透明」和「文字/滑块仍可辨」之间取的折中值；因为 `--raised` 本身已按亮/暗主题分别定义（暗色 `#35383b`、亮色 `#ffffff`），这个 token 天然跨主题一致，不需要在 `[data-theme="light"]` 里单独覆盖。配合已有的 `backdrop-filter: blur(10px)` 提升可读性。

## Serpent-ayf：左右切图不唤醒 chrome

**根因**：`AssetPreviewModal` 在 `App.tsx` 里用 `key={previewAsset.assetId}` 按资产整体重挂载（用于重置 loading/resolution/directApproved 等每资产状态）。原来的 `useViewerChromeIdle()` 调用在 `AssetPreviewModal` 内部，重挂载时该 hook 也重新 `useState(false)` + 重新起一个新的闲置计时器——`idle` 初始值是 `false`（可见），于是**只要资产切换（无论键盘 ←→ 还是点击界面上一/下一箭头），chrome 都会被重新挂载逻辑强制拉回「可见」态**，与闲置渐隐后应保持隐藏的预期相反。键盘导航本身从未调用过任何"唤醒"回调——问题不是"谁调用了唤醒"，而是"remount 本身就是一次隐式唤醒"。

**方案**：

1. `viewer-chrome-idle.ts` 新增纯策略函数 `shouldWakeViewerChrome(source)`：只有 `"pointermove"` 返回 `true`；`"pointerdownOrClick"` 显式返回 `false`（而不是简单地不接线，防止未来有人不小心把点击又接回唤醒）。
2. `use-viewer-chrome-idle.ts` 重构：内部改为调用既有的 `createViewerChromeIdleScheduler`（此前该文件重复实现了一份等价的 `setTimeout` 逻辑，两处会漂移），对外暴露 `{ idle, onActivity(source), wake() }`。`onActivity` 内部用 `shouldWakeViewerChrome` 过滤；`wake()` 是无条件唤醒，留给调用方在明确的"进入查看"时机主动触发。
3. **把该 hook 从 `AssetPreviewModal` 移到 `App.tsx`**（不随 `previewAsset.assetId` 变化重挂载的父组件层）。`AssetPreviewModal` 改为纯 props 消费者：接收 `chromeIdle: boolean` 与 `onChromeActivity(source)`，不再自己持有闲置状态。
4. `App.tsx` 里：`openAssetPreview`（打开查看页的唯一入口）新增 `wakeViewerChrome()` 调用；`navigateAssetPreview`（左右切换的唯一入口，键盘 `ArrowLeft`/`ArrowRight` 和界面箭头按钮共用同一个函数）**不调用**。`AssetPreviewModal` 的 `onPointerDown`/`onPointerMove` 分别接线为 `onChromeActivity("pointerdownOrClick")` / `onChromeActivity("pointermove")`——点击仍然会走到策略函数，但被判定为不唤醒。

这样"资产切换"这件事本身不再触碰闲置状态：hook 实例跟随 `App` 的生命周期，而不是跟随当前查看的资产。

## Serpent-qto：描述输入框单行默认 + 自动增高

**现状**：`InspectorPanel.tsx` 里描述 `<textarea rows={2}>` 已经有一个自动量高的 `useEffect`（`textarea.style.height = scrollHeight`），但 `rows={2}` 让浏览器原生把空/短文本的 `scrollHeight` 就计算成两行，CSS `.inspector-textarea { min-height: 52px }` 又进一步把地板钳在两行高度——两处都在把"默认"拉高到两行，不是自动增高逻辑本身的问题。

**方案**：

- `rows={2}` → `rows={1}`。
- 新增纯函数模块 `inspector-description-autogrow.ts`：`resolveAutoGrowHeight(scrollHeight, minHeight, maxHeight)` 做增高与封顶的 clamp 数学（`Math.min(max, Math.max(min, scrollHeight))`，并处理 `max < min` 的错误配置与 `Infinity` 上限）。
- `InspectorPanel.tsx` 的量高 effect 改为调用该函数，`minHeight`/`maxHeight` 直接从 `getComputedStyle(textarea)` 读取，与 CSS 保持单一事实来源（不在 JS 里重复写一遍 magic number）。
- CSS `.inspector-textarea` 的 `min-height` 从固定 `52px` 改为 `calc(1.6em + 14px)`（单行 line-height 1.6 × 字号 + 上下各 7px padding，与 `padding-top`/新增的 `padding-bottom: 7px` 对齐，之前只有 `padding-top` 是不对称的）。

## Serpent-akz：卡片大小滑块更细粒度

**现状**：`CanvasToolbarControls.tsx` 的卡片大小 `<input type="range">` 硬编码 `step="8"`；范围 96–320px，只有 28 个档位，拖动手感偏"跳跃"。

**方案**：`canvas-preferences.ts` 新增 `CARD_SIZE_STEP = 2`（同一范围下 112 个档位，约 4 倍），并导出 `cardSizeSliderStepCount(min, max, step)` 辅助函数用于单测断言"确实变细了"而不只是断言常量值本身。`CanvasToolbarControls.tsx` 的滑块 `step` 改为引用该常量。底层 `resizeAssetCards`/`clampCardSize` 早已按整数像素处理，`step=2` 不需要改动任何取整逻辑。

## Serpent-a9n：Inspector 单选循环播放，多选不播放

**现状调研**：Inspector 的 `InspectorHeroSinglePreview` 一直只渲染 `resolveInspectorPreviewSrc()` 返回的**静态**缩略图（`.webp`，worker 侧对 GIF 也只挑一帧生成静态封面，视频也只有静态 poster），完全没有真正的循环播放路径。多选路径（`InspectorHeroMultiStack`）则从一开始就只用静态堆叠图，天然满足"多选不播"。

**复用而非重造**：画布卡片已经有一套成熟、已测试的"就绪即播"机制——`useAssetCardHoverPreview` + `AssetCardMedia`（`REQ-CANVAS-009` / `Serpent-05o`），用 `api.requestPreview` 拿到 `PreviewResolution`，`status === "ready"` 时用 `<video loop muted autoPlay>` 播视频、原生 `<img>` 播 GIF（GIF 本身循环是浏览器默认行为，不需要额外逻辑）。

- 把选择"播什么/是否播"的判定逻辑从 `AssetCardMedia.tsx` 内联代码提炼成 `asset-card-hover-preview.ts` 的纯函数 `resolveLivePreviewMedia(isActive, preview)`：只有 `isActive && preview.status === "ready" && preview.url` 才返回可播放的 `{ url, kind }`，`kind` 由 `mediaType` 决定（`image` → `"gif"`，`video` → `"video"`，否则不播）。`AssetCardMedia.tsx` 改为调用该函数，画布卡片行为不变（回归见下方测试）。
- `InspectorPanel.tsx` 内为 Inspector **单独**起一个 `useAssetCardHoverPreview` 实例（`primarySelectedAssetId` 只在 `selectionCount < 2` 时设为当前选中资产，`isPreviewable` 同时校验 `isCardHoverPreviewable`）。**特意不复用**画布卡片那一份 hook 实例/状态——如果直接共享 `activeResolution`，用户在画布上悬停别的卡片时（`resolveActivePreviewAssetId` 里悬停优先于主选中）会让 Inspector 的播放对象错误地跟着切换甚至消失，与"正在看的资产的 Inspector 预览"这个心智模型不符。两个独立实例意味着同一个可播放资产可能发出两次 `requestPreview` 请求（一次给画布卡片，一次给 Inspector），但这只是一次轻量状态查询（不是转码任务），可接受。
- `InspectorHeroSinglePreview` 新增 `livePreview` prop：`kind === "video"` 时渲染 `<video autoPlay loop muted playsInline poster={前述静态缩略图} src={live.url}>`；`kind === "gif"` 时把 `<img>` 的 `src` 换成 `live.url`（原生循环）；否则回退到原来的静态缩略图/占位图标路径。`InspectorHero` 只在非多选分支把 `livePreview` 传下去，多选分支完全不引用它。

## 涉及文件

- 新增：
  - `src/renderer/inspector-description-autogrow.ts`（+ `tests/unit/inspector-description-autogrow.test.ts`）
- 修改：
  - `src/renderer/viewer-chrome-idle.ts`（新增 `ViewerChromeActivitySource` / `shouldWakeViewerChrome`）
  - `src/renderer/use-viewer-chrome-idle.ts`（重构为 `{ idle, onActivity, wake }`，内部复用 `createViewerChromeIdleScheduler`）
  - `src/renderer/AssetPreviewModal.tsx`（`chromeIdle`/`onChromeActivity` 改为 props）
  - `src/renderer/App.tsx`（顶层持有 `useViewerChromeIdle`；`openAssetPreview` 唤醒，`navigateAssetPreview` 不唤醒；`<AssetPreviewModal>` 接线新 props）
  - `src/renderer/InspectorPanel.tsx`（描述框 `rows`/量高逻辑；新增单选 live-preview 接线与渲染）
  - `src/renderer/asset-card-hover-preview.ts`（新增 `resolveLivePreviewMedia`）
  - `src/renderer/AssetCardMedia.tsx`（改为调用 `resolveLivePreviewMedia`，行为不变）
  - `src/renderer/canvas-preferences.ts`（新增 `CARD_SIZE_STEP` / `cardSizeSliderStepCount`）
  - `src/renderer/CanvasToolbarControls.tsx`（滑块 `step` 接入常量）
  - `src/renderer/styles.css`（`--viewer-chrome-bg` token + 5 处 chrome 面板背景；`.inspector-textarea` 单行 min-height + 对称 padding）
  - `tests/unit/use-viewer-chrome-idle.test.ts`（新增 `shouldWakeViewerChrome` 用例）
  - `tests/unit/canvas-preferences.test.ts`（新增 `CARD_SIZE_STEP`/`cardSizeSliderStepCount` 用例）
  - `tests/unit/asset-card-hover-preview.test.ts`（新增 `resolveLivePreviewMedia` 用例）
- 文档：
  - `docs/internal/qa/human-acceptance-checklist.md`（新增 `VIEWER-009`/`VIEWER-010`/`CANVAS-018`/`INSPECT-007`/`INSPECT-008`，均「待人类验收」；人类验收记录追加一行）

## 自动化证据

| 命令 | 结果 |
| --- | --- |
| `npx tsc --noEmit && npx tsc -p tsconfig.extension.json`（`npm run typecheck`） | 通过，0 错误 |
| `npm run test:unit` | 94 files / 912 tests 通过（含本次新增/修改的用例） |
| `npm run lint` | 0 error；17 条 pre-existing `react-hooks/exhaustive-deps` warning（均在本次未新增的行号，历史遗留） |

## 未覆盖 / 后续

- **Computer Use 未执行**：当前环境不具备桌面控制能力，5 个条目均只能记为「待人类验收」，未标注为通过。人工验收步骤已写入 `docs/internal/qa/human-acceptance-checklist.md` 对应 ID。
- **Serpent-a9n 缺真实媒体解码证据**：新增逻辑复用了已被 `CANVAS-014`（`Serpent-05o`）验收过的画布卡片播放机制，但 Inspector 侧的具体接线（独立 hook 实例、`<video>`/`<img>` 切换）没有对应的 Electron E2E 覆盖真实视频/GIF 解码；仅有决策纯函数 `resolveLivePreviewMedia` 的单测。按验收纪律第 2 条，这不构成"媒体已解码"证据，只能记为未验证，需要具备真实 Electron 环境的 agent 或人工用真实视频/GIF 资产核实播放确实发生（而非仅仅 DOM 出现 `<video>` 标签）。
- **Serpent-ayf 无 React 组件级测试**：仓库单测环境是纯 Node（无 jsdom/`@testing-library/react`），因此"remount 不重置 idle"这一行为本身无法用组件渲染测试直接复现回归；已通过把状态提升到不重挂载的父组件从架构上消除问题根因，并对新增的纯策略函数 `shouldWakeViewerChrome` 做了单测，但没有端到端断言"切换 3 次资产后 chrome class 仍是 `is-chrome-idle`"。建议后续补一条 Playwright E2E：进入查看页→等待渐隐→键盘左右切图两次→断言 `.workspace-viewer` 仍带 `is-chrome-idle`→移动鼠标→断言消失。
- **Serpent-627 的 72% 数值是主观取值**：没有可自动化的"半透明但仍可读"对比度断言（涉及背后画面/画布材质是任意图片内容，无法用固定阈值判断可读性），最终是否"不透明度不要太低"仍需要人工在真实素材上确认，可能需要根据反馈微调该 token。
- **未触碰的相关但超出范围的项**：`docs/internal/qa/human-acceptance-checklist.md` 中 `VIEWER-005`（视频 Fit）、`VIEW-011`（自绘 transport）等既有条目复用了同一批 chrome class（`preview-chrome-fade`），本次改动只调整背景不透明度与唤醒策略，未改变其淡入淡出/尺寸行为，理论上不应回归，但建议人工复验时顺带确认。
