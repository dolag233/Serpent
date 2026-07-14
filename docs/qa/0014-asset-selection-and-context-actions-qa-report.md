# 切片 0014 QA 报告：资产选择与上下文操作（P0 右键菜单热修）

> 状态：自动化全绿 + 规格覆盖完成；人工平台 QA 待执行
> 日期：2026-07-14

## Build under test

- 审查基准：`7bc78f4`（HEAD），即 0014 P0 变更的父提交
- 测试对象：当前 working tree 的未提交 diff
  - 新文件：`src/renderer/context-menu.tsx`、`tests/e2e/context-menu.test.ts`
  - 修改文件：`src/renderer/App.tsx`、`src/renderer/styles.css`、`package.json`

## 自动化结果（2026-07-14）

| 门禁 | 结果 |
| --- | --- |
| Typecheck | 通过 |
| Lint | 通过 |
| Unit + Worker 测试 | 320 passed（回归，上下文菜单不影响后端） |
| Electron E2E `context-menu` | 7/7 通过 |
| Electron E2E 回归 `organization-search-trash` | 3/3 通过 |
| Electron E2E 回归 `media-preview` | 2/2 通过 |
| Electron E2E 回归 `browsing-preferences` | 2/2 通过 |

## 上下文菜单 E2E 测试明细

| # | 测试名称 | 覆盖 |
| --- | --- | --- |
| 1 | 外部点击/Escape/滚动/resize 关闭 | 4 种 close trigger 均验证；menu 仍可在关闭后重新打开 |
| 2 | viewport 边缘 clamp（资产 + 组织菜单） | `boundingBox` 完全在 viewport 内的断言；标签右键菜单同样验证 |
| 3 | 单菜单强制 | 资产菜单 → 标签右击 → 资产菜单仅剩一个 `[role="menu"]` |
| 4 | 可访问名称与键盘 Escape | `aria-label` 非空；Escape 关闭 |
| 5 | 窗口失焦关闭 | `globalThis.dispatchEvent(new Event("blur"))` 触发关闭 |
| 6 | 四角 viewport clamp | 合成 `contextmenu` 事件以 `clientX/clientY` 定位 (5,5)/(w-5,5)/(5,h-5)/(w-5,h-5)；`getBoundingClientRect` 断言四角均不越界 |
| 7 | 范围切换关闭 | 资产菜单 → `所有资产` 侧栏点击 → 菜单消失 |

## 规格覆盖确认

- **验收条件 #4（关闭触发器）**：外部点击、Escape、滚动、resize、窗口失焦全部通过 E2E（测试 1 + 测试 5）。范围切换关闭通过 E2E（测试 7）。
- **验收条件 #4（四角不越界）**：四角 viewport clamp 通过 E2E（测试 6），所有角落 menu `getBoundingClientRect` 保持在 `[0, innerWidth] x [0, innerHeight]` 内。
- **单菜单强制**：通过 E2E（测试 3），同一时刻 `[role="menu"]` count = 1。
- **统一组件渲染**：资产、标签、合集、智能合集菜单均由 `<ContextMenu>`/`<ContextMenuItem>`/`<ContextMenuSection>` 渲染（`App.tsx:8088`–`8230`）。
- **可访问名称与键盘导航**：`aria-label` 非空 + Escape 通过 E2E（测试 4）。

## 双轴审查结论

- **Standards**：0 HARD 违规。死代码 `useSingleContextMenu` export 已移除。5 套独立 `useEffect` 监听块无 listener 泄漏（cleanup 对称）。
- **Spec**：P0 功能全部满足。P1 架构安全——统一组件为批量菜单提供基础。
- **非阻断气味（记录为后续项）**：5 套重复的 `useEffect` 监听块（可抽取共享 helper）；backdrop 的 `querySelector(".context-menu")` Feature Envy；App.tsx 引号风格大范围 diff 噪声；inline IIFE。
- **状态**：conditional — 非阻断项已记录为 follow-up。

## 平台与未完成项

- macOS：自动化全绿（typecheck/lint/unit/E2E 全 7 项）。Computer Use 人工 QA（视觉一致性矩阵：资产/标签/合集/智能合集 + 四角 clamp 截图）待执行。
- Windows：无 runner，未验证。`contextmenu` 事件行为（尤其 `button` 属性）存在平台差异风险。
- 打包后 macOS `.app` 冒烟（右键菜单在所有场景）待执行。

## 结论

自动化门禁全绿，7/7 上下文菜单 E2E 通过（含 3 项新增：blur/四角 clamp/scope-change），回归套件绿色。双轴审查通过（0 HARD 违规，非阻断气味已记录）。P0 热修完成，但切片整体**未被 accepted**——macOS Computer Use 人工视觉 QA 与 Windows 平台验证未执行；P1 完整切片（框选/组合键/移除批量条/视觉打磨）仍待实施。
