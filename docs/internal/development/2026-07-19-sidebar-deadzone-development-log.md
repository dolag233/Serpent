# 2026-07-19 侧栏拖拽自动隐藏段落感死区（Serpent-bhv，REQ-SHELL-011 复验）

## 背景

`Serpent-4gk`（2026-07-18）已实现侧栏拖小自动隐藏 + 边缘拖出恢复，并在
`panel-auto-hide.ts` 里加了一个隐藏死区（`NAV/INSPECTOR_PANEL_AUTO_HIDE_THRESHOLD
= MIN - 40`）。但用户 2026-07-18 验收 `SHELL-018` 仍判定不通过：

> 侧栏隐藏缺段落感；对照现实现：拖小过程中即时隐藏/无死区，不符合。

`Serpent-bhv` 是该反馈的复验工单，`Serpent-4gk` 保持已关闭状态。

## 根因

读 `use-panel-resize.ts` 的 `beginResize` 发现：死区阈值判定只写在
`pointerup` 的回调里，`pointermove` 期间只是把宽度 clamp 到最小宽度（视觉上
冻结），**不做任何隐藏判定**。也就是说，用户在死区区间内持续拖拽时界面完全
没有变化，直到松开鼠标那一刻才突然判定并隐藏——从用户视角看，"松手才隐藏"
和"没有死区、立即隐藏"是同一种体验：都是一个没有过程反馈的**二值跳变**，
没有"拖到一段就能看到已经隐藏"的段落感。

另外，隐藏死区（40px）和边缘拖出死区（`PANEL_EDGE_RESTORE_PX = 48`）是两个
互不关联的独立魔数，双向死区幅度不对称，也与"双向都要有段落感"的要求不符。

## 修复

1. `panel-auto-hide.ts`：新增唯一的死区幅度常量
   `PANEL_AUTO_HIDE_DEAD_ZONE_PX = 40`，隐藏阈值（`NAV/INSPECTOR_PANEL_AUTO_HIDE_THRESHOLD`）
   与边缘拖出阈值（`PANEL_EDGE_RESTORE_PX`）都从它派生，保证两个方向的死区
   幅度始终一致。
2. `use-panel-resize.ts` 的 `beginResize`：把隐藏判定从 `onUp`（松手才执行）
   前移到 `onMove`（拖拽进行中实时执行）——一旦意图宽度跌破死区阈值，立刻在
   当前这次 `pointermove` 里完成收尾（移除监听、复位状态、回退到拖拽前宽度、
   触发 `onAutoHide`），不等松手。`onUp` 里保留同一判定作为兜底（覆盖测试环
   境用合成事件直接触发 `pointerup`、中间没有 `pointermove` 的边界情况），
   避免和 `onMove` 的收尾逻辑重复触发（`onMove` 一旦收尾会移除
   `pointerup` 监听，后续不会再进 `onUp`）。
3. 边缘拖出方向（`beginEdgeRestore`）已经是在 `pointermove` 中实时判定，
   本次未改变行为，只是复用了统一后的死区常量。

三方向体感总结：
- 拖小：越过最小宽度后先冻结（不再变窄）；再拖约 40px 死区，**拖拽进行中**
  即可看到该栏隐藏，无需松手。
- 拖出：隐藏态下先有约 40px 死区不显示；越过死区后立刻显现，宽度从最小宽度
  开始，随后正常跟手调宽。
- 两个方向共用同一个死区常量，手感对称。

## 文件

- `src/renderer/panel-auto-hide.ts`：统一死区常量，阈值从常量派生。
- `src/renderer/use-panel-resize.ts`：隐藏判定前移到 `pointermove` 实时执行；
  边缘拖出注释补充说明死区来源。
- `tests/unit/panel-auto-hide.test.ts`：扩展纯函数单测，覆盖阈值上/内/外边界、
  边缘拖出边界、双向死区幅度相等的断言。

## 测试证据

```
$ npx vitest run tests/unit/panel-auto-hide.test.ts tests/unit/shell-preferences.test.ts
 Test Files  2 passed (2)
      Tests  17 passed (17)

$ npm run test:unit
 Test Files  90 passed (90)
      Tests  860 passed (860)

$ npm run typecheck
（无输出，退出码 0）

$ npm run lint
✖ 17 problems (0 errors, 17 warnings)
（17 条均为改动前已存在的 react-hooks/exhaustive-deps 警告，与本次改动无关）
```

## 未覆盖 / 后续

- 本次改动只覆盖纯函数（阈值/死区判定）与拖拽 hook 内联逻辑的单测；未新增
  真实 Electron 拖拽 E2E（`use-panel-resize.ts` 依赖 `PointerEvent`/DOM，仓库
  当前没有 React hook 渲染测试基础设施）。真实拖拽手感仍需人工在应用内操作
  验证，见 `docs/internal/qa/human-acceptance-checklist.md` 的 `SHELL-018` 行。
- Windows 未验证（无 runner），行为与 macOS 一致性未知。

## 验收

`SHELL-018`（复验 `Serpent-bhv`，对应 `REQ-SHELL-011`）：已重新进入
`docs/internal/qa/human-acceptance-checklist.md` 的“待人类验收”状态，等待用户本人
按新增操作步骤实际拖拽确认。
