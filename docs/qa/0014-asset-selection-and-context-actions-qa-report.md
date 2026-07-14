# 切片 0014 QA 报告：资产选择与上下文操作（P0 右键菜单热修 + P1 选择模型）

> 状态：自动化全绿 + 规格覆盖完成 + 审查修复验证通过；人工平台 QA 待执行
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

## P1 选择模型验证（2026-07-14）

### 自动化结果

| 门禁 | 结果 |
| --- | --- |
| Typecheck | 通过 |
| Lint | 通过 |
| Unit + Worker 测试 | 320 passed（回归） |
| Electron E2E `selection-marquee` | 10/10 通过（5 原有 + 5 新增） |
| Electron E2E 回归 `context-menu` | 7/7 通过 |
| Electron E2E 回归 `organization-search-trash` | 3/3 通过 |
| Electron E2E 回归 `media-preview` | 2/2 通过 |
| Electron E2E 回归 `browsing-preferences` | 2/2 通过 |

### 选择模型 E2E 测试明细（新增 5 项）

| # | 测试名称 | 覆盖 |
| --- | --- | --- |
| 6 | 框选后 Shift+click 扩展正确 | 验证 stale-anchor 修复：框选 3 张卡片后用 Shift+click 从框选锚点范围扩展到卡片 5，共选 4 张 |
| 7 | 选择生存视图切换/缩放 | grid↔masonry 切换后选择不丢失；Ctrl+wheel 缩放后选择不丢失 |
| 8 | Ctrl/Cmd 增减往返 | Ctrl+click 加入→Ctrl+click 同卡移除→移除至空→普通点击新选 |
| 9 | 瀑布流框选自动滚动 | 指针置底边 40px auto-scroll zone 内时 scrollTop 增大 |
| 10 | 上下文菜单 Escape 序贯 | 右击打开菜单→Escape 关闭菜单（选择保留）→第二 Escape 清选 |

### 审查修复验证

| 修复项 | 验证 |
| --- | --- |
| stale-anchor（FIXED） | 测试 6 通过：框选后 Shift+click 从框选锚点正确扩展 |
| dead code autoScrollRaf（FIXED） | Lint 通过，代码审查确认已移除 |
| intersection dedup（FIXED） | `marqueeHitIdsRef` 在 mousemove 中写入，mouseup 中复用以判空 |
| Escape/context-menu 交互（FIXED） | 测试 10 通过：第一 Escape 关闭菜单保留选择，第二 Escape 清选；Test 4（Esc clears selection）回归通过 |

### 规格覆盖确认（P1）

- **验收条件 #1（框选+自动滚动）**：测试 1/2/9 覆盖 grid/masonry 框选 + 自动滚动。
- **验收条件 #2（点击/Shift/Ctrl/Cmd/取消/Esc 模型）**：测试 3–5/7/8/10 全覆盖。
- **验收条件 #6（E2E 覆盖两种视图+框选+组合键+菜单关闭）**：10 项 selection-marquee + 7 项 context-menu 全部通过。
- **验收条件 #6（Windows Ctrl）**：已确认为明确缺口，需真实 Windows QA。

### 双轴审查结论（P1）

- **Standards**：0 HARD 违规。medium 项全部修复。non-blocking：Primitive Obsession、Long Method、Windows Ctrl。
- **Spec**：选择模型完成。测试缺口 line 21/16/20 已关闭。Windows Ctrl 已确认缺口。
- **状态**：conditional — non-blocking 项已记录为 follow-up。

## 结论

自动化门禁全绿：typecheck/lint/unit 320 passed、E2E 24/24（selection-marquee 10/10 + context-menu 7/7 + organization-search-trash 3/3 + media-preview 2/2 + browsing-preferences 2/2）。双轴审查通过（0 HARD 违规，medium 项全部修复，non-blocking follow-up 已记录）。P0 热修 + P1 选择模型完成，但切片整体**未被 accepted**——剩余 P1 移除顶部批量条 / 批量右键菜单连线 / 视觉打磨待实施；macOS Computer Use 人工视觉 QA 与 Windows 平台验证未执行。
