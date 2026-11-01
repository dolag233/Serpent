# 瀑布流 Shift 上沿阅读顺序实现者自审

日期：2026-10-31。工单 `Serpent-9d3244`，基线 `c4e3227d`。

状态：实现者（luna）完成 Standards 与 Spec 自审；主 agent 独立复核待完成。本记录不是独立审查结论，也不签署 `accepted`。

## Standards

- 复用了 `canvas-asset-layout` 已有的发布矩形/稀疏 index 和 `resolveShiftBrowseRange` 统一选择流程；没有新增布局算法或第二套选择状态。
- 几何读取与顺序解析位于独立 `masonry-shift-selection.ts`，没有把交互实现继续塞进 `App.tsx`。`App.tsx` 中现有 `computeMasonrySelectionAssetIds` 仍维持键盘焦点路径，本次没有改变 Tab/Shift+Tab。
- 本次不修改 UI 样式或文案。fixture 使用合成 ID 和内存几何，不含本机路径、真实媒体名或用户数据。没有触碰既有工单、输入法偏好文件或工作区临时目录。
- 已删除没有其他消费者的中心点范围 API、中心点收集函数和只验证旧矩形规则的测试；保留并更新了仍供键盘顺序使用的稳定数组顺序契约。

## Spec 追溯

| 需求 | 实现 | 自动化证据 | 人工/平台证据 |
| --- | --- | --- | --- |
| 按真实卡片上沿 y 排序，同高按 x；两端包含，反向保持同一集合 | `src/renderer/masonry-shift-selection.ts:18`、`src/renderer/useAssetSelection.ts:229` | `tests/unit/masonry-shift-selection.test.ts:40`；`tests/unit/use-asset-selection-masonry.test.tsx:191`；`tests/unit/browse-selection-order.test.ts:63` | 用户于 2026-10-31 确认功能验收通过；Computer Use 未执行 |
| 使用完整已发布几何覆盖屏幕外已知项；虚拟几何占位不进入资产选择 | `src/renderer/canvas-asset-layout.ts:339`、`src/renderer/masonry-shift-selection.ts:61` | `tests/unit/masonry-shift-selection.test.ts:125`；过滤断言位于同文件 `:138` | 用户于 2026-10-31 确认功能验收通过；未做真实虚拟大库操作 |
| 文件夹先于资产；范围 anchor 保持原位；普通 Shift 替换，Ctrl/⌘+Shift 合并 | `src/renderer/useAssetSelection.ts:140`、`:229`；`src/renderer/browse-selection-order.ts:17` | `tests/unit/use-asset-selection-masonry.test.tsx:206`、`:221`；`tests/unit/browse-selection-order.test.ts:21` | 用户于 2026-10-31 确认功能验收通过；真实桌面未执行 |
| 程序导入/恢复 anchor 覆盖之前的点击 anchor；缺几何、重复 ID、同点有稳定降级 | `src/renderer/useAssetSelection.ts:140`；`src/renderer/masonry-shift-selection.ts:18` | `tests/unit/use-asset-selection-masonry.test.tsx:219`；`tests/unit/masonry-shift-selection.test.ts:91`、`:117` | 用户于 2026-10-31 确认功能验收通过；Windows 与 packaged 未验证 |
| 布局更新时使用最新几何；非瀑布流顺序与空白框选保持原路径 | `src/renderer/masonry-shift-selection.ts:61`；框选逻辑仍在 `src/renderer/useAssetSelection.ts:370` 之后的原代码路径 | 实时重新发布断言：`tests/unit/masonry-shift-selection.test.ts:125`；平铺交互：`tests/unit/use-asset-selection-masonry.test.tsx:231`；Tab 顺序：`tests/unit/asset-grid-layout.test.ts:110` | 平铺/框选视觉仍待 SELECT-MASONRY-RANGE-001 用户验收；Computer Use 未执行 |

自动化结果为本次直接相关 Renderer 单测 6 files / 45 passed。该证据不代替真实界面和平台验收。

## 自审发现与修正

统一 Shift 路径接入时检查到了 anchor 优先级问题：如果先有鼠标 anchor A，之后会话恢复/导入揭示用 `setAssetSelectionAnchor(B)` 更新资产 anchor，旧 browse anchor A 仍会被优先采用。修复后 setter 同步统一 browse anchor，并清理旧 folder anchor；传入 `null` 只清除资产 browse anchor，保留有效的 folder browse anchor。hook 交互测试先单击 A、程序设置 B、再 Shift 到 G，确认结果从 B 开始。

第一次测试运行中，文件夹夹具选择器未匹配（其后还有测试按钮），并且卸载未由 `act` 包装；这导致 1 条 fixture 错误和 act 警告。修正后同一直接测试集合通过，无 act 警告。没有发现或隐藏产品时序失败。

## 未验证与交接

- 用户于 2026-10-31 确认功能验收通过；本环境没有可操作的原生 Computer Use 桌面能力，真实桌面、Windows、macOS 与 packaged 验证仍未执行。SELECT-014 的旧几何规则已撤回但保留 2026-08-01 历史事实。
- Windows、packaged、实际虚拟大库视觉行为未验证。
- 按本次最小测试范围未运行 Worker、E2E、typecheck、lint、全量测试或发布门禁。
- 等待主 agent 依据最终代码与证据进行独立复核；在其完成前不得将需求标记为 `accepted`。


## 主 agent 独立最终复核

主 agent 独立检查最终代码、调用点与新增测试证据，Standards 与 Spec 均无代码阻断。复核特别核对了普通/虚拟布局的共同发布入口、上沿而非中心排序、重复 Shift 的原 anchor、程序更新覆盖旧 anchor、已知未挂载项与占位过滤、平铺与 Tab 路径。缺失几何时退回完整稳定已知顺序的边界已在规格和测试中明确。复核修正了与既有 SELECT-016 冲突的验收 ID，统一为 `SELECT-MASONRY-RANGE-001`，同步旧需求池和遗留布局注释。主 agent 未重复执行已通过的定向单测；真实原生界面操作仍未执行，本结论不是 accepted。
