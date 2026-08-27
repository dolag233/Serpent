# 2026-08-26 大型资源库性能架构阶段 C.2 开发日志：稀疏几何与逻辑锚点

关联架构：[`0032-library-performance-architecture.md`](../implementation/0032-library-performance-architecture.md)  关联工单：`Serpent-3kfe`、`Serpent-sa65`

## 目标

大型 BrowseSession 不能把 20k/100k 条完整布局或摘要传给 Renderer，也不能用固定
占位高度让随机 scrollbar 跳转后阅读位置越来越偏。本阶段实现有界几何窗口：摘要页
和几何块按 viewport/overscan 请求，Renderer 只保留少量 LRU 块；已到达的真实尺寸会
修正 masonry/justified 的高度和 spacer，并围绕当前逻辑卡片补偿滚动锚点。

## 实现与四列追溯

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 几何请求按 128 项块并带一块 overscan | `src/renderer/browse/use-virtual-browse-session.ts`；`src/renderer/browse/virtual-browse-layout.ts` | `tests/unit/virtual-browse-session.test.ts`；`tests/worker/browse-session.test.ts` | macOS Worker/Renderer 定向通过；真实 20k/100k 未验证 |
| 摘要页和几何块有界 LRU，淘汰摘要不丢已有几何 | `use-virtual-browse-session.ts`；`virtual-browse-layout.ts` | `tests/unit/virtual-browse-session.test.ts` | 单测通过；内存峰值尚未在 20k/100k Electron 取证 |
| 真实尺寸修正 masonry/justified 的可变高度、宽度和 spacer | `src/renderer/browse/virtual-browse-canvas.tsx` 的 `buildMasonryGeometry` / `buildChunkedMasonryGeometry` / `buildJustifiedGeometry` / `buildChunkedJustifiedGeometry` / `variableWindow` | `tests/unit/virtual-browse-canvas.test.ts`：包含 100k 位置的稀疏几何断言；与稀疏 session 定向测试共 10 项 | 当前 macOS Electron 编译并执行真实滚动；视觉锚点、Windows DPI、packaged 未验证 |
| 几何迟到时保持当前逻辑卡片的屏幕位置 | `virtual-browse-canvas.tsx` 的 `useVirtualScrollAnchor` | 几何纯函数有覆盖；真实 scrollTop 锚点暂无独立 Playwright 断言 | 当前大库 E2E 记录可见布局顺序和无长任务；人工拖动/反向滚动未执行 |

## 设计细节

- 未加载位置仍是整数 index 的 transient placeholder；不会为 100k 位置创建完整
  `AssetSummary` 或完整布局对象。
- 小列表继续使用 dense arrays；超过 20,000 个槽位时，masonry 只保存已知槽位覆盖和
  每 128 行的 block offset，justified 只保存已知行覆盖、每 128 行的 block offset
  与有界的行几何缓存。未到达几何使用稳定估算，几何块返回后只改变相关 scalar
  geometry；不会为 100k 位置分配两套完整高度/offset 数组。
- `VirtualBrowseLayout` 额外保留稳定的 `assetIdsByIndex` 与 `geometryEntries` 身份映射。
  摘要 patch 不再因为 entries/reverse-index 的新对象引用触发虚拟布局索引重建；几何
  patch 仍会显式提升 geometry revision。
- `useVirtualScrollAnchor` 记录 viewport 顶部第一个逻辑 slot，几何更新后只把该
  slot 的 top delta 加回 canvas scrollTop；不会用“恢复旧 scrollTop”掩盖真实布局变化。
- 这是布局正确性与可测量性的增量，不等于缩略图解码性能已达门禁。冷 fixture 没有
  ready artifact 时，geometry 准确也不能替代媒体生成/解码尾延迟优化。

## 当前真实基准

命令（当次工作树、真实 Electron、2100 图像 fixture；fixture 只用于本次测试）:

```bash
SERPENT_LARGE_LIBRARY_E2E_PATH=<isolated-temp>/library \
SERPENT_LARGE_LIBRARY_E2E_MIN_ASSETS=2100 \
SERPENT_LARGE_LIBRARY_E2E_MIN_SCROLL_HEIGHT=1000 \
SERPENT_LARGE_LIBRARY_E2E_JUMPS=0.11,0.83,0.37,0.69 \
SERPENT_LARGE_LIBRARY_E2E_OBSERVATION_MS=5000 \
SERPENT_LARGE_LIBRARY_E2E_RESULT_PATH=<isolated-temp>/result-geometry.json \
node scripts/run-e2e.mjs tests/e2e/large-library-scroll-benchmark.test.ts
```

| 运行 | 结果 | 4 个随机跳转目标 |
| --- | --- | --- |
| geometry run | 1/4；P50 623.8ms；P95/Max 636.4ms；samples 378.7/623.8/636.4/521.0ms | 未通过 |
| geometry repeat | 0/4；P50 660.3ms；P95/Max 666.6ms；samples 636.5/660.3/666.6/537.2ms | 未通过 |
| current HEAD after D.3/sequence frame source routing | 3/4；P50 462.3ms；P95/Max 672.2ms；samples 422.2/462.3/672.2/372.0ms；long task max 108ms | 未通过；当前结果改善但仍有超 500ms 尾延迟 |

两次运行都没有 long task，分页请求 issue→resolve 约 13–121ms；红灯集中在可见
thumbnail 尾部（仍有默认文件图标），所以不能宣称 `Serpent-sa65` 完成。此前同一
fixture 的 eager-only 运行也只有 2/4、P50 523.6ms/P95 576.4ms，不能用它证明
当前几何版本通过，也不能把本次红灯归因成单一布局函数，仍需在 ready/warm artifact
和 20k 混合夹具上分离媒体生成与布局成本。

最新当次工作树运行的完整结果已写入隔离临时结果文件；其中四个跳转的
`defaultIcons` 为 7/7/11/8（夹具含非图像资产，按 benchmark 的 image-card 规则不作为
完成条件），但第 3 个跳转达到 672.2ms 且记录 4 个长任务，最长 108ms。因此这次改善
不能写成稳定达标，也不能只看 P50。

纯函数与对象身份证据：

```text
npx vitest run --config vitest.config.ts \
  tests/unit/virtual-browse-canvas.test.ts \
  tests/unit/virtual-browse-session.test.ts
2 files / 10 tests passed
```

该定向集合包含 100k 槽位的 masonry/justified 稀疏几何，以及摘要 patch 复用稳定
`geometryEntries`/`assetIdsByIndex` 的断言；它证明了有界数据结构和失效边界，不代表
真实 20k/100k Electron 首屏或缩略图解码已经达标。

### 与 C.3/D.3 联调后的 20k 证据

当前 HEAD 在真实 macOS Electron、本地 APFS 20,000 资产夹具、第四档卡片和 10 个随机跳转
下，使用可视区媒体 admission、稀疏几何和导航摘要延后策略完成两次独立冷运行：

| 运行 | 结果 | P50 | P95/Max | 长任务 |
| --- | --- | ---: | ---: | ---: |
| `idle-pixel-full` | 10/10 | 162.3 ms | 315.9 ms | 0 |
| `idle-pixel-repeat` | 10/10 | 156.6 ms | 308.4 ms | 0 |

命令使用 `npm run test:e2e:large-library-benchmark -- <20k-fixture>`，并通过
`SERPENT_LARGE_LIBRARY_E2E_REUSE_LIBRARY=<20k-local-library>` 复用同一 20k 库、通过独立
`SERPENT_LARGE_LIBRARY_E2E_USER_DATA_PATH` 隔离两次应用配置。两次都证明了
当前本地组合路径达到 500 ms 门槛，但没有证明 100k、Windows、NAS/SMB、packaged 或人工
滚动锚点验收；旧的 2100 图像红灯仍保留作为历史诊断证据，不用新结果覆盖其平台/夹具差异。

## 未完成

C.2 的稀疏几何、真实尺寸和锚点补偿已具备代码、纯函数证据和本地 20k 联调门禁证据；
完整验收仍缺 100k、本地真实用户库、SMB/NAS、Windows、packaged、真实人工拖动和独立
ready/warm artifact 分组。`Serpent-sa65` 保持 in_progress。

## 基准口径更正（2026-08-26）

上面的两次 10/10 记录使用了旧版 benchmark：分母只包含已经挂载 `<img>` 的卡片，遗漏了
`data-media-type="image"` 但尚未挂载图片元素的可见图片卡片。该证据撤回，不再证明“所有
可见图片 500ms 内解码”。修正后的 benchmark 明确区分两层指标：默认严格模式要求全部可见
图片真实解码；`SERPENT_LARGE_LIBRARY_E2E_GATE=first-wave` 只衡量布局稳定且至少首批真实
图片解码，并继续观察完整尾部。

同一 20k APFS 库的当前证据：默认严格模式一次跳转为 0/1，5000.9ms 观察结束时仍有 13
张图片未解码；first-wave 十次随机跳转为 9/10，P50 167.1ms、P95/Max 555.9ms，只有
4/10 在观察窗口内完成全部图片。首批一次 439.7ms 是单次结果，不构成稳定门禁通过。
`Serpent-sa65` 继续保持 `in_progress`。
