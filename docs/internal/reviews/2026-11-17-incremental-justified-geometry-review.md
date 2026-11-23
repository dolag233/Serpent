# 增量 justified 几何与纯叶渲染独立审查

审查范围仅包括：`justified-row-geometry.ts`、`use-justified-geometry-snapshot.ts`、`virtual-browse-canvas.tsx` 中本轮几何提取与 dense snapshot 接线，`AppearanceGlyph.tsx` 保留的默认 `React.memo`，以及对应单测。`Icons.tsx` 最终恢复到本轮开始内容、没有产品 diff；`icon.test.tsx` 仅保留 SVG 路径/尺寸/颜色的既有语义回归。依据为 [`2026-11-17-incremental-justified-geometry.md`](../development/2026-11-17-incremental-justified-geometry.md)。未改产品/测试；未运行测试、构建或应用。测试与真实旅程结果均来自主 agent 的记录，不是审查者独立复测。工作树里的 viewport 既有增量不在本次审查范围。

## 结论

**未发现确定的正确性阻断。** 新快照只重算含变更 entry 的行，仍逐行重算 offsets；React 自己持有候选状态，丢弃渲染不推进共享缓存。`AppearanceGlyph` 默认浅比较在稳定 props 时跳过子树，props 改变时仍更新。

## Standards

- [`justified-row-geometry.ts`](../../../src/renderer/browse/justified-row-geometry.ts:22) 将配置归一化与旧算法一致，比较 total、itemsPerRow、取整后的可用宽度/目标高度及 caption resolver 身份；同配置和同 Map 返回原 snapshot。输入 Map 不同则按行比较各 index 的 value 引用，重算变化行，复用未变行的宽度数组/高度/caption，再创建新的 offset wrapper。旧 offset 不被修改，旧入口 `virtual-browse-canvas.tsx` 仍 re-export `buildJustifiedGeometry`。
- 当前 [`mergeLayoutEntries`](../../../src/renderer/browse/virtual-browse-layout.ts:151) 对 geometry Map 做 copy-on-write，并仅替换发生变化的 slot value；未变化 value 保持引用。因此 identity 比较在现有生产路径上成立。输入 map 与 value 必须遵循此不可变约定；`ReadonlyMap` 本身不防持有可变 alias 的调用者原地修改。当前内部变更路径均以新 Map 承载更新或删除，没有此类 mutation。
- [`use-justified-geometry-snapshot.ts`](../../../src/renderer/browse/use-justified-geometry-snapshot.ts:10) 用当前组件的条件 render-phase state 更新派生 snapshot；不会读写共享 ref，也不在布局 effect 中推进缓存。相同 input 返回旧 snapshot，避免重复 state 更新。暂停/丢弃的候选不会修改已提交对象。
- snapshot、行字段和宽度数组均为只读类型，满足跨 snapshot 共享未变行的前提。调用者读取几何并通过 `geometryRevision` 通知锚点恢复；本增量没有改 asset index、selection 或虚拟滚动恢复协议。
- [`AppearanceGlyph`](../../../src/renderer/AppearanceGlyph.tsx:16) 仅增加默认 `memo`，没有自定义比较器或样式/文案变化。`Icon` 最终未增加 memo。Glyph 测试检查相同 props 的父组件重渲染不会再次执行 Icon 子项，并验证 appearance、fallback、color、size、emoji、linked badge 改变时输出同步更新；`icon.test.tsx` 保留为普通 `Icon` 的 SVG path/name/尺寸/颜色语义回归，不作为 memo 证据。
- 单测使用 happy-dom root，并在 `afterEach` unmount 和移除 host；没有真实路径、资源库名或源媒体输入。

## Spec 与回归

- 纯几何测试与原全量构造器逐字段比较，覆盖初始/尾部 partial row、尺寸变化、同一行多项变化、mediaType/caption 变化、配置变更、删除后 placeholder 和旧 snapshot 保持。React hook 测试覆盖 Suspense 中断候选后从最后提交 snapshot 继续，以及切离 dense 后重建。
- 主 agent 报告几何和 hook 直接测试在 7 个相关文件中 52 项通过；Glyph 与 Icon SVG 语义测试另 3 项通过。memo-all 阶段的四文件 lint 通过，但该阶段的 `Icons.tsx` 产品改动已撤回；最终 glyph-only 文件状态未由本审查者运行检查。全仓 TypeScript 仍有其他 CLIP 开发轨道的四项既有错误。以上结果均非审查者独立运行。
- 主 agent 报告变更前 B 精确调用诊断 `buildJustifiedRowGeometry` 为 80,418 次，缓存构建为 24 次；旧全表 `buildJustifiedGeometry` 的基线是 26 次，缓存构建后该函数被 tree-shake，未匹配不计为零。诊断只能证明行构造调用数量变化，不能代替 CPU 归因。
- 曾将 `Icon` 和 `AppearanceGlyph` 一并 memo 的试验版 B p95 为 34.4/34.1ms，相比 cache-only 两轮 31.9/33.1ms，没有显示额外帧收益，因此最终撤回 `Icon` memo。当前 glyph-only 构建中，主 agent 报告 Renderer hash `f8803433c348fc394506b7ba0f1377ce0b217cb522849ae7c4c353c829448aa3`；B 原生滚动 p95/max 为 31.3/39.2 与 32.5/38.9ms，末页 25/25 解码，远跳九成时刻为 957/635/639/901 与 933/632/632/915ms。A 单轮 p95/max 为 23.5/55.7ms，出现一个 55ms long task，末页为 23/25（92%）。样本有限且 A 有慢帧，不能声称 memo 带来额外或稳定全局提升；Icon 实验指标只作撤回依据，不是最终范围数据。上述全部为主 agent 报告，本审查者未独立复测。
- 主 agent 仍在校准 Precise 调用诊断，并准备两模式返回/缩放真实旅程；未完成项不写成已验证。前台 Computer Use、packaged/macOS、长期滚动及大于 20,000 项走 chunked 几何路径仍未由本增量验证。Chunked 分支没有使用本次 dense 行缓存，不代表所有规模的布局已增量化。

## 剩余限制

- Cache 的增量性依赖 `ReadonlyMap` 与 value 的 copy-on-write；未来若 producer 原地改 map/value，same-map fast path 会返回旧结果。当前内部几何 Map 更新路径遵循该约定，开发记录也已明示。
- React tests 证明 Suspense 中断不污染后续几何以及 dense 状态切换，不是堆快照或真实浏览器滚动锚点的测量。几何变更时 selection 和返回位置的行为由既有 index/`geometryRevision`/anchor 路径保持，最终当前构建返回/缩放旅程仍待主 agent 记录。
- Glyph 单测证明跳过和输出更新，不证明真实长滚动里的总体收益。纯叶 memo-all 没有显示额外帧收益，所以最终只保留 Glyph 的局部 memo；Sidebar 与 NavRow 仍可有独立重复工作，本轮没有把它们计入已解决范围。
