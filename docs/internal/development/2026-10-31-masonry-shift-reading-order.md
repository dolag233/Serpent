# 瀑布流 Shift 上沿阅读顺序开发记录

日期：2026-10-31。基线 `c4e3227d`，工单 `Serpent-9d3244`。状态：实现与直接相关 Renderer 自动化完成；实现者自审及主 agent 独立复核完成；用户于 2026-10-31 确认功能验收通过。真实 Computer Use 与 Windows、macOS、packaged 平台证据未执行。

## 行为

瀑布流 Shift 点击现在按卡片真实上沿从上到下、同高时按左沿从左到右解析连续范围。每次点击都读取画布当前发布的普通矩形或稀疏 layout index，因此已知但未挂载的卡片参与排序；稀疏索引只收集当前资产列表中身份已知的项，`__geometry__:` 占位不会进入选择。未发布布局时才读取 DOM；DOM 未覆盖全部已知资产、端点/其他项缺失几何或几何重复时，使用去重后的稳定浏览顺序，保留可识别端点。

瀑布流和其他浏览视图共用 `resolveShiftBrowseRange`。文件夹排在资产前，普通 Shift 替换区间并清除区间外文件夹，Ctrl/⌘+Shift 合并当前选择，重复 Shift 保留原始 anchor。`setAssetSelectionAnchor` 会同步统一浏览 anchor，使导入揭示、会话恢复、全选/反选等程序写入能够覆盖先前鼠标 anchor。空白处框选仍使用矩形命中；瀑布流 Tab/Shift+Tab 继续用原有稳定资产顺序。

移除旧中心点矩形 resolver、发布几何中心收集和相应旧契约测试；`computeMasonrySelectionAssetIds` 仍只服务既有键盘焦点顺序，未改 Tab 语义。新排序与几何读取放在独立 `masonry-shift-selection.ts`，没有向 `App.tsx` 内联选择逻辑。

## 验证

按最小测试原则只运行直接相关 Renderer 单测：

```text
node node_modules/vitest/vitest.mjs run --config vitest.config.ts tests/unit/masonry-shift-selection.test.ts tests/unit/use-asset-selection-masonry.test.tsx tests/unit/selection-anchor.test.ts tests/unit/browse-selection-order.test.ts tests/unit/asset-grid-layout.test.ts tests/unit/canvas-asset-layout.test.ts --reporter=dot
```

最终结果：6 个测试文件通过，45 个测试通过，进程退出码 0。首次运行时测试夹具用错误的 CSS 选择器定位文件夹，6 个文件中 5 个通过、43 个测试中 42 个通过；修正选择器并用 `act` 包装卸载后，完整定向集合通过。首次输出的 act 警告来自测试卸载未包装；修正后的最终运行无警告。该失败是测试夹具问题，不是重跑掩盖产品时序问题。

覆盖包括不齐整高度与最短列/轮转位置反例、上沿/左沿顺序、反向与端点缺几何、重复身份/同点几何、完整稀疏索引中的屏幕外卡片、placeholder 过滤、实时新发布几何、未发布 DOM 全集与部分 DOM 回退，以及真实 hook 点击中的重复 Shift、程序更新 anchor、跨文件夹/资产边界、Ctrl+Shift 保留集合和平铺模式原有顺序。

未运行 Worker、资源库可用性、性能、全量单测、Electron E2E、typecheck、全量 lint、packaged 或发布门禁。用户于 2026-10-31 确认功能验收通过，SELECT-MASONRY-RANGE-001 已更新为「人类验收通过」。真实 Computer Use、Windows、macOS 与 packaged 平台证据未执行；旧 SELECT-014 的 2026-08-01 通过记录保留为历史事实，但其几何范围规则已撤回并由新条目替代。

本次 Vitest 未在仓库生成临时产物；未触碰既有 `.beads/issues.jsonl`、输入法文件或 `tmp/` 内容，工单仍由主 agent 单独维护。本记录只报告实现者自审，不签署独立 `accepted`。

相关记录：[实施规格](../implementation/2026-10-31-masonry-shift-reading-order.md)、[实现者自审](../reviews/2026-10-31-masonry-shift-reading-order-review.md)、[QA 记录](../qa/2026-10-31-masonry-shift-reading-order-qa.md)。


## 主 agent 最终复核

已独立检查真实几何顺序、稀疏占位过滤、统一范围状态和 setter 覆盖旧 anchor 的接线，核对新增 hook 交互与降级/重排回归；无代码阻断。复核发现 SELECT-016 已被历史框选 UI 条目占用，现改用独立 ID `SELECT-MASONRY-RANGE-001` 并同步引用；旧需求池与布局注释也已同步为新规则。此次收尾仅修改文档和代码注释，不重复运行已通过的测试。
