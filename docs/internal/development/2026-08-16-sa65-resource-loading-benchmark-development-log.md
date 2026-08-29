# 2026-08-16 Serpent-sa65 资源加载全面优化与 benchmark 开发日志

- 工单：`Serpent-sa65`
- 分支：`codex/serpent-sa65-benchmark`
- 基线：`78fa65724e97cd89e4d8b5fee1989bbc7907c074`
- 状态：implementing；自动化硬门槛已达到，待独立审查与人类验收

## 验收口径

真实 Electron 在 10,000+ 资产资源库中使用第四档卡片大小，把滚动条随机拖到未访问范围；从位置稳定起 500 ms 内，视口内所有资产缩略图均满足 `complete && naturalWidth > 0`。不得用 `__pending:` 或空卡撑 COUNT，也不得在普通滚动或重排时整页闪回占位。

## 反馈环

### 2026-08-17 基线与最小复现

先使用当前 worktree 的现有代码和本地 APFS v3 夹具测量，没有把混合媒体的默认文件图标误判成图片解码延迟：

- `npm run test:perf:large-library -- <mixed-v3>`：
  `assets=10000 startup=320.8ms folder=0.9ms search=9.2ms layout=32.6ms inspector=0.1ms`。
- `SERPENT_LARGE_LIBRARY_E2E_OBSERVATION_MS=10000 npm run test:e2e:large-library-benchmark -- <mixed-v3>`：
  `4/10`。失败样本的视口中出现视频/非图片资产，没有 `img.asset-thumbnail`；图片样本本身能在约 175ms 解码。该结果用于媒体组成诊断，不作为 `Serpent-sa65` 的图片硬门槛通过证据。
- 发现 `scripts/generate-large-library.mjs` 只识别 `--images-only`，而复现命令使用 `--asset-profile images-only`，导致所谓 image-only 库实际仍是混合库。脚本现已同时接受两种参数形式，并对真正的 image-only v3 库重新 `--reset` 生成。
- image-only 预热命令：
  `SERPENT_LARGE_LIBRARY_PREWARM_PATH=<local-apfs-path> node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/large-library-benchmark-prewarm.test.ts --disableConsoleIntercept`；
  结果 `sourceSignatures=45 generatedRepresentatives=45 clonedArtifacts=9900 readyThumbnailCount=10000`。

## 实现记录

### 2026-08-17 布局槽位提前进入可见缩略图队列

`App.tsx` 的 `reportVisibleWindow` 原先只扫描已挂载的 `.asset-card`。随机跳转到没有 ready 缩略图的范围时，布局几何已经存在，但布局槽没有真实卡片，队列要等分页响应和卡片挂载后才收到可见窗口。现在同时扫描 `[data-layout-asset-id]`，去重后报告当前视口及 runway 内的真实 asset id；没有创建 synthetic `AssetSummary`、`__pending:` 卡或空槽来伪造 COUNT。

benchmark harness 同时补了：

- `--asset-profile images-only` 生成参数；
- 可调观察窗口和单次跳转环境变量；
- `requestOffsets/requestWaveCount`；
- `PerformanceObserver` 长任务；
- 实际 `<img>` 的 `complete/naturalWidth/naturalHeight/src` 诊断。

### 2026-08-17 可见窗口去重与二级媒体隔离

继续对当前 worktree 做真实 Electron 基准后，发现 `reportVisibleWindow`
所在 effect 会因 `assets`/布局状态更新重新创建，导致同一组 asset id
重复发送；同时上下各一整屏 runway 会让一次跳转最多入队约三倍于视口
所需的缩略图。现在用跨 effect 的 key 去重，并将 runway 收窄为视口高度
的 25%。此外，`skipStaleRepair` 的轻量可见窗口入队在主预览 job 后立即
返回，metadata/palette/proxy/contact-sheet 留给 secondary idle lane，
避免滚动条交互同步执行无关 SQL 扫描和派生任务。

冷 Worker benchmark 首次重跑暴露了测试本身的基准污染：共享 APFS 夹具
已被预热，直接 enqueue 返回 `0`，不能证明生成吞吐。测试现在在隔离
APFS clone 中删除目标视口的 thumbnail artifact，并取消 openLibrary
自动放入的目标 job 后再入队，确保测量真实生成。

## 验证

资源库可用性门禁：`npm run test:library-availability`；9 个测试文件、
189 个测试全部通过（当次运行同时确认 better-sqlite3 Electron ABI 匹配）。

### Worker 基线

命令：`npm run test:perf:large-library -- <image-only-v3>`  
结果：`assets=10000 startup=300.2ms folder=1.1ms search=10.6ms layout=33.2ms inspector=0.2ms`。

当前 HEAD 在队列优化后的同一夹具重测：
`assets=10000 startup=296.9ms folder=0.9ms search=8.4ms
layout=28.7ms inspector=0.2ms`。

### 真实 Electron（当前实现，优化后）

命令：
`SERPENT_LARGE_LIBRARY_E2E_OBSERVATION_MS=5000 npm run test:e2e:large-library-benchmark -- <image-only-v3>`

结果：`10/10`；每次跳转耗时
`279.5, 275.0, 312.4, 237.7, 224.2, 275.2, 199.4, 250.4, 273.8, 191.1ms`；
`p50=273.8ms p95=312.4ms max=312.4ms`；每次可见卡片 `22–24` 张且实际解码数相等；占位符 `0`、默认图标 `0`；每个跳转请求波次 `0–2`；最大观测长任务 `80ms`。

改动前同一夹具同一跳转序列：`10/10`，`p50=257.0ms p95/max=305.9ms`。因此当前证据证明没有回归并满足 500ms，不把一次本地运行的约 6ms p95 差异宣称为优化收益。

同一实现未改代码再次运行：`10/10`，`p50=265.6ms p95/max=318.6ms`；
可见与实际解码数仍逐次相等，占位符/默认图标仍为 `0`。两次结果都低于
500ms，说明通过不是单次偶然值。

### 2026-08-17 当前 HEAD 回归与冷生成

命令：

```bash
SERPENT_LARGE_LIBRARY_E2E_OBSERVATION_MS=5000 \
  npm run test:e2e:large-library-benchmark -- /tmp/serpent-sa65-images-only-v3
```

当前 HEAD 重新构建后真实 Electron 结果为 `10/10`：
`156.8, 158.1, 165.9, 166.5, 162.5, 212.9, 145.7, 186.6, 136.8,
178.7ms`；`p50=165.9ms p95=212.9ms max=212.9ms`。每次可见卡片
`22–24` 张，解码数逐次相等，占位符/默认图标均为 `0`，请求波次
`0–1`，长任务计数为 `0`。

冷生成命令：

```bash
SERPENT_LARGE_LIBRARY_PERF_PATH=/tmp/serpent-sa65-images-only-v3 \
  node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts \
  tests/worker/large-library-thumbnail-performance.test.ts \
  --disableConsoleIntercept
```

三次独立运行结果均为 `requested=30 processed=30 completed=30`：
`380.0ms / 368.7ms / 376.3ms`，吞吐
`78.9 / 81.4 / 79.7 thumbnails/s`；生成耗时 p50=`376.3ms`、
max=`380.0ms`。这证明 Worker 直接生成一屏缩略图的路径也有可重复
证据，但它不是“已有真实缩略图文件的 Electron 解码 500ms”门槛。

### 2026-08-17 独立审查后的队列收口与冷压测

审查指出：启动队列原本可能在第一次可见窗口报告前占用主缩略图
解码器；布局槽的 ready 事件也没有把新 artifact id 传给仍未挂载完整
摘要的槽位。对应修复为：

- 资源库打开后的 primary backfill 延迟 1 秒，并在可见窗口交互期间按
  1 秒 idle 窗口重新等待；
- light visible-window 波次一次 claim 整个报告窗口，实际 Sharp 并发仍
  由物理核上限控制，避免小波次之间的定时器/查询边界；
- `asset.thumbnail.ready` 同步更新 layout preview artifact map，摘要先
  到时也使用该真实 artifact；map 限制为最近 512 项，并在资产集合变化时
  清空，避免旧 revision 与无限增长；
- `layoutOnly` 的空响应在已知非空资源库中不再擦除现有几何。

验证命令：

```bash
SERPENT_LARGE_LIBRARY_E2E_OBSERVATION_MS=5000 \
  npm run test:e2e:large-library-benchmark -- /tmp/serpent-sa65-images-only-v3
```

当前 HEAD 真实 Electron warm run 为 `10/10`：
`159.8, 150.5, 151.1, 150.8, 161.0, 145.7, 160.6, 169.0, 132.6,
145.9ms`；`p50=151.1ms p95=169.0ms max=169.0ms`。可见/解码数逐次
`23/23, 23/23, 23/23, 22/22, 22/22, 24/24, 23/23, 23/23, 22/22,
23/23`，占位符和默认图标全部为 `0`，请求波次 `0–1`，长任务计数
全部为 `0`。

为区分 warm 解码门槛与首次生成成本，又从 APFS clone 删除了固定跳转
目的页的 1,000 个真实 thumbnail artifact，保留 source 文件进行压力测量。
最终冷库固定十跳为 `7/10`，逐次
`194.1, 623.7, 443.4, 786.7, 464.3, 566.6, 447.6, 417.0, 287.5,
452.2ms`；`p50=452.2ms p95/max=786.7ms`。单跳 `0.83` 在延迟启动
backfill 前为 `833.4ms`，修复后先降至 `651.4ms`，再经整窗 claim 为
`640.2ms`。所有完成样本仍为真实解码且无占位/默认图标；这部分剩余
成本是 source thumbnail 生成与页渲染，不改变本工单使用真实缩略图文件
的 warm gate。Worker 对相同 offset `8200` 的直接冷生成：
`30/30, 369.8ms, 81.1 thumbnails/s`。

## 风险与未验证

- 以上硬门槛使用真实 Electron + APFS 克隆库 + 已存在真实缩略图文件；未验证“首次生成 8K 缩略图本身也必须在 500ms 内”，该要求不属于本工单的 warm-thumbnail 解码口径。
- 混合 v3 库包含视频、模型、文本、音频和不支持格式；这些资源不都具有图片缩略图。混合库的默认图标计数必须按媒体类型解释，不能替代 image-only 硬门槛。
- Windows、packaged app、用户 Computer Use 视觉验收尚未执行。
- 其他 worktree 未发现 `benchmark.md`，无可读取的本地竞品数值。
