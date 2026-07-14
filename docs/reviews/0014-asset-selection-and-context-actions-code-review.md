# 切片 0014 双轴代码审查：资产选择与上下文操作（P0 右键菜单热修 + P1 选择模型）

> 状态：双轴通过（0 HARD 违规）；P0 规格满足，P1 选择模型完成
> 日期：2026-07-14

## 审查范围

- 审查基准：`7bc78f4`（HEAD，即 0014 P0 变更的父提交）
- 未提交 diff 范围：
  - **新文件**：`src/renderer/context-menu.tsx`（321 行）、`tests/e2e/context-menu.test.ts`（489 行，7 项测试）
  - **修改文件**：`src/renderer/App.tsx`（479 行变更，-284/+307 — 消除 3 套内联菜单 DOM，统一至 `<ContextMenu>` 组件）、`src/renderer/styles.css`（+110 行）、`package.json`（1 处版本锁定变更）
- 规格：`docs/implementation/0014-asset-selection-and-context-actions-vertical-slice.md`

## Standards 轴

### 通过项（0 HARD 违规）

- **架构不变量完整**：所有数据库和文件操作仍在 Worker 进程；Renderer 通过 `serpent://` 协议和 `typedCommands/send` 调用 Worker；跨进程边界经 Zod 校验。上下文菜单组件仅为 UI 抽象，不引入新的数据路径。
- **统一上下文消除分散实现**：`ContextMenuProvider` + `useContextMenu` hook（`src/renderer/context-menu.tsx:47`–`78`）替代了此前 App.tsx 中 3 套独立的菜单状态变量和内联 DOM（~225 行），所有资产/标签/合集/智能合集菜单复用同一组件树（`App.tsx:8088`–`8230`）。
- **Listener 无泄漏**：`ContextMenuBackdrop` 的 5 套 `useEffect` 监听块（`:102`–`:138`）均有对称的 cleanup（`return () => removeEventListener(...)`），使用 capture phase 确保在子元素 stopPropagation 前捕获。
- **单菜单 mutex**：`ContextMenuProvider` 以单一 `active` state 持有菜单状态（`:56`），setter 天然保证同一时刻仅一个菜单存在（测试 3 验证 `[role="menu"]` count = 1）。
- **死代码已清理**：`useSingleContextMenu` export 别名（原 `:78`）已移除——grep 确认 `src/` 与 `tests/` 无导入方。
- **安全的 close 入口**：所有 close 路径收敛至 `dismiss` 闭包（`:94`），无分散的 `setActive(null)` 调用。
- **键盘可访问性**：`role="menu"`/`role="menuitem"`、`aria-label`、ArrowUp/ArrowDown 导航、`aria-disabled` 状态均已内置于组件（`:217`–`:241`、`:288`–`:299`）。

### 非阻断气味（4 项，记录为后续改进）

1. **5 套重复的 `useEffect` 监听块**（`src/renderer/context-menu.tsx:102`–`:138`）：每个 close trigger（mousedown/keydown/scroll/resize/blur）有独立的 `useEffect` + `addEventListener` + cleanup 模式，可抽取为 `useCloseOnEvent(event, handler)` 共享 helper 减少重复。当前不阻塞——每个块只有 5 行，语义清晰，且 cleanup 正确。
2. **Backdrop Feature Envy**（`src/renderer/context-menu.tsx:103`）：`ContextMenuBackdrop` 通过 `document.querySelector(".context-menu")` 查询菜单 DOM 来判断点击是否在菜单内。更清洁的做法是由 `ContextMenu` 组件通过 `useImperativeHandle` 或 ref 暴露 `contains` 方法，或使用 React portal + ref-based 判断。当前方案功能正确，但引入隐式的 class-name 耦合。
3. **App.tsx 引号风格大范围 diff 噪声**：此次重构中 App.tsx 整体的引号风格从双引号变更为单引号（或其他方向），产生大量非功能性 diff，混淆了实际逻辑变更的审查。建议后续独立 commit 或在工具层统一格式化规则。
4. **资产菜单 inline IIFE**（`App.tsx:8189`）：资产菜单通过 `{(() => { ... })()}` 内联计算 `assetId`。extract 为独立 `AssetContextMenu` 子组件可读性更好。当前 40 行 IIFE 功能正确，不阻塞。

## Spec 轴

### P0 功能满足

- **统一右键菜单组件**：规格第 36–40 行（"不再由资产、标签、合集、智能合集各自在 App.tsx 拼一套菜单 DOM"）——已实现（`src/renderer/context-menu.tsx` 作为独立模块，`App.tsx` 引用统一组件）。
- **可靠关闭**：规格第 30 行（"点击菜单外部、Esc、滚动、窗口 resize、窗口失焦、切换范围及执行任意菜单项后都必须关闭"）——全部验证：
  - 外部点击：E2E 测试 1，`:102`–`:111` mousedown capture
  - Escape：E2E 测试 1/4，`:114`–`:120` keydown capture + `:237`–`:240` menu-level handler
  - 滚动：E2E 测试 1，`:123`–`:126` scroll capture
  - resize：E2E 测试 1，`:129`–`:132` window resize
  - blur：E2E 测试 5，`:135`–`:138` window blur
  - 范围切换：E2E 测试 7，`chooseFolder`/`chooseTag`/`chooseCollection`/`chooseSmartCollection` 均调用 `closeContextMenu()`（App.tsx `:1460`/`:1593`/`:1919`/`:2430`）
  - 菜单项执行后自动关闭：`:280`–`:284` `handleClick` 调用 `close()` after `onAction()`
- **Viewport clamp/flip**：规格第 31 行（"菜单根据 viewport 自动 clamp/flip，四角打开不溢出"）——`ContextMenu.useLayoutEffect`（`:171`–`:202`）实现双向 clamp（右溢出翻左，下溢翻上，双溢钉边），E2E 测试 2 和测试 6（四角）验证。
- **单菜单**：规格第 29 行（"同一时刻只允许一个上下文菜单存在"）——E2E 测试 3 验证。
- **视觉一致性**：规格第 37–40 行——统一 `.context-menu`/`.context-menu-item` 等 CSS 类定义 token（`src/renderer/styles.css`）；菜单项使用一致的"图标 + 动词 + 可选快捷键/状态"结构（`ContextMenuItem` props）；破坏性动作（`:8223` danger="danger"）单独分组。Computer Use 截图矩阵验收待执行。

### P1 选择模型（2026-07-14 审查，已实施）

审查基准：P0 变更的父提交 `7bc78f4` 至 P1 变更。diff 范围：
- 修改文件：`src/renderer/App.tsx`（框选 useEffect + selectAsset 增强 + Esc guard + 审查修复）、`src/renderer/styles.css`（框选框样式）、`package.json`
- 新增 E2E：`tests/e2e/selection-marquee.test.ts`（10 项测试）
- **未改动**：`src/renderer/context-menu.tsx`（仅 App.tsx 侧捕获 handler 修复 Esc 交互）

#### Standards 轴（P1）

- **0 HARD 违规**。所有数据库/文件操作仍在 Worker，Renderer 仅处理 UI 选择状态。
- **修复项（medium，已修复）**：
  1. stale-anchor：框选 mouseup 设置 `selectionAnchorRef.current = marqueeHitIdsRef.current[0]`，Shift+click 从框选结果正确扩展（E2E 测试 6 验证）。
  2. dead code `autoScrollRaf`：已移除变量及两处 `cancelAnimationFrame` 清理（自动滚动用同步 `canvas.scrollTop`）。
  3. intersection dedup：`marqueeHitIdsRef` 在 mousemove 写入命中 ID，mouseup 复用避免重复 DOM AABB 遍历。
  4. Escape/context-menu 交互：捕获阶段 `useEffect` with `[]` deps 注册 document-level capture handler；当 `.context-menu` 在 DOM 中时调用 `event.stopPropagation()` 阻止非捕获 handler 清选；`lastMousedownButtonRef` 追踪防止 Playwright 右击清选。
- **Non-blocking follow-up**：
  - Primitive Obsession：框选 rect 使用裸对象 `{left, top, right, bottom}`，建议未来抽取类型。
  - Long Method：框选 useEffect 约 140 行，可拆分 handleMouseMove/handleMouseUp 为独立函数。
  - Windows Ctrl：未验证，已确认为明确缺口。

#### Spec 轴（P1）

- **选择模型完成**（规格行 13–22）：
  - 框选（行 19–20）：3 阶段 document-level mousedown/mousemove/mouseup + AABB box-overlap intersection + 40px edge auto-scroll，grid/masonry 一致。
  - 普通点击单选、Shift 连续选择、Ctrl/Cmd 增减、Ctrl/Cmd+Shift 范围追加（行 15–18）。
  - Re-click 取消选择（行 15）：单卡 re-click 取消。
  - Esc 清除选择（行 21）：非捕获 handler 在无 context-menu/dialog 时清选；捕获 phase guard 确保上下文菜单打开时第一 Esc 仅关闭菜单。
- **测试缺口已关闭**：
  - Line 21（选择生存视图切换/缩放）：E2E 测试 7 验证。
  - Line 16（Ctrl/Cmd 增减往返）：E2E 测试 8 验证。
  - Line 20（瀑布流自动滚动）：E2E 测试 9 验证。
- **Windows Ctrl 已确认为明确缺口**（行 22），需真实 Windows QA。

#### P1 未实施（剩余）

- 移除顶部批量条：未实施。多选 ops bar 仍在 App.tsx 中。
- 批量右键菜单（"已选择 N 项"）：未实施。
- 统一批量菜单视觉打磨：未实施。

### Spec 偏离分析

P0 范围严格限定于右键菜单可靠性。P1 选择模型按规格实施并通过审查。剩余移除批量条/批量菜单/视觉打磨为有意的范围控制。

## 审查后修复

- **P0**：死代码 `useSingleContextMenu` export 别名已移除；3 项测试缺口已关闭。
- **P1**：4 项 medium 修复全部完成（stale-anchor/dead-code/intersection-dedup/Escape-interaction）；5 项 spec 测试缺口已关闭（selection-marquee 新增 5 项）；context-menu 测试适配（1 处双 Escape 清选后 sidebar 交互）。

## 结论

双轴通过：Standards 轴 0 HARD 违规（medium 项全部修复，non-blocking follow-up 已记录），Spec 轴 P0 完整满足 + P1 选择模型完成（剩余批量条/菜单/视觉打磨待实施）。代码未提交（working tree uncommitted）。macOS Computer Use 人工视觉 QA 与 Windows 平台行为仍未验证，切片整体尚未 accepted。

**非阻断 follow-up 列表（不阻断合并）**：
1. 抽取 `useCloseOnEvent` 共享 helper 减少 5 套重复监听块（P0）
2. Backdrop Feature Envy：以 ref-based 方案替代 `querySelector(".context-menu")`（P0）
3. App.tsx 引号风格变更后续独立 commit（P0）
4. 资产菜单 inline IIFE extract 为独立子组件（P0）
5. Primitive Obsession：框选 rect 裸对象抽取类型（P1）
6. Long Method：框选 useEffect 拆分为独立函数（P1）
7. Windows Ctrl 真实平台验证（P1）
4. 资产菜单 inline IIFE extract 为独立子组件
