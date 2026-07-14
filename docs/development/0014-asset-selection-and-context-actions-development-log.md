# 切片 0014 开发日志：资产选择与上下文操作（P0 右键菜单热修）

> 状态：P0 热修完成（自动化 + 双轴审查通过）；P1（框选/组合键/移除批量条/视觉打磨）待实施
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
| Unit + Worker 测试 | 320 passed（回归，上下文菜单不影响后端） |
| Electron E2E `context-menu` | 7/7 通过（含 blur/四角 clamp/scope-change 3 项新增） |
| Electron E2E 回归 `organization-search-trash` | 3/3 通过 |
| Electron E2E 回归 `media-preview` | 2/2 通过 |
| Electron E2E 回归 `browsing-preferences` | 2/2 通过 |

## 双轴审查结论

- **Standards**：0 HARD 违规。unified context 与单一 `useContextMenu` hook 统一了此前分散的 3 套菜单实现；5 套独立但语义清晰的 `useEffect` 监听块确保无 listener 泄漏（cleanup 对称）；外部点击通过 document-level capture 监听 + `querySelector(".context-menu")` 实现，backdrop 以 `pointer-events:none` 避免拦截正常交互。死代码 `useSingleContextMenu` export 别名已移除。
- **Spec**：P0 功能全部满足（可靠关闭、viewport clamp/flip、单菜单 mutex、键盘导航、可访问名称）。测试缺口（blur/四角/scope-change）已关闭。P1 架构安全——统一组件基础设施为后续批量菜单提供基础，无范围蔓延。
- **非阻断气味（记录为后续项）**：5 套重复的 `useEffect` 监听块可抽取共享 helper；backdrop 的 `querySelector(".context-menu")` 属于 Feature Envy（应由 ContextMenu 组件管理自己的 ref，而非 backdrop 查询 DOM）；App.tsx 的引号风格变更产生大范围 diff 噪声；资产菜单使用 inline IIFE。均为判断/改进项，不阻断合并。

## 状态

P0 热修完成（自动化绿 + 双轴审查通过）。P1 完整切片（框选、组合键模型、移除顶部批量条、统一批量右键菜单、视觉打磨）仍待实施。**未被 accepted**——macOS Computer Use 人工视觉 QA 与 Windows 平台验证未执行。

## 遗留风险

- P1 批量右键菜单尚未实现；多选后的 ops bar 仍存在于 App.tsx 顶部。
- 框选和组合键（Ctrl/Shift/Command）模型需完整 E2E + 真实双平台键盘验证。
- Windows 平台 `contextmenu` 事件行为（尤其 `button` 属性）未验证。
- Computer Use 截图验收（视觉一致性矩阵：资产/标签/合集/智能合集 + 四角 clamp）未执行。
