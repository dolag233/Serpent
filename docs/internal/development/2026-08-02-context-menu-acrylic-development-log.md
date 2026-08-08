# 2026-08-02 右键菜单亚克力强度开发记录

## 范围

为所有右键菜单提供统一的亚克力质感，并在「设置 → 外观」提供无、低、中、高四档强度选择。默认低档，保持此前查看器菜单的视觉强度。

## 实施

- `menu-acrylic-preferences.ts` 负责四档偏好读取、保存、校验和迁移安全回退。
- `MenuAcrylicProvider` 在首帧前和设置变更后写入 `data-menu-acrylic`，资产、文件夹、合集、标签、文本编辑和查看器菜单统一复用 `.context-menu` surface。
- 设置页复用「层级投影」的刻度条结构和样式，四个刻度显示无/低/中/高，并即时持久化。
- CSS 统一控制透明度、背景模糊和饱和度；无档关闭 `backdrop-filter`，低档对应当前强度。

## 验证

- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npx vitest run --config vitest.config.ts tests/unit/menu-acrylic-preferences.test.ts`：1 个文件、3 个测试通过，覆盖默认低档、四档持久化、边界值和损坏配置回退。

## 人工验收

待产品负责人在亮色/暗色主题分别打开资产、文件夹、合集和查看器右键菜单，切换四档并确认透明度、模糊和文字可读性。

Windows 开发态 Computer Use 快速检查：设置 → 外观可见「右键菜单亚克力」四档刻度，默认停在低档；资产卡片右键菜单已呈现轻度透明与背景模糊。该检查不替代产品负责人的跨主题人工验收。

## 二级菜单跨层 hover 修复

浮动二级菜单与一级触发项之间原本保留 4px 间隙；右键菜单外层为穿透指针事件的透明层，鼠标跨越该间隙时会落到后方可拖拽资产卡片，显示抓取光标并触发一级菜单离开逻辑，导致二级菜单在点击前消失。

- 二级菜单改为与触发项水平方向无缝贴合，仍保留窗口边缘的 4px 安全边距。
- 跨层 `mouseleave` 将触发项和浮动面板视为同一 hover 区域，避免关闭定时器误关菜单。
- 回归用例覆盖：长列表不产生顶部空白、鼠标移入浮动面板后菜单保持可见、标签选项可点击。

验证：`npm run typecheck`、`npm run lint`、`npx playwright test tests/e2e/context-menu.test.ts --reporter=line`（10 tests passed）。

## Shell 菜单亚克力扩展

资源库切换菜单、Windows 主菜单及工作区“更多”菜单也接入同一 `data-menu-acrylic` 强度档位，保持菜单间的透明度、背景模糊和饱和度一致；设置面板和普通卡片不受影响。

验证：`npx playwright test tests/e2e/shell-navigation.test.ts --reporter=line`（1 test passed，覆盖资源库菜单和主菜单默认低档的模糊效果）。

## 主菜单二级浮层合成修复

主菜单二级项原先嵌套在一级亚克力面板内，子面板的 `backdrop-filter` 只能采样已经合成过的一级面板，因此视觉上像不透明平块。现将二级浮层调整为主菜单根节点下的同级元素，保留原有位置和键盘导航；它可以直接采样后方资源界面，真正产生模糊效果。

验证：`npm run typecheck`、`npm run lint`、`npx playwright test tests/e2e/shell-navigation.test.ts --reporter=line`（1 test passed，覆盖主菜单一级面板和二级面板的 blur 样式及原有定位）。

## 2026-08-06 键盘导航与二级菜单 hover 焦点

上下文菜单的二级菜单触发项在鼠标重新进入时只打开子菜单，没有同步获得焦点；当键盘导航与 pointer hover 连续切换时，焦点标记和悬停样式可能错位。现在触发项在 pointer enter 时先聚焦，再打开子菜单；只有显式点击触发项时才把焦点转移到子菜单搜索框，键盘导航与普通 hover 保持触发项焦点。

同时，E2E 在读取键盘焦点阴影前等待样式计算完成，避免把 React 状态提交与浏览器伪类样式重算之间的瞬时窗口误判为失败。

验证：`node scripts/run-e2e.mjs tests/e2e/context-menu.test.ts` → `10 passed (17.3s)`；为避免连续 Electron 测试间鼠标坐标未变化导致 hover 事件不触发，回归用例在两次 hover 前先将鼠标移出菜单。`npm run typecheck && npm run lint` 通过。该验证为 macOS 开发态，packaged 与 Windows 未执行。

## 2026-08-06 pointer hover 焦点竞态回归

主线 `npm run verify:mainline` 在上下文菜单第 20 项复现了 pointer hover 后
`document.activeElement` 未落到目标菜单项的失败。单独运行通常通过，说明仅增加测试等待不能消除时序耦合。

根因是焦点同步只依赖 `mouseenter`。当 Playwright/触控板路径在菜单项内部移动、但不重新触发目标节点的
`mouseenter` 时，菜单已经产生悬停视觉反馈，按钮却可能仍未成为 active element。现在保留 `mouseenter`
的即时焦点，并增加 pointer-move 兜底：仅当目标尚未获得焦点时聚焦，不改变键盘导航状态，也不重复触发焦点提交。
一级菜单项和二级菜单触发项均覆盖该路径。

验证：

- 修复前：当前主线 75 项 E2E 中 `71 passed / 1 failed / 3 skipped`，失败定位到
  `tests/e2e/context-menu.test.ts:512`。
- 修复后：`node scripts/run-e2e.mjs tests/e2e/context-menu.test.ts -g "pointer hover stays subtle"` →
  `1 passed`。
- 修复后稳定性：同一命令 `--repeat-each=3` → `3 passed (7.2s)`。

同一轮主线复核还暴露了标签选择器的关联回归：浮动子菜单已打开时，触发项的
`onFocus`/`onMouseEnter` 会再次执行打开逻辑，把 `positioned` 重置为 `false`；
固定定位的 portal 于是短暂隐藏，Playwright 将点击/hover 坐标落到资产网格。
现在仅在子菜单尚未打开时执行 hover/focus 打开逻辑，避免重复测量和隐藏已打开的面板。
标签选择器测试同时显式将长列表选项滚入自身滚动容器，再用页面鼠标移动进入，覆盖真实 pointer
事件而不依赖 Playwright 对 fixed portal 的自动滚动。

验证：

- 修复后：`node scripts/run-e2e.mjs tests/e2e/context-menu.test.ts` → `10 passed`。
- 关联流程隔离复测：`browsing-preferences`、`organization-metadata-persistence`、
  `organization-search-trash` 定向用例均通过。
- 当前 HEAD：`npm run verify:mainline` → lint、typecheck、extension verify 通过；
  单元/Worker `352 files passed / 3076 tests passed`，搜索性能 `5 passed`，
  Electron E2E `72 passed / 3 skipped`。
- 本次仍为 macOS 开发态验证；packaged 与 Windows 未执行。

## 2026-08-06 菜单首帧定位与幂等打开竞态

后续复跑发现两处尚未被前一轮修复覆盖的时序问题：

1. 一级菜单的布局 effect 通过下一帧才提交可见位置。快速右键后，菜单短暂保持
   `left/top=-9999px`，随后续 pointer 操作可能找不到菜单项或命中下方画布。
2. 二级菜单的 focus/click/hover 事件可能在同一 React 提交前重复调用打开逻辑。
   依赖 render 时的 `open` 闭包无法识别这类同步重复调用，导致 `positioned` 再次变为
   `false`，标签选择器 portal 被短暂隐藏。

修复方式：

- `ContextMenu` 在 `useLayoutEffect` 中同步提交测量后的位置，避免首帧隐藏窗口；
- 使用同步 `openRef` 使 `ContextMenuSubmenu` 的打开逻辑幂等；关闭定时器同时清除该
  状态，确保后续 hover 可以重新打开；
- 使用 `initialFocusPendingRef` 让 pointer/keyboard 交互取消尚未执行的初始焦点回填，
  避免初始 RAF 在用户操作之后覆盖目标焦点。

验证：

- `node scripts/run-e2e.mjs tests/e2e/context-menu.test.ts` → `10 passed`；
- `node scripts/run-e2e.mjs tests/e2e/organization-search-trash.test.ts` → `4 passed`；
- `browsing-preferences` 标签路径、`organization-metadata-persistence` 持久化路径均
  定向通过；
- `npm run verify:mainline` → `352 files passed / 3076 tests passed`，搜索性能
  `5 passed`，Electron E2E `72 passed / 3 skipped`；
- `npm run typecheck` 与单文件 ESLint 通过；当前验证为 macOS 开发态，packaged 与
  Windows 未执行。
