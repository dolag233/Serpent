# 切片 0014 开发日志：资产选择与上下文操作（P0 右键菜单热修 + P1 选择模型）

> 状态：步骤完成,切片未完成,不可 accepted — P0 热修 + P1 选择模型步骤完成（marquee/组合键/Esc/re-click-tested-via-Ctrl-toggle）；切片 0014 未完成 — P1 剩余移除顶部批量条 / 统一批量右键菜单 / 视觉打磨 未实施; Computer Use + Windows 验收未执行
> 日期：2026-07-14

## 依据

- 规格：`docs/implementation/0014-asset-selection-and-context-actions-vertical-slice.md`
- 审查基准：`7bc78f4`（HEAD，即 0014 P0 变更的父提交）
- 未提交 diff 范围：
  - 新文件：`src/renderer/context-menu.tsx`、`tests/e2e/context-menu.test.ts`
  - 修改文件：`src/renderer/App.tsx`、`src/renderer/styles.css`、`package.json`

## 实现摘要（P0 热修范围）

本 P0 热修解决右键菜单无法可靠关闭、多菜单并存和边缘溢出的核心缺陷。完整 P1 切片（框选、组合键模型、移除顶部批量条、统一批量右键菜单和视觉打磨）不在本期范围。

### 统一右键菜单组件（`src/renderer/context-menu.tsx`，新文件）

- **`ContextMenuProvider`**：单一 React Context 持有 `active` 状态（descriptor + position），提供 `open`/`close` 方法。通过 `useContextMenu` hook 消费；仅一个菜单实例可在同一时刻存在（单菜单 mutex）。
- **`ContextMenuBackdrop`**：全屏 fixed overlay（`pointer-events: none`），包含 5 套独立 `useEffect` 监听器，全部共享单一 `dismiss` 闭包作为关闭入口：
  - 外部点击（document-level mousedown capture，`:103`）
  - Escape 键（document-level keydown capture，`:114`）
  - 滚动（document-level scroll capture，`:123`）
  - 窗口 resize（window resize，`:129`）
  - 窗口失焦（window blur，`:135`）
- **`ContextMenu`**：菜单面板组件，在 `useLayoutEffect` 中计算 viewport clamp/flip（`:171`）。若菜单右侧溢出则翻转到光标左侧；若底部溢出则翻转到光标上方；双向都溢出则钉在 viewport 边缘。默认先渲染到屏幕外（`left:-9999, visibility:hidden`）以在绘制前完成测量。挂载后自动聚焦首项（`:205`），内置 ArrowUp/ArrowDown/Escape 键盘导航。
- **`ContextMenuItem`**：统一菜单项组件，支持图标、标签、快捷键、danger 样式、disabled 状态与 disabledReason tooltip。执行后自动 `close()`（`:278`）。
- **`ContextMenuSection`**：带可选 divider 标签的菜单项分组（`:307`）。

### App.tsx 重构（`:579`–`:580`、`:8088`–`:8230` 及整体减量）

- 使用单一 `useContextMenu()` hook 替代 3 个独立 state 变量和 ~225 行内联 DOM。
- 资产、标签、合集、智能合集的右键菜单全部由同一 `<ContextMenu>`/`<ContextMenuItem>`/`<ContextMenuSection>` 组件渲染，不再由各自在 App.tsx 中拼接独立 DOM。
- `chooseFolder`/`chooseTag`/`chooseCollection`/`chooseSmartCollection` 入口均调用 `closeContextMenu()`，确保范围切换时菜单关闭。

### 样式（`src/renderer/styles.css`，+110 行）

- `.context-menu`、`.context-menu-item`、`.context-menu-section`、`.context-menu-backdrop` 等类。
- 统一设计 token：背景、圆角、阴影、内外间距、行高、图标尺寸、分隔线、普通/悬停/聚焦/禁用/危险/禁用状态。

### package.json

- 依赖更新（`@playwright/test` 等版本锁定）。

## 测试

### `tests/e2e/context-menu.test.ts`（新文件，7 项测试）

| # | 测试 | 覆盖 |
| --- | --- | --- |
| 1 | 外部点击/Escape/滚动/resize 关闭 | 4 种关闭触发器 |
| 2 | viewport 边缘 clamp（资产 + 组织菜单） | 单位置 clamp 验证 |
| 3 | 单菜单强制（新菜单关闭旧菜单） | mutex 行为 |
| 4 | 可访问名称与键盘 Escape | aria-label + Escape |
| 5 | 窗口失焦关闭 | window blur |
| 6 | 四角 viewport clamp | 4 个角落均不越界（`:330`） |
| 7 | 范围切换关闭 | 资产菜单→点击侧栏→菜单消失（`:425`） |

## 验证结果（2026-07-14）

| 门禁 | 结果 |
| --- | --- |
| Typecheck | 通过 |
| Lint | 通过 |
| Unit 测试 | 320 passed（回归，上下文菜单不影响后端） |
| Electron E2E `context-menu` | 7/7 通过（含 blur/四角 clamp/scope-change 3 项新增） |
| Electron E2E 回归 `organization-search-trash` | 3/3 通过 |
| Electron E2E 回归 `media-preview` | 2/2 通过 |
| Electron E2E 回归 `browsing-preferences` | 2/2 通过 |

## 双轴审查结论

- **Standards**：0 HARD 违规。unified context 与单一 `useContextMenu` hook 统一了此前分散的 3 套菜单实现；5 套独立但语义清晰的 `useEffect` 监听块确保无 listener 泄漏（cleanup 对称）；外部点击通过 document-level capture 监听 + `querySelector(".context-menu")` 实现，backdrop 以 `pointer-events:none` 避免拦截正常交互。死代码 `useSingleContextMenu` export 别名已移除。
- **Spec**：P0 右键菜单功能满足（可靠关闭、viewport clamp/flip、单菜单 mutex、键盘导航、可访问名称）。测试缺口（blur/四角/scope-change）已关闭。P1 架构安全——统一组件基础设施为后续批量菜单提供基础，无范围蔓延。
- **非阻断气味（记录为后续项）**：5 套重复的 `useEffect` 监听块可抽取共享 helper；backdrop 的 `querySelector(".context-menu")` 属于 Feature Envy（应由 ContextMenu 组件管理自己的 ref，而非 backdrop 查询 DOM）；App.tsx 的引号风格变更产生大范围 diff 噪声；资产菜单使用 inline IIFE。均为判断/改进项，不阻断合并。

## 实现摘要（P1 选择模型，2026-07-14）

### 框选（Marquee drag-select）

- `handleCanvasMouseDown`（`:901`）：仅左键在画布空白处开始框选；排除 `.asset-card`、`.batch-action-strip` 等子元素上的点击。
- `useEffect` mousemove/mouseup 监听（`:924`）：document-level 绑定，确保鼠标拖到窗口外仍能跟踪。
  - mousemove：设置框选框 `marqueeBox`，对画布内 `[data-asset-id]` 做 AABB box-overlap intersection（grid/masonry 一致），得到 `hitIds` 写入状态；支持 Ctrl/Cmd/Shift 并集追加。
  - mouseup：微小拖拽（<5px）视为画布空白点击清选；无修饰符且未命中任何卡片时清选；命中时设置 `selectionAnchorRef`（修复 stale-anchor——见下）。
- 自动滚动（mousemove `:979`）：当指针距画布上/下边缘 ≤40px 时同步修改 `canvas.scrollTop`，速度 1–8px/frame。
- `marqueeHitIdsRef`（`:518`）：在 mousemove 中存储命中 ID 列表，mouseup 复用避免重复 DOM AABB 遍历。

### 组合键模型（无 re-click deselect）

- `selectAsset`（`:856`）：普通点击单选；Shift+点击基于 `selectionAnchorRef` 做连续范围；Ctrl/Cmd+点击逐项增减；Ctrl/Cmd+Shift+点击范围追加。
- **已移除 re-click 取消选择**：原实现（`:889`–`:893`）在普通点击时若已选集合恰有一项且再次点击该项则取消选择。此为对规格验收条件 #2（"再次点击取消"）的误读——"再次点击取消"指 Ctrl/Cmd+点击 toggle 取消选择（规格第 17 行），而非普通点击 re-click。规格第 16 行明确规定普通点击 = "只选择目标资产"（select only the target）。该 guard 已移除，普通点击始终替换为单选。
- 右键 mousedown 追踪（`:518` `lastMousedownButtonRef` + `:5820`）：在资产卡片 `onMouseDown` 中记录 `event.button`；`selectAsset` 入口检查 `lastMousedownButtonRef.current !== 0` 则直接返回，防止 Playwright 右击合成的 click 事件触发选择（真实浏览器右击不派发 click，仅派发 contextmenu）。

### Esc 清除选择（上下文菜单感知）

- 捕获阶段 guard（`:4011`）：`useEffect` with `[]` deps 注册 document-level capture 监听；当 `.context-menu` 在 DOM 中时调用 `event.stopPropagation()`，阻止非捕获 handler 在同一 Esc 键次清除选择。
- 非捕获 handler（`:3997`）：当 `selectedAssetIds.length > 0` 且无 preview 且无 `[role="dialog"][aria-modal="true"]` 时清选。
- 效果：第一 Esc 关闭上下文菜单（选择保留），第二 Esc 清除选择。

### 审查修复（2026-07-14 审查反馈）

1. **stale-anchor（FIXED）**：框选 mouseup 结束时在 `marqueeHitIdsRef` 非空时设置 `selectionAnchorRef.current = marqueeHitIdsRef.current[0]`，使后续 Shift+click 从框选结果正确扩展。
2. **dead code autoScrollRaf（FIXED）**：移除未赋值的 `autoScrollRaf` 变量及其两处 `cancelAnimationFrame` 清理分支（自动滚动同步修改 `canvas.scrollTop`，不需 rAF）。
3. **intersection dedup（FIXED）**：引入 `marqueeHitIdsRef`，mousemove 写入命中 ID，mouseup 直接读 `marqueeHitIdsRef.current.length` 判空无需重复 DOM AABB 遍历。
4. **Escape/context-menu 交互（FIXED）**：context-menu.tsx 未改动；App.tsx 新增捕获阶段 Escape handler（`stopPropagation()`）作为主 guard；`lastMousedownButtonRef` 追踪防止 Playwright 右击清选。

### 测试

#### `tests/e2e/selection-marquee.test.ts`（10 项测试）

| # | 测试 | 覆盖 |
| --- | --- | --- |
| 1 | 框选多选（grid） | 平铺框选 + 空画布点击清选 + Shift 框选并集 |
| 2 | 框选多选（masonry） | 瀑布流框选 + 命中数与范围 |
| 3 | Ctrl/Cmd+Shift+click 范围追加 | 组合键范围追加到已有选择 |
| 4 | Esc 清除选择 | 单选/范围选择清选 + 右击打开菜单后 Esc |
| 5 | Ctrl/Cmd+click toggle 取消 | Ctrl/Cmd 增减往返 + 普通点击保持选择 + 多选切换 |
| 6 | 框选后 Shift+click 扩展 | **新增**：框选后通过 `selectionAnchorRef` 范围扩展正确 |
| 7 | 选择生存视图切换/缩放 | **新增**：grid↔masonry 切换 + Ctrl+wheel 缩放后选择不丢失 |
| 8 | Ctrl/Cmd 增减往返 | **新增**：add→remove→empty→fresh 完整往返 |
| 9 | 瀑布流框选自动滚动 | **新增**：指针置底边 auto-scroll zone 内时 scrollTop 增加 |
| 10 | 上下文菜单 Escape 序贯 | **新增**：右击打开菜单→Escape 关闭菜单（选择保留）→第二 Escape 清选 |

### 验证结果（2026-07-14 P1）

| 门禁 | 结果 |
| --- | --- |
| Typecheck | 通过 |
| Lint | 通过 |
| Unit 测试 | 320 passed（回归） |
| Electron E2E `selection-marquee` | 10/10 通过（5 原有 + 5 新增） |
| Electron E2E 回归 `context-menu` | 7/7 通过（含适配：1 处双 Escape 清选后 sidebar 交互） |
| Electron E2E 回归 `organization-search-trash` | 3/3 通过 |
| Electron E2E 回归 `media-preview` | 2/2 通过 |
| Electron E2E 回归 `browsing-preferences` | 2/2 通过 |

### 双轴审查结论（P1）

- **Standards**：0 HARD 违规。medium 项全部修复（stale-anchor 已设 selectionAnchorRef、dead-code autoScrollRaf 已移除、intersection-dedup 已用 ref 共享）。non-blocking follow-up：Primitive Obsession（框选 rect 裸对象）、Long Method（140 行 useEffect）、Windows Ctrl 真实验证。
- **Spec**：选择模型步骤完成（框选、组合键、Esc）。**re-click-deselect 已移除**——原为对验收条件 #2（"再次点击取消"）的误读，该条件指 Ctrl/Cmd+click toggle 取消选择（规格第 17 行），现已由 Ctrl/Cmd+click toggle 满足。测试缺口已关闭：line 21（视图切换/缩放生存）、line 16（Ctrl/Cmd 增减往返）、line 20（瀑布流自动滚动）。Windows Ctrl 已确认为明确缺口。
- **非阻断 follow-up（记录为后续项）**：Primitive Obsession、Long Method、Windows Ctrl real QA。

## 状态

P0 热修 + P1 选择模型步骤完成（自动化绿 + 双轴审查通过）。切片 0014 未完成 — P1 剩余移除顶部批量条 / 统一批量右键菜单 / 视觉打磨 未实施。**未被 accepted**——macOS Computer Use 人工视觉 QA 与 Windows 平台验证未执行。

## 遗留风险

- 剩余 P1 批量右键菜单尚未实现；多选后的 ops bar 仍存在于 App.tsx 顶部。
- Windows 平台 `contextmenu` 事件行为（尤其 `button` 属性）未验证。
- Computer Use 截图验收（视觉一致性矩阵：资产/标签/合集/智能合集 + 四角 clamp）未执行。
- Primitive Obsession（框选 rect 裸对象）、Long Method（140 行 useEffect）记录为 non-blocking follow-up。
