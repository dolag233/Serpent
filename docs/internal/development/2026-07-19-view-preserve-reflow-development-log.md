# 2026-07-19 查看页滚动还原 + 画布重排锚点 开发日志

## 范围

- `Serpent-cj6` / REQ-VIEW-008：退出查看页后保持浏览视图不变（滚动位置回归 `VIEWER-001`）。
- `Serpent-o3z` / REQ-CANVAS-019：画布尺寸变化（拖侧栏、改窗口宽度）时重排并保持视图锚点。

来源：`docs/internal/implementation/mvp-ui-ux-requirements-backlog.md` 2026-07-18 第五批反馈（B 段 REQ-VIEW-008 / REQ-CANVAS-019）。

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
- 文档：`docs/internal/qa/human-acceptance-checklist.md`（`VIEWER-001` 重新置为「待人类验收」并追加回归/修复说明；新增 `CANVAS-021`；反馈处理记录追加一行）

## 自动化证据

| 命令 | 结果 |
| --- | --- |
| `npx vitest run tests/unit/canvas-scroll-anchor.test.ts tests/unit/view-restore.test.ts` | 21/21 通过 |
| `npx vitest run tests/unit` | 90 files / 855 tests 通过（含以上两个新文件） |
| `npx tsc --noEmit` | 仅剩一个与本次改动无关的既有错误：`src/renderer/MoveDialog.tsx(68,46)` 缺 `directAssetCount` 字段（`HEAD` 提交 `82d316b`，非本次改动引入，属于文件夹维度相关的并行改动，未触碰） |
| `npx eslint src/renderer/canvas-scroll-anchor.ts src/renderer/view-restore.ts tests/unit/canvas-scroll-anchor.test.ts tests/unit/view-restore.test.ts src/renderer/App.tsx` | 0 error；16 条 pre-existing `react-hooks/exhaustive-deps` warning，均在本次未触碰的行号（`t`/`locale` 依赖，历史遗留） |

## 未覆盖 / 后续

### 2026-07-26 CANVAS-021 follow-up

连续拖动侧栏会触发一串 ResizeObserver 回调。修复前每次回调都会重新选取当前顶缘资产作为锚点；第一次重排把 `scrollTop` 重置后，后续回调可能把锚点更新成列表开头，导致视图跳回最前面。现在一个连续 reflow burst 只在第一次宽度变化时捕获锚点，后续回调复用该锚点，布局稳定后再释放。对应回归单测覆盖锚点不会在 burst 中被替换。

- **此前 Computer Use 未执行**：该记录对应上一轮修复，不能作为本轮验收证据；人工验收步骤仍写入 `docs/internal/qa/human-acceptance-checklist.md` 的 `VIEWER-001` 与 `CANVAS-021`。
- **2026-07-27 Computer Use 复测**：全新 `npm start` 实例加载持久化资源库后，在瀑布流深滚动位置分别拖动 Inspector（约 1093→950）和导航栏（约 220→300）。两次重排后仍停留在原来的中段资产集合，未跳回文件夹/列表开头。复测同时定位到瀑布流内部快照只在首次挂载捕获的问题，已改为每次列宽变化捕获当前 `scrollTop`，并在后续布局高度稳定期间连续恢复。

### 2026-07-27 CANVAS-021 second follow-up

用户复验发现上一轮仍有拖动过程中的视口滑动。新增复现追踪后确认：拖动期间 `scrollTop` 可以保持不变，但瀑布流列数随每个 `pointermove` 实时变化，同一滚动偏移因此映射到另一批资产；单纯锁滚动值并不能保持视野内容。

本轮修复为拖动会话冻结内容布局宽度：按下分隔条时同步冻结文件夹行和资产网格宽度、关闭浏览器 `overflow-anchor`，拖动期间不再实时重排；拖动结束由 `usePanelResize` 的 `onResizeEnd` 回调释放冻结，并只执行一次锚点恢复。冷启动后的 Computer Use 复测中，瀑布流从深滚动位置将导航栏约 220→420 拖动后，前后截图保持同一批资产；连续缩放仍保持原锚点。

### 2026-07-27 CANVAS-021 third follow-up

用户再次复验指出：拖动期间虽已冻结，但松手重排后的视图位置仍未对齐。本轮建立了“同一资产的内部锚点在重排后必须回到同一 clientY”的确定性回归，定位到两个根因：

1. `App.tsx` 用 `{ ...element.getBoundingClientRect() }` 构造锚点卡片；真实浏览器的 `DOMRect` 几何属性不是可枚举自有属性，对象展开后 `top/left/width/height` 实际为空，锚点坐标变成 `NaN`。
2. 恢复循环每轮都先写回拖动前的原始 `scrollTop`，第二轮又因矩形稳定提前退出，从而撤销上一轮刚算出的精确补偿。

新增 `rectLikeFromDomRect` 显式复制四个几何字段，并把面板拖动、容器 ResizeObserver、卡片缩放三条测量路径统一接入；恢复循环只在开始时应用一次原始滚动快照，随后最多七帧按锚点误差收敛，连续两帧小于 0.5px 才提前结束。

自动化：

- `npx vitest run tests/unit/canvas-scroll-anchor.test.ts tests/unit/canvas-reflow-restore.test.ts --config vitest.config.ts`：21/21 通过。
- `npm run typecheck`：未通过；当前工作树存在与本改动无关的并行类型错误（`AssetContextMenu.tsx`、extension/radial/AI/media 测试），本改动涉及文件无新增 TypeScript 诊断。

真实应用：

- 冷启动 `npm start`，加载持久化的 155 项资源库并滚动至瀑布流深处。
- 导航栏约 248→420：锚点资产内部点最终回到 clientY=125，恢复过程还捕获到 Chromium 自身一次滚动回拨并再次收敛。
- 导航栏约 420→248：另一锚点资产内部点同样最终回到 clientY=125。
- 正反两次均未在拖动过程中重排；松手后才重排并完成精确锚点补偿。

所有 `[DEBUG-canvas-anchor]` 临时诊断在提交前已删除。
- **真实 Electron E2E 未新增**：`VIEWER-001` 现有的 `tests/e2e/asset-pagination.test.ts` 覆盖"深滚动进入/退出查看页"场景，但不覆盖"查看期间拖侧栏/改窗口宽度导致重排"这一具体回归路径；受限于本回合时间与并行 filter agent 同时改动 `App.tsx`，未新增覆盖该组合场景的 E2E，只有几何层的单测。建议后续补一条 Playwright 用例：进入查看页 → 触发窗口 resize → 关闭 → 断言选中资产仍可见。
- **画布重排锚点的“最近命中”策略**是几何近似（挑离视口中心最近、且与可视区域有垂直重叠的卡片），跟已有卡片缩放锚点逻辑一致，但没有模拟真实鼠标 hover 命中测试（`elementFromPoint`）；容器宽度重排场景下没有明确的“鼠标位置”概念，因此用画布视口中心作为锚点参考点，如后续人工验收发现锚点资产选择不符合直觉（例如用户视觉关注点不在正中），可再调整参考点策略。

### 2026-08-04 CANVAS-021 follow-up

- **根因补充**：外层 `workspace-canvas` 已经负责按资产锚点补偿滚动，但 `MasonryColumns` 仍保留一套独立的原始 `scrollTop` 回放循环。面板拖拽结束后的布局宽度变化会同时触发两套恢复逻辑，瀑布流的旧回放可能在外层补偿之后把视口写回旧像素位置，造成可见资产集合再次跳变。
- **修复**：新增 `isCanvasReflowRestorationPending` 状态判定。画布在 `is-reflow-frozen`（拖拽中）和 `is-reflow-restoring`（拖拽结束后的锚点收敛）两个阶段都禁止 Masonry 原始滚动快照/回放，只更新最终布局宽度；外层锚点调度器成为唯一滚动恢复者。锚点收敛完成后才解除该状态。
- **自动化证据**：`tests/unit/canvas-reflow-restore.test.ts` 9/9 通过；`npm run typecheck` 通过；针对 `App.tsx`、重排模块和单测的 ESLint 通过。本轮仍未替代用户的人类验收，工单继续保持待人类验收。
- `MoveDialog.tsx` 的既有 `directAssetCount` 类型错误与本工单无关，未做修复（避免与同时进行文件夹维度相关改动的并行 agent 冲突）；移交该改动的负责方处理。

### 2026-08-06 CANVAS-021 regression follow-up

- **根因补充**：`MasonryColumns` 的原始 `scrollTop` 回放会持续约 12 帧；用户在重排期间主动滚动时，旧回放仍会把视口写回旧位置。窗口缩放/面板重排后的内容虽保持，但用户滚动意图被覆盖。
- **修复**：`App.tsx` 为原始回放记录预期写入位置，并监听画布滚动。与预期位置不同的滚动事件立即取消回放；回放自身产生的同位置事件只清除一次性标记，不触发取消。画布重排期间仍由外层锚点恢复逻辑独占滚动补偿。
- **自动化证据**：`npm run typecheck && npm run lint` 通过；`node scripts/run-e2e.mjs tests/e2e/browsing-preferences.test.ts tests/e2e/organization-search-trash.test.ts` 通过（8 passed，macOS 开发态，临时 userData 隔离）。`folder-context-menu.test.ts` 与 `organization-metadata-persistence.test.ts` 定向回归另通过 7/8，后续修正定位器后纳入四文件复测。
- **主线复核**：`npm run verify:mainline` 通过；当前工作树的主线 Electron E2E 为 `72 passed / 3 skipped`，包含浏览、上下文菜单、文件夹和回收站路径。
- **状态**：仍待用户本人进行拖拽/滚动视觉验收；packaged 与 Windows 未执行。
