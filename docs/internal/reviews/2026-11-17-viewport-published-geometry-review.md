# Viewport published geometry review

关联增量：`Serpent-f4622e`。审查范围仅包括 published geometry 快速检测、虚拟画布索引导出、平铺外槽高度、相关 Renderer 单测与几何 parity 探针。

## 审查状态

**独立代码审查完成；本轮没有未解决的代码阻断。** 首次 parity 失败的虚拟窗口通知缺口已由有界 post-commit signal 修复；owner guard、直接测试和最终候选两源 parity 已复核/由主 agent 报告通过。P1 已解除。人工视觉验收未执行，本报告不代表用户 `accepted`。

## 证据来源

- 本审查者静态阅读本增量的 implementation、development 文档及指定源码和测试；按主 agent 要求没有运行单测、lint、typecheck、构建或 Electron。
- 主 agent 的 development 文档记录：直接 Renderer 单测 `3 files / 23 passed`、探针单测 `2 passed`、两文件 scoped lint 通过。以上是实施者记录，不是本审查者独立执行。
- 通知补丁后的实施者消息记录：使用相同 layout index 缓存 ID 的变窗单测在禁用两处通知时确定 RED，恢复通知后相关 3 文件 `24 passed`。主 agent 已将命令和 RED/GREEN 结果归档 development 文档；本审查者没有独立执行。
- 后续 owner guard 的实施者消息记录：临时移除 guard 时 switch、reopen、A→B→A 三例均 RED（出现 stale publish），恢复 guard 后相关 5 文件 `34 passed`。该运行不是本审查者独立执行。
- 主 agent 另报告通知修复与 owner guard 后相关 5 文件 `34 passed`、scoped lint 0 errors/1 既有 AI dependency warning；typecheck 仍有 4 个既有 CLIP 错误。所有这些结果均非本审查者执行，且 typecheck 不能写成全绿。
- 主 agent 报告上一版 renderer hash 前缀 `1336…` 的 parity 两素材源同步 comparison 和 6 个 checkpoint 均为零 mismatch；但解码 coverage 首轮 poll 可能读到旧挂载窗口。随后测试在稳定等待后再次轮询并断言当前窗口 coverage ≥90%，所以旧版数据已被最终候选的新结果取代，不作为最终验收。
- 主 agent 最终报告 renderer 候选 hash `8871687329288078e2bf698733704ffb14aa324dc8e262bc8804c4c9204839f6` 的 A/B 强化 parity 通过；均无 `DIAGNOSE_REPORT_REARM`、无人工合成 scroll，cleanup confirmed。A：29.6s，48 events/1,180 compared IDs，六处当前窗口 decoded/total 为 23/24、30/30、30/30、22/23、25/25、9/9，6 checkpoint 全零 mismatch；B：23.3s，43 events/953 compared IDs，六处为 25/25、20/20、20/20、21/21、21/21、20/20，6 checkpoint 全零。两个源各点当前窗口解码均 ≥90%。两次为 GPU enabled、window hidden、offscreen=false；capture 分别 15/11 frames、ack 0 并显式停止。结果来自主 agent，不是本审查者独立运行。
- 最终 plain 对照由主 agent 报告（控制 hash `16f8db…`，候选同最终 `887168…`）：无计数、GPU enabled、窗口 hidden、non-offscreen；A P95/max 为 10.9/33→10.5/25.9ms，B 为 21.3/34.5→21.9/35.7ms，均 0 long tasks，末页解码分别 25/25、30/30。校准 P95 从 6ms 到 7.1ms。读数混合，不能声称稳定 FPS 收益。
- 主 agent 报告真实 parity 首次在平铺视图返回顶部时失败。后续因果诊断为：`scrollTop` 前后均为 0；仅派发 scroll 通知后，report event 从 33 增至 34，checkpoint 的 missing 与 extra 均从 25 归零；同步 event comparison 始终为 0 mismatch。该运行结果来自主 agent，本审查者未独立运行。
- development 文档中的较早 DOMRect 计数与四次远跳数据属于首版候选（hash `98c458…`），不外推到最终修正候选 hash `887168…`。以下 plain 对照单独记录最终 hash；所有主 agent 观测均非本审查者实测，也不证明稳定 FPS 改善。

## Standards

`CanvasAssetLayoutIndex.assetRectAtIndex` 是可选字段，旧实现继续可用；发布仍由已有 WeakMap 持有，虚拟画布把已有 `rectAt` 闭包暴露出来，不物化整库矩形数组，也不保存跨调用的 DOM 节点缓存（`src/renderer/canvas-asset-layout.ts:73-115`、`src/renderer/browse/virtual-browse-canvas.tsx:450-471,676-698`）。collector 对每次调用只缓存每个 grid 的 top 原点。

快速路径要求 DOM 的 layout ID、layout index 和已发布矩形 ID 一致；缺字段、旧发布、索引越界、身份不符或无效几何会回退 DOM。贴近视口边缘及跨边缘的候选也回退 DOM，避免浮点/舍入改变严格的上下边界语义。候选仍按 DOM 遇见顺序处理，先去重并排除占位（`src/renderer/viewport-priority-report.ts:24-117`）。

平铺 row 与 outer slot 使用同一取整后的 body height；内部 card、preview、caption、间距和 overflow 规则没有随本次样式改动一同扩大（`src/renderer/browse/virtual-browse-canvas.tsx:69-125,1090-1112`；`src/renderer/styles.css:11605-11645`）。这会让空的真资产槽和卡片未填满的透明尾段拥有实际布局命中高度，是已在实施规格中说明的行为变化，不应描述成原有零高槽命中范围保持不变。

探针只返回矩形读取和比较计数；最多在 renderer 内存中暂存 300 个可见 ID，销毁时移除事件监听并还原 `Element.prototype.getBoundingClientRect`。相关单测也核对了脱敏输出、原 descriptor 恢复与 pageerror（`tests/e2e/viewport-report-geometry-probe.ts:45-163,184-318`；`tests/unit/viewport-report-geometry-probe.test.ts:38-170`）。隐私与资源释放实现符合本次范围。

通知补丁复审：`canvas-layout-commit-signal.ts` 只发一个向上冒泡的同文档事件，不携带 ID、路径或用户数据（`src/renderer/canvas-layout-commit-signal.ts:1-5`）。App 在当前 canvas 注册/移除该 listener；scroll 与 commit signal 共享同一 `createCoalescedFrame` 和 80ms cadence，cleanup 同时移除 listener 并取消 pending frame（`src/renderer/App.tsx:3296-3313`）。Masonry 与 justified 两个虚拟组件均先发布 layout index，再于 `useLayoutEffect` 通知；依赖项涵盖 `layoutIndex` 及 viewport 的 `start/end/visibleStart/visibleEnd`（`src/renderer/browse/virtual-browse-canvas.tsx:876-889,1040-1053`）。

单测用相同 layout index 缓存 ID，滚动后确认 mounted slot ID 已变、事件观察到的是提交后的新 ID，且 layout index 引用保持相同（`tests/unit/virtual-browse-canvas-dom.test.tsx:129-163`）。源代码没有从该事件回写 React state；`viewport-window.ts:46-136` 在范围未变时也复用旧 state，因此静态上未见通知→render 循环。index 变化或四边范围变化各触发一次 commit effect，突发通知由 App 的 pending RAF 和 cadence 合并。当前 DOM 单测直接覆盖 justified；masonry effect 结构相同，但仍由真实双布局 parity 补足。

## Spec 与阻断

### 已解除 P1 — 虚拟窗口成员提交后缺少可见窗口 report

首次失败时，App report effect 仅因 canvas `scroll` 或父布局依赖调度，并经共享 80ms coalescer 合并；report 只在生成新 key 时派发可见窗口事件。`useCanvasLocalViewport` 在 observer/scroll 更新后执行 `setViewport`，可在 scrollTop 不变时更换 mounted row/slot。原虚拟组件提交后没有通知 App 重算（`src/renderer/App.tsx:3231-3304`；`src/renderer/coalesced-frame.ts:1-27`；`src/renderer/viewport-window.ts:46-136`）。

这是可见窗口数据的新鲜度缺口，不是 rect 公式本身。主 agent 的因果复现显示，顶部位置没有变化时单独重发 scroll 通知即可产生新 report，并清掉 checkpoint 的 missing/extra；同步 event 级 DOM 对照没有几何 mismatch。当前源码在布局索引发布后、mounted range/layoutIndex commit 时冒泡通知 App；通知与 scroll 共享 coalescer。实施者用同一 layoutIndex 改变 mounted IDs 的组件用例做 RED/GREEN；主 agent 最终候选 A/B parity 的同步 event comparisons 和 6 个 checkpoint 全为零 mismatch，且每个位置在第二次 poll 后均达到至少 90% 当前窗口真实解码。因此解除 P1。

探针的同步 `serpent:e2e-visible-window` listener 将该次 report 的 IDs 与同一事件栈内原生 DOMRect 参考比较；checkpoint 则将最近上报与当前 DOM 对照（`tests/e2e/viewport-report-geometry-probe.ts:113-143,204-253`；`tests/e2e/real-linked-navigation-perf.test.ts:547-604`）。旧 hash 的 parity 记录不再用于最终验收，因为解码 poll 可能读到旧挂载窗口；最终 hash 的测试在 160ms 稳定等待后重新轮询，并对六处都断言当前窗口 coverage ≥90%。主 agent 报告最终两个素材源通过，无诊断重发，故原失败已由最终证据闭环。

初审发现子组件在 `useLayoutEffect` dispatch 与 App passive listener cleanup 之间可能出现旧 owner 排队窗口。当前代码通过 `reportOwner` 固定捕获 `libraryId + libraryViewSession generation`，并将 owner predicate 传给 coalescer；`request()` 和每次 `tick()` 均先核验，过期 callback 会在消费 cadence 或调用 report 前丢弃（`src/renderer/coalesced-frame.ts:8-39`；`src/renderer/App.tsx:3303-3307`）。这在静态上关闭了跨库、重开及 A→B→A 的旧 library session 风险；相关 stale owner 用例见 `tests/unit/coalesced-frame.test.ts:20-40`。主 agent 报告该 guard 的定向 RED/GREEN 证据如上；本审查者未执行。

### 覆盖限制

- `tests/unit/virtual-browse-canvas-dom.test.tsx:94-125` 验证 slot 样式高度、空槽到真实 ID 的身份和 React 节点原位替换；happy-dom 不提供真实浏览器布局，不能证明 card 与 outer slot 的实际 DOMRect 关系。
- 本次平铺 outer slot 的透明尾段是可见优先级语义变化。caption 开关、不同卡片尺寸、viewport 边缘及 preview 返回后的实际布局仍应由直接 parity/真实 UI 证据覆盖，不能由 style 单测代替。
- parity 探针每次最多比较 300 个 ID；与 report 同步的 DOM reference 是相同 renderer 中的局部对照，不覆盖 Worker 接收与 thumbnail 队列最终响应。
- 首版 hash `98c458…` 的 A/B native 计数和跳转观测仅作历史记录，不可覆盖到最终候选。最终 hash 的 plain 对照见上方：A 的 P95 改善、B 的 P95/max 反向，校准 P95 上升；当前结果不支持“所有指标改善”或“稳定 FPS 提升”的结论。
- 本审查者没有执行真实桌面操作；人类视觉验收未完成。自动 parity 通过后仍不能替代用户验收。

## 剩余限制

- 人工 Computer Use/视觉验收未执行；自动 parity 与截图证据不能代替用户验收。
- 本轮没有运行切库并发/真实 lifecycle E2E。旧 library session 的 request/tick 防护由实现源码与主 agent 报告的 `switch/reopen/A→B→A` 定向 RED/GREEN 单测覆盖。
- 本审查者没有独立运行任何单测、lint、typecheck、构建或 Electron。主 agent 报告 scoped lint 0 errors、1 个既有 AI dependency warning；typecheck 仍有 4 个既有 CLIP 错误，不能写成全绿。
- 最终 plain FPS 对照有 A 小幅改善、B 反向，校准 P95 上升；当前证据不支持稳定 FPS 收益或所有指标改善。最终 parity 通过仅说明此次几何与窗口 freshness 对照在测试范围内一致。
- parity reference 上限为 300 IDs，且只比较 renderer 上报与同进程 DOM；不等于 Worker/缩略图队列端到端验收。
- 平铺 outer slot 透明尾段仍属于已声明的行为变化；人工检查 caption 开关、卡片尺寸、预览返回等视觉体验仍待完成。
