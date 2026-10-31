# 瀑布流 Shift 上沿阅读顺序 QA

日期：2026-10-31。工单 `Serpent-9d3244`。状态：Renderer 自动化通过；用户于 2026-10-31 确认验收通过；主 agent 独立代码/证据复核完成，无代码阻断。Windows 与 packaged 未验证。

## 本次执行

只运行了直接相关 Renderer 单测，未启动 Worker 或 Electron：

```text
node node_modules/vitest/vitest.mjs run --config vitest.config.ts tests/unit/masonry-shift-selection.test.ts tests/unit/use-asset-selection-masonry.test.tsx tests/unit/selection-anchor.test.ts tests/unit/browse-selection-order.test.ts tests/unit/asset-grid-layout.test.ts tests/unit/canvas-asset-layout.test.ts --reporter=dot
```

最终结果：6 个测试文件通过，45 个测试通过，退出码 0；耗时约 1.34 秒。第一次执行有 1 个测试夹具定位错误和卸载 act 警告，修正后同一测试集合通过且无警告；详情见[开发记录](../development/2026-10-31-masonry-shift-reading-order.md)。

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 上沿 y 从上到下、同高 x 从左到右；不齐整列中读取真正连续区间 | `src/renderer/masonry-shift-selection.ts:18`；`src/renderer/useAssetSelection.ts:229` | `tests/unit/masonry-shift-selection.test.ts:40`；`tests/unit/use-asset-selection-masonry.test.tsx:191` | 用户于 2026-10-31 确认验收通过 |
| 起止包含、反向一致、anchor 不因重复 Shift 移动 | `src/renderer/useAssetSelection.ts:229` | `tests/unit/browse-selection-order.test.ts:63`；`tests/unit/use-asset-selection-masonry.test.tsx:191` | 用户于 2026-10-31 确认验收通过 |
| 复用已发布完整矩形/稀疏 index；纳入未挂载的已知项；过滤虚拟占位 | `src/renderer/canvas-asset-layout.ts:339`；`src/renderer/masonry-shift-selection.ts:61` | `tests/unit/masonry-shift-selection.test.ts:125`、`:138` | 虚拟真实大库与屏幕外卡片视觉操作未执行 |
| folder→asset 单一范围；普通 Shift 清理范围外 folder；Ctrl/⌘+Shift 合并 | `src/renderer/browse-selection-order.ts:17`；`src/renderer/useAssetSelection.ts:229` | `tests/unit/use-asset-selection-masonry.test.tsx:206`；`tests/unit/browse-selection-order.test.ts:21` | 用户于 2026-10-31 确认验收通过 |
| 导入/恢复等程序 anchor 可覆盖旧点击 anchor；缺几何/重复身份有稳定回退 | `src/renderer/useAssetSelection.ts:140`；`src/renderer/masonry-shift-selection.ts:18` | `tests/unit/use-asset-selection-masonry.test.tsx:219`；`tests/unit/masonry-shift-selection.test.ts:91`、`:117` | 用户于 2026-10-31 确认功能验收通过；Windows 与 packaged 未验证 |
| 重发布布局使用最新位置；非瀑布流、Tab 和空白框选保持既有路径 | `src/renderer/masonry-shift-selection.ts:61`；`src/renderer/useAssetSelection.ts` 中未改动的框选路径 | `tests/unit/masonry-shift-selection.test.ts:125`；平铺 `tests/unit/use-asset-selection-masonry.test.tsx:231`；Tab `tests/unit/asset-grid-layout.test.ts:110` | 自动化未覆盖真实框选视觉；Computer Use 未执行 |

新交互已由用户确认功能验收通过。真实 Computer Use 与 Windows、macOS、packaged 平台证据未执行，因此这些平台验证仍未完成。旧 SELECT-014 的几何规则状态为「已撤回」，其 2026-08-01 用户通过记录保留；新 SELECT-MASONRY-RANGE-001 已验收通过。

未运行 typecheck、lint、Worker、资源库可用性、性能基线、全量测试、E2E、packaged 或发布门禁。测试未在工作区留下临时产物。Windows 及当前构建的原生界面表现未验证。
