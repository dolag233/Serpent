# 2026-07-19 查看页滚动还原 + 画布重排锚点 开发日志

## 范围

- `Serpent-cj6` / REQ-VIEW-008：退出查看页后保持浏览视图不变（滚动位置回归 `VIEWER-001`）。
- `Serpent-o3z` / REQ-CANVAS-019：画布尺寸变化（拖侧栏、改窗口宽度）时重排并保持视图锚点。

来源：`docs/implementation/mvp-ui-ux-requirements-backlog.md` 2026-07-18 第五批反馈（B 段 REQ-VIEW-008 / REQ-CANVAS-019）。

## 根因

- **REQ-VIEW-008**：`closeAssetPreview` 原实现只把画布 `scrollTo` 到进入查看页前记录的**原始像素坐标**（`previewScrollPositionRef`），完全不考虑查看期间画布是否发生过重排。`JustifiedAssetRows` / `MasonryColumns` 都用自己的 `ResizeObserver` 跟踪容器宽度并据此重新分行/分列；查看页容器用 `.workspace-canvas.is-viewing { display: none }` 隐藏画布（見 `styles.css:2645`），本身不会改变宽度语义，但只要查看期间用户拖动了检查器/导航栏分隔条或改变了窗口宽度，关闭时画布可用宽度已经和进入前不同，行/列重新分布后原来的像素坐标会落在完全不同的资产上——这正是用户复现的回归。
- **REQ-CANVAS-019**：`JustifiedAssetRows`/`MasonryColumns` 的宽度变化只触发内部 `setAvailableWidth` 重新排版，从未做过任何滚动补偿；已有的锚点补偿逻辑（`resizeAssetCards`）只在卡片大小滑块/触控板缩放时触发，从不监听画布容器本身的宽度变化，所以拖侧栏或改窗口宽度会让重排后的资产跳出原视野。

## 方案

新增两个纯函数模块（DOM 测量留在 `App.tsx`，模块本身不触碰 DOM，可脱离 jsdom 单测）：

- `src/renderer/canvas-scroll-anchor.ts`：通用几何原语。`pickNearestCard` 在候选卡片中挑选离给定视口点最近、且与可视区域有垂直重叠的一张；`captureAnchor` 把该卡片相对视口点的位置记成比例锚点；`computeAnchorScrollDelta` 计算重排后要把滚动再挪多远才能让锚点回到同一屏幕位置；`clampScrollOffset` 统一滚动范围钳制。
- `src/renderer/view-restore.ts`：查看页专用的还原决策，构建在上面的几何原语之上。`captureBrowseViewSnapshot` 在打开查看页时记录「原始滚动像素 + 该资产卡片的锚点」；`resolveBrowseRestoreScroll` 在关闭时先看能否用锚点算出的修正滚动位置（找得到卡片时），找不到就退回原始像素位置（并钳制到当前可滚动范围）。

`App.tsx` 改动：

- `resizeAssetCards`（卡片大小滑块/触控板缩放锚点保持）重构为调用上述共享几何函数，行为不变，减少重复实现。
- 新增 `scheduleAnchorRestore`（模块级函数，`AppInner` 之前）：统一"双 `requestAnimationFrame` 等重排稳定 → 校验滚动位置未被其它意图动过 → 按锚点补偿滚动"这套既有模式，供卡片大小与容器宽度两条触发路径共用，各自持有独立的 rAF 句柄（`cardSizeRestoreFrameRef` / `reflowRestoreFrameRef`），避免相互取消。
- 新增一个 `useEffect`：用 `ResizeObserver` 监听 `workspaceCanvasRef`（画布容器本身，与视图模式无关，对网格/瀑布流通用）宽度变化。查看页把画布 `display:none`（宽度报 0）与关闭查看页把它变回可见（宽度从 0 恢复）都会触发该 observer；用 `width <= 0` 直接跳过并清空 `lastWidth`（不误判为"真实"的容器宽度变化）、`previewAssetRef`（`useLayoutEffect` 同步维护，供 observer 回调读取最新查看态）双重防御，确保这条通用重排锚点逻辑不会跟查看页关闭自身的还原逻辑打架；只有查看态之外的真实宽度变化才会触发锚点捕获与补偿。
- `openAssetPreview` 现在同时记录原始滚动像素与「被查看资产卡片」的锚点快照（`captureBrowseViewSnapshot`）；`closeAssetPreview` 的两帧等待结束后，先落到原始像素位置，再用 `resolveBrowseRestoreScroll` 按锚点修正，覆盖查看期间发生的重排。

## 涉及文件

- 新增：`src/renderer/canvas-scroll-anchor.ts`、`src/renderer/view-restore.ts`
- 新增测试：`tests/unit/canvas-scroll-anchor.test.ts`（13 例）、`tests/unit/view-restore.test.ts`（8 例）
- 修改：`src/renderer/App.tsx`（`resizeAssetCards` 重构、新增重排 `ResizeObserver` effect、`openAssetPreview`/`closeAssetPreview` 改为锚点还原）
- 文档：`docs/qa/human-acceptance-checklist.md`（`VIEWER-001` 重新置为「待人类验收」并追加回归/修复说明；新增 `CANVAS-021`；反馈处理记录追加一行）

## 自动化证据

| 命令 | 结果 |
| --- | --- |
| `npx vitest run tests/unit/canvas-scroll-anchor.test.ts tests/unit/view-restore.test.ts` | 21/21 通过 |
| `npx vitest run tests/unit` | 90 files / 855 tests 通过（含以上两个新文件） |
| `npx tsc --noEmit` | 仅剩一个与本次改动无关的既有错误：`src/renderer/MoveDialog.tsx(68,46)` 缺 `directAssetCount` 字段（`HEAD` 提交 `82d316b`，非本次改动引入，属于文件夹维度相关的并行改动，未触碰） |
| `npx eslint src/renderer/canvas-scroll-anchor.ts src/renderer/view-restore.ts tests/unit/canvas-scroll-anchor.test.ts tests/unit/view-restore.test.ts src/renderer/App.tsx` | 0 error；16 条 pre-existing `react-hooks/exhaustive-deps` warning，均在本次未触碰的行号（`t`/`locale` 依赖，历史遗留） |

## 未覆盖 / 后续

- **Computer Use 未执行**：本回合无法操作真实 Electron 应用做视觉验收（当前环境不具备桌面控制能力）。人工验收步骤已写入 `docs/qa/human-acceptance-checklist.md` 的 `VIEWER-001`（回归复验）与新增 `CANVAS-021`；请人工按步骤操作后给出结论。
- **真实 Electron E2E 未新增**：`VIEWER-001` 现有的 `tests/e2e/asset-pagination.test.ts` 覆盖"深滚动进入/退出查看页"场景，但不覆盖"查看期间拖侧栏/改窗口宽度导致重排"这一具体回归路径；受限于本回合时间与并行 filter agent 同时改动 `App.tsx`，未新增覆盖该组合场景的 E2E，只有几何层的单测。建议后续补一条 Playwright 用例：进入查看页 → 触发窗口 resize → 关闭 → 断言选中资产仍可见。
- **画布重排锚点的"最近命中"策略**是几何近似（挑离视口中心最近、且与可视区域有垂直重叠的卡片），跟已有卡片缩放锚点逻辑一致，但没有模拟真实鼠标 hover 命中测试（`elementFromPoint`）；容器宽度重排场景下没有明确的"鼠标位置"概念，因此用画布视口中心作为锚点参考点，如后续人工验收发现锚点资产选择不符合直觉（例如用户视觉关注点不在正中），可再调整参考点策略。
- `MoveDialog.tsx` 的既有 `directAssetCount` 类型错误与本工单无关，未做修复（避免与同时进行文件夹维度相关改动的并行 agent 冲突）；移交该改动的负责方处理。
