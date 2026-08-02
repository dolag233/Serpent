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
