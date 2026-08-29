# 混合内容测试库缩略图与 PDF 查看延迟分析（2026-08-24）

> 状态：分析完成；核心低风险修复已落地，真实 NAS/Windows 人工计时仍待验收。
>
> 分析基线：`dev` 分支 `4def123`（已包含异步开库对账、资源路径缓存、可见窗口调度和图片查看渐进加载优化）。
>
> 证据：最新真实会话日志 `serpent-20260824T094134.log`、当前源码和仓库内安装的 `pdfjs-dist 6.2.108`。

本文是 [`2026-08-24-viewer-thumbnail-worker-starvation.md`](./2026-08-24-viewer-thumbnail-worker-starvation.md) 的后续分析。上一轮修改后，“图像测试库”的网格与查看器已经明显变快；最新日志仍能稳定区分出“混合内容测试库”的缩略图迟到和 PDF 首屏迟到。本文只描述剩余问题，不再建议重新实现已经落地的旧方案。

## 结论摘要

当前剩余问题不是一个单独的“PDF 慢”或“缩略图慢”，而是两层问题叠加：

1. **混合内容测试库仍存在 Library Worker 消息回调长时间得不到调度的现象。** 已生成缩略图的路径查询最多排队 `7.751 s`，实际执行最多只有 `36.70 ms`。这是缩略图迟到的直接证据。
2. **混合内容测试库会触发图像测试库没有的请求放大。** 本次会话出现 504 次逐卡片文本摘要读取，以及 57 次原生拖拽信息预热；后者累计占用 Worker 服务时间约 `7.0 s`，而 Main 在每个资产列表响应返回前最多同步预热 500 个资产。
3. **上一轮已经把开库对账改成异步、可取消、分批让出事件循环。** 因此不能继续把最新的 7–8 秒黑洞直接归因于旧版同步全盘扫描。最新日志没有开启阶段打点，尚不能确认究竟是异步对账中的某一段、媒体后台任务、文件监听刷新，还是其他后台链路占住了 Worker。
4. **PDF 首屏慢包含独立于 Worker 排队的第二层问题。** 两个实际 PDF 在拿到 source URL 前已经分别等待约 `1.4–2.9 s` 和 `3.5–5.0 s`；拿到 URL 后，pdf.js 对 `serpent://` 不启用 HTTP Range，日志也确实显示 HTTP 200 而不是 206。当前 PDF 查看器还会先为所有页面创建占位节点，再启动首页渲染。
5. **同一个 PDF 在一次打开过程中出现两份 preview 请求和两份 source 请求。** 开发态启用了 React StrictMode，这种时序与 effect 重挂载相符，但仅凭日志不能断言 StrictMode 是唯一来源。实现者应先给“查看会话”增加关联 ID，再消除重复请求。

因此建议不要再优化元数据 SQL，也不要只给 PDF 加加载动画。正确顺序是：先给后台任务补齐“谁占住 Worker”的 owner span，再削减文本卡片和拖拽预热的请求放大，同时单独重构 PDF 的数据读取与首屏渲染路径。

## 本轮已落地的修复

实现按上述顺序先处理不会改变资源库数据模型的路径：

- `src/main/index.ts` 将原生拖拽同步预热从 500 条收敛到 64 条，并把剩余资产合并成每批 500 条、串行且带调度间隔的后台预热，避免多个列表响应各自启动一条拖拽缓存洪峰，或让 `asset.list`/`asset.search` 等首屏响应被拖拽缓存工作阻塞。
- `src/renderer/TextAssetPreviewTile.tsx` 对文本卡片增加视口懒加载、同一资产的请求合并和 revision 失效保护；`src/worker/library-service.ts` 增加有界的 revision+字节上限缓存，保存文本或关闭资源库时失效。文本卡片不再在一次列表挂载时把所有文本资产同时送进 Worker 队列。
- `src/renderer/AssetPreviewModal.tsx` 防止同一查看会话的 StrictMode 初始 effect 重复发起首个 preview 请求；PDF 在 source URL 返回前直接显示已经就绪的 PDF 缩略图。
- `src/renderer/PdfViewerSurface.tsx` 对支持 Range 的 `serpent://source` 先探测 `bytes=0-0`，通过 `PDFDataRangeTransport` 按需读取区间，并在创建其余页占位节点的同时立即启动首页渲染；大页数文档按批让出渲染器事件循环。无 Range 能力时仍回退到原有完整流。
- `src/renderer/styles.css` 为 PDF 首屏缩略图提供不闪白的占位层，首个 canvas 绘制后自动移除。

这些改动没有把“Worker 连续 7–8 秒黑洞”的 owner 误判为数据库点查；开库对账、监听器和媒体队列仍需在真实 Windows/NAS 会话中用 `SERPENT_REFRESH_STAGE_LOG=1`、`SERPENT_WORKER_CMD_LOG=1` 复测，才能继续收敛剩余长尾。

### 本轮自动化证据

- `npm run typecheck`：通过。
- `npx vitest run --config vitest.config.ts tests/unit/viewer-mip-upgrade.test.ts tests/unit/pdf-viewer-layout.test.ts`：2 个文件、10 个测试通过。
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/trash-relink.test.ts`：84 个测试通过、2 个跳过；包含文本预览缓存 revision/保存失效回归。
- `npm run test:library-availability`：9 个文件、198 个测试通过、1 个跳过。
- `node scripts/run-e2e.mjs tests/e2e/document-preview.test.ts`：4 个 PDF/HTML 查看器 E2E 通过。

以上命令证明当前代码路径可运行，不等同于 Windows/NAS 人工性能验收；首次/二次打开耗时仍应以目标资源库和当前提交重新测量。

## 分析范围

### 资源库

- 混合内容测试库：`<library-id-mixed-content>`
- 图像测试库：`<library-id-image-content>`

混合内容测试库约有 8,863 条未删除资产记录，并包含链接文件夹。用户已经配置忽略规则，实际浏览范围约一千多个文件。当前异步枚举代码会调用 `isExplicitlyIgnored()` / `isDirectoryIgnored()` 剪枝，但最新日志没有记录遍历目录数、被剪枝目录数和 `lstat` 数量，因此暂时无法证明忽略规则在本次后台对账中是否按预期减少了磁盘访问。

### 日志字段

`worker.cmd` 的关键字段：

- `queueMs`：Main 发出命令后，到 Worker 的 `parentPort` 回调开始执行前的等待。
- `waitMs`：回调开始后，到服务逻辑开始前的解析和分派耗时。
- `runMs`：服务逻辑实际执行耗时。

日志里的 `worker.cmd` 通过 stderr 输出，所以记录等级显示为 `error`；这只是性能日志，不表示命令执行失败。

## 最新日志中的量化证据

下表统计本次会话中与问题最相关的命令。平均值和最大值均来自 `worker.cmd`：

| 命令 | 次数 | 平均 `queueMs` | 最大 `queueMs` | 最大 `runMs` | 累计 `runMs` |
| --- | ---: | ---: | ---: | ---: | ---: |
| `asset.text.read` | 504 | 4,319.09 ms | 7,772 ms | 52.58 ms | 1,511.70 ms |
| `media.get-artifact-paths` | 222 | 1,903.96 ms | 7,751 ms | 36.70 ms | 1,633.00 ms |
| `asset.search` | 74 | 545.86 ms | 7,708 ms | 872.95 ms | 6,182.85 ms |
| `asset.thumbnail.visible-window` | 66 | 2,186.50 ms | 7,677 ms | 22.28 ms | 649.57 ms |
| `media.get-asset-drag-infos` | 57 | 349.11 ms | 7,359 ms | 277.03 ms | 7,011.16 ms |
| `media.get-preview-artifact` | 15 | 1,657.93 ms | 7,099 ms | 159.74 ms | 518.18 ms |
| `asset.metadata.get` | 9 | 1,062.67 ms | 6,284 ms | 11.78 ms | — |
| `media.get-source-path` | 10 | 23.80 ms | 135 ms | 1.51 ms | — |

### 图像测试库已经恢复正常

图像测试库在 `01:45:34–01:45:48Z` 的多次查看样本中：

- `media.get-preview-artifact` 往返约 3–5 ms；
- `media.get-source-path` 往返约 2–9 ms；
- 图片 source Response 很快创建。

这与“预览提升巨大，查看也很快”的反馈一致，也证明当前问题不是一个作用于所有资源库的 Renderer 全局回归。混合内容测试库的内容类型、链接目录或后台工作负载是重要差异。

### 混合内容测试库仍有 7–8 秒的 Worker 回调黑洞

典型时间段：

- `01:43:59.557–01:44:07.029Z`：恢复后缩略图路径、可见窗口和搜索命令的 `queueMs` 达到约 6.5–7.75 秒。
- `01:46:36.408–01:46:44.285Z`：恢复后的路径查询排队约 7.1–7.3 秒。
- `01:46:45.401–01:46:52.322Z`：元数据、预览和 artifact 路径排队约 4.9–6.3 秒。
- `01:48:51.404–01:48:58.995Z`：周期性状态请求也排队约 5.6 秒。

这些间隔中没有普通 `worker.cmd` 开始执行；间隔结束后，大量早已发送的请求在很短时间内集中释放。这说明阻塞者不是某一条排队中的 SQLite 点查，而是一个没有被当前命令日志覆盖的后台执行片段。

## 混合内容测试库缩略图迟到

### 已证实：ready artifact 的查询本身不慢，慢在 Worker 回调之前

`media.get-artifact-paths` 为 `serpent://preview` 查询已经生成的缩略图路径：

- 最大 `queueMs=7,751`；
- 最大 `runMs=36.70`；
- 222 次累计服务时间约 `1.63 s`。

`asset.thumbnail.visible-window` 也呈现相同形态：最大排队 `7,677 ms`，最大执行 `22.28 ms`。因此本次现象不能归因于“缩略图正在生成”或“单张缩略图文件读取慢”。即使缩略图已经存在，Main 仍需要等 Worker 返回 artifact 路径；Worker 不响应时，卡片就只能保持占位状态。

### 已证实：文本预览卡片制造了 504 次逐资产同步文件读取

混合内容测试库包含大量 Markdown、代码和其他文本资产。`TextAssetPreviewTile` 对每个挂载的文本卡片分别调用：

```text
asset.text.read({ assetId, maxBytes: 2048 })
```

当前缓存只是 Renderer 进程内、按 revision 保存的 `Map`。冷启动、切库或大量新卡片挂载时，每张卡仍会产生一次 Worker 往返。

Worker 的 `LibraryService.readTextAsset()` 先做数据库点查，然后在 Worker 线程里使用 `openSync`、`fstatSync`、`readSync` 和 `closeSync` 读取链接源文件。单次通常只需数毫秒，但本次会话共有 504 次，累计服务时间约 `1.51 s`；更重要的是它们与搜索、缩略图路径、后台任务轮询共同排在同一个 Worker 消息队列里。

这不会单独解释一个连续 7 秒的黑洞，却能解释为什么混合内容测试库在 Worker 恢复后仍会出现请求洪峰，而以图片为主的图像测试库没有同样幅度的放大。

### 已证实：原生拖拽缓存预热阻塞资产列表返回，预热范围远大于真实首屏

Main 在收到每个包含资产卡片的 `asset.list` / `asset.search.result` 等响应后，会先执行 `primeNativeAssetDragCache()`，再把结果交给 Renderer。

当前常量 `NATIVE_DRAG_PRIME_VISIBLE_COUNT=500`。也就是说，代码注释虽然称其为“visible first screen”，实际上每次资产搜索/列表响应最多会同步预热 500 个资产；真正的首屏通常只有几十张卡片。

本次会话：

- `media.get-asset-drag-infos` 共 57 次；
- 单次最大执行约 277 ms；
- 累计 Worker 服务时间约 `7.01 s`。

这条路径既消耗 Worker，又把 `asset.search` 的结果返回与拖拽能力预热强耦合。日志中 `asset.search` 自身 74 次累计执行约 `6.18 s`；在混合内容测试库频繁分页、过滤或布局刷新时，两者会互相放大。

### 尚未确认：哪个后台 owner 制造了连续黑洞

当前 HEAD 已经具备：

- `runOpenBackgroundReconciliation()` 的 generation 与 `AbortController`；
- `enumerateSourcesAsync()` 的异步 `opendir` / `lstat`；
- 按时间片 `yieldReconciliation()`；
- `applyDiscoveredAssetsInBatches()` 的短事务批次；
- 资源库关闭/切换时的取消机制。

因此，旧文档中“同步递归扫描和长 SQLite transaction 必然饿死 Worker”的描述不能直接套到当前代码。

最新日志没有启用 `SERPENT_REFRESH_STAGE_LOG`，也没有统一的后台任务 owner span。剩余候选包括：

- 异步对账中仍存在超过时间预算的单个阶段或单个超大目录批次；
- 链接文件夹监听器触发的刷新；
- 媒体队列或插件媒体 provider 的后台处理；
- 未被 `worker.cmd` 包裹的文件系统或数据库批处理；
- 忽略路径没有在遍历前正确剪枝，导致链接目录仍被大量访问。

日志中 `ai.test-connection` 也有长耗时和高排队样本，但它包含网络等待，异步等待本身不应阻塞事件循环；在没有调用来源和 owner span 前，不能把它写成根因。

## PDF 查看慢

PDF 延迟必须拆成“拿到 source URL 之前”和“PDF.js 拿到 URL 之后”两段。

### 第一段：共享 Worker 排队已经造成数秒延迟

两个实际 PDF 样本：

- `sample-report-a.pdf`，约 6.99 MiB：同一资产出现两次 preview 请求，往返约 2,887 ms 和 1,416 ms。
- `sample-report-b.pdf`，约 13.81 MiB：同一资产出现两次 preview 请求，往返约 5,020 ms 和 3,537 ms。

第二个样本的 `media.get-preview-artifact` 分别为：

- `queueMs=4,936`、`runMs=82.57`；
- `queueMs=3,486`、`runMs=50.21`。

因此 PDF.js 尚未开始处理文件时，用户已经等待了数秒。该部分与缩略图迟到共享 Worker 饥饿根因。

### 第二段：pdf.js 对 `serpent://` 不使用 Range

Main 的 `createArtifactResponse()` 支持 `Range` 并可返回 206；图片或视频的日志中也能看到 206。但本次两个 PDF 的 source 请求均为：

- 状态 200；
- 没有 `Range` 字段；
- 同一资产各出现两次 source 请求。

仓库安装的 `pdfjs-dist/build/pdf.mjs` 给出了原因：

- `isValidFetchUrl()` 只接受 `http:` 和 `https:`；
- `serpent://source/...` 因此不会走 `PDFFetchStream`；
- 它回退到 `PDFNetworkStream`（XHR）；
- `validateRangeRequestCapabilities()` 在 `isHttp=false` 时直接禁用 Range。

所以，虽然 Serpent 自定义协议支持 Range，pdf.js 并不会为该 URL 发起随机分段请求。它只能沿完整文档传输路径读取；对于未线性化、页树复杂或尾部交叉引用较多的 PDF，首页解析可能需要等待更多字节。

日志里的 `viewer.source-timing.workerMs=59–72 ms` 只表示路径解析和 Response 创建完成，并不表示 7–14 MiB 的文件已经传输、pdf.js 已解析完成或首页 canvas 已绘制。旧结论把“Response 创建快”等同于“PDF source 不慢”是不完整的。

### 已证实：每个 PDF 在一次打开附近产生两份 preview 和两份 source 请求

两个 PDF 资产都出现成对的 `media.get-preview-artifact`，随后在同一毫秒出现两条 `serpent-protocol.source-request`。这会让自定义协议同时传输并解析同一 PDF 两次。

Renderer 根节点启用了 React `StrictMode`，`AssetPreviewModal` 又通过 effect 中的零延时 timer 调用 `resolvePreview()`；开发态 effect 重挂载与该现象相符。但查看器还存在缩略图事件刷新、轮询和父组件重挂载等触发源，当前日志没有 viewer session ID，不能只凭时间邻近认定唯一原因。

实现时应以“同一 viewer session 只允许一个有效 preview/source 加载任务”为不变量，而不是通过关闭 StrictMode 回避问题。

### 已证实：查看器在启动首页渲染前为所有页创建 DOM 占位

`PdfViewerSurface` 当前流程：

1. 动态加载 pdf.js；
2. `getDocument({ url: sourceUrl })`；
3. `getPage(1)` 获取首页尺寸；
4. 从 1 到 `numPages` 为全部页面创建 placeholder 并注册 `IntersectionObserver`；
5. 循环结束后才调用 `renderPage(priorityPage)` 和 `renderPage(1)`。

页数很多时，全量 DOM 创建会直接推迟首页 render 的启动。页面 canvas 使用 `contentWidth × devicePixelRatio`，在宽窗口和高 DPI 屏幕上还可能产生较大的首页画布。

当前没有 `pdf import`、`getDocument`、`getPage(1)`、placeholder 创建和首个 `RenderTask.promise` 的阶段计时，因此还不能量化这几段各占多少。

## 根因分级

### 已证实

- ready 缩略图迟到主要发生在 Worker callback 排队阶段，而不是 artifact 查询执行阶段。
- 混合内容测试库会产生大量逐卡片 `asset.text.read`。
- 资产列表返回前同步预热最多 500 个资产的原生拖拽信息，范围远大于真实首屏。
- PDF 在拿到 URL 前已经受共享 Worker 排队影响。
- pdf.js 对 `serpent://` 不启用 Range，本次 PDF 请求实际为 HTTP 200 语义的完整传输路径。
- 同一 PDF 出现重复 preview/source 请求。
- PDF 查看器在首页 render 前创建全部页面占位节点。

### 高概率但仍需打点确认

- 文本摘要、拖拽预热、artifact 路径查询与后台任务共同造成混合内容测试库的请求洪峰和长尾。
- PDF 自定义协议的无 Range 路径、重复传输和全页 placeholder 共同构成 Worker 恢复后的第二段延迟。
- 链接目录后台对账或监听刷新仍可能是连续 7–8 秒黑洞的 owner。

### 当前证据不支持

- “SQLite 在不到一万条资产时做单条查询需要几秒”。点查的 `runMs` 通常是毫秒级。
- “图片或 PDF 在等 Inspector 元数据”。元数据最大执行约 12 ms，只是被同一个 Worker 一起拖慢。
- “缩略图重新生成太慢”。本轮长延迟发生在 ready artifact 的路径查询进入 Worker之前。
- “上一轮异步对账完全无效”。图像测试库已经明显改善；剩余问题是内容/路径特定负载与仍未被标记的后台 owner。

## 建议的修复顺序

### 第一阶段：先让下一轮日志能指出真正的后台 owner

增加统一的 Worker 后台任务 span，不要只记录由 Main 发起的 `worker.cmd`：

- `backgroundTaskId`、`libraryId`、任务类型、generation/job ID；
- start/end、总耗时、最长连续占用、每次 yield 前处理数量；
- event-loop lag 采样；
- 对账计数：访问目录、读取文件、`lstat`、忽略目录剪枝、DB 写入行数；
- 媒体队列、链接 watcher 刷新、插件 provider、AI 队列分别拥有明确 owner 名称。

验收重点不是“后台任务总共跑多久”，而是任何单段都不应让交互命令的 `queueMs` 达到秒级。

### 第二阶段：削减混合内容测试库特有的请求放大

#### 文本卡片

- 增加按可见窗口批量读取的 `asset.text-snippets.get`，而不是每卡一个 IPC。
- 使用异步文件读取，并设置小并发上限；滚出视口后取消未开始的读取。
- 以 `(libraryId, assetId, revisionId)` 在 Worker 或 Main 做有界 LRU；若文本摘要是稳定产品能力，可在提取元数据时持久化摘要。
- 只为真正可见及小范围预取卡片读取摘要，不能因为搜索结果返回了一千项就读取一千份源文件。

#### 原生拖拽预热

- 不要在列表响应返回 Renderer 前同步预热 500 项。
- 首次绘制后只预热真实可见窗口，例如 32–64 项；视口变化时增量补齐。
- 对相同 asset ID 去重，并支持取消过期列表请求的后台预热。
- 可进一步在 pointerdown / selection 变化时惰性准备拖拽信息，但必须保留 Windows 原生 `dragstart` 的即时性。

#### artifact 路径

- 保留现有 Main LRU，不要重复实现另一套无失效规则的缓存。
- 补充 hit/miss、批次数、唯一 artifact 数量和 eviction 日志，解释本次为何仍有 222 次 Worker 查询。
- 同一渲染帧内合并重复请求；缩略图 ready/invalidate 和切库时严格失效。

### 第三阶段：单独优化 PDF 首屏

1. **给一次打开建立稳定的 viewer session。** 同一 session 对同一 asset/revision 只能存在一个有效 `requestPreview` 和一个 PDF loading task；effect 重挂载应复用或取消前一任务，不能重复传输。
2. **在 PDF.js 真页出现前立即展示已有 PDF 缩略图。** 这是改善感知首屏，不替代后续真实性能修复。
3. **为 pdf.js 提供真正的随机读取数据源。** 推荐由 Main/Worker 提供受校验的按 offset/length 读取 API，再在 Renderer 实现 `PDFDataRangeTransport`；不要把绝对路径暴露给 Renderer，也不要一次性把整个 PDF 放进 Renderer 内存。
4. **首页优先。** `getPage(1)` 后立即启动首页 render，再渐进创建临近页面节点；不要等全部 placeholder 创建完成。
5. **虚拟化长文档。** DOM 只保留当前页附近的占位和 canvas；用估计尺寸维护滚动范围，页尺寸可按需校正。
6. **限制首屏 canvas 预算。** 对 `devicePixelRatio` 或最大像素数设置上限，之后空闲时再升级清晰度。
7. **补齐阶段时序。** 至少记录 import pdf.js、`getDocument`、首字节/已传字节、`getPage(1)`、placeholder 数量与耗时、首个 render 完成和取消时间。

### 第四阶段：依据 owner span 再决定是否继续改对账

如果新日志证明异步对账仍是 owner，再针对实测最长阶段处理：

- 验证忽略目录在 `opendir` 前剪枝，路径大小写、分隔符和 Unicode 规范化一致；
- 降低单批目录项、DB batch 或时间预算；
- 在用户滚动、打开查看器等交互窗口内延长 reconciliation idle window；
- 对巨型单目录采用分页/分段处理，避免一次 `readdir` 返回过大数组；
- 切库时证明旧 generation 已取消且不会继续占用 Worker。

在 owner span 证明之前，不应再次大改当前异步对账实现。

## 实现入口索引

后续实现者可从以下位置开始，不需要重新做全仓搜索：

- 文本卡片逐项读取：`src/renderer/TextAssetPreviewTile.tsx` 的 `readTextAsset()` effect。
- 文本源文件同步读取：`src/worker/library-service.ts` 的 `LibraryService.readTextAsset()`。
- 原生拖拽预热数量与列表响应阻塞：`src/main/index.ts` 的 `NATIVE_DRAG_PRIME_VISIBLE_COUNT`、`primeNativeAssetDragCache()` 和 `handleLibraryRequest()` 资产结果分支。
- 缩略图 artifact 路径：`src/main/index.ts` 的 `resolveArtifactPathBatched()` 与 `serpent://preview` protocol handler。
- 当前异步开库对账：`src/worker/library-service.ts` 的 `runOpenBackgroundReconciliation()`、`collectManagedAssetDiscoveryAsync()`、`enumerateSourcesAsync()` 和 `applyDiscoveredAssetsInBatches()`。
- 查看器首次 preview：`src/renderer/AssetPreviewModal.tsx` 调用 `resolvePreview()` 的 effect。
- PDF 文档加载与全页 placeholder：`src/renderer/PdfViewerSurface.tsx` 的 `getDocument()` effect 和页面列 render effect。
- React 开发态 StrictMode：`src/renderer/main.tsx`。
- pdf.js 自定义协议选择与 Range 判定：`node_modules/pdfjs-dist/build/pdf.mjs` 的 `isValidFetchUrl()`、`getNetworkStream()` 和 `validateRangeRequestCapabilities()`；实现时应以 `package-lock.json` 锁定版本对应的源码为准，不修改 `node_modules`。

## 测试与验收建议

### 自动化测试

- 混合资源库 fixture：大量文本卡片、图片、PDF、链接目录和忽略目录同时存在。
- 在后台对账或 watcher 刷新期间请求 ready artifact，断言交互命令的 Worker `queueMs` 不超过预算。
- 文本摘要只读取可见窗口；快速滚动后旧批次取消；同 revision 重进视口命中缓存。
- 列表响应不等待 500 项拖拽信息；首屏拖拽仍能立即启动。
- 忽略目录测试需要证明其子孙文件没有被 `opendir/lstat`，不能只断言最终资产列表不显示。
- PDF 一次打开只产生一个有效 preview/source 会话，关闭时取消 Range transport 和 render task。
- PDF 首页 canvas 必须 `width > 0 && height > 0`，并证明首屏前读取字节数受控，而不是只断言 viewer DOM 存在。
- 长 PDF 不应在首页 render 前创建全部页面 canvas 或大量真实页面节点。

### 人工复验

开启：

```powershell
$env:SERPENT_WORKER_CMD_LOG='1'
$env:SERPENT_VIEWER_TIMING_LOG='1'
$env:SERPENT_REFRESH_STAGE_LOG='1'
npm start
```

复验步骤：

1. 打开混合内容测试库，立即进入文本和图片混合的文件夹并连续滚动。
2. 确认已生成缩略图不会在数秒静默后成批出现。
3. 后台仍活跃时分别打开 7 MiB 与 14 MiB 左右的 PDF。
4. 记录 viewer session、preview、source、PDF 首字节、首页 render 和后台 owner span。
5. 切到图像测试库复验，确保现有改善没有回归。

建议产品目标：

- ready 缩略图进入可见窗口后，不应出现无法由真实磁盘访问解释的 `>500 ms` Worker 排队；
- PDF 缩略图占位应立即出现；本地 SSD 上真实首页目标 `500 ms` 内开始显示；
- 同一 PDF 一次打开不应发生完整重复传输；
- 后台任务允许总时长较长，但必须可抢占，不得制造秒级 Worker callback 黑洞。

## 实现者交接清单

- 先加 owner span 和 PDF 阶段时序，复现一次后再改代码。
- 优先处理文本卡片批量化与 500 项拖拽预热，因为它们是当前源码和日志共同证实的请求放大。
- PDF 同时处理 session 去重、Range transport、首页优先；只做其中一项可能仍然慢。
- 不回退当前异步 reconciliation，也不重新引入同步文件系统遍历。
- 不以“最终都加载出来”作为通过标准；必须记录排队、首屏和重复请求的量化结果。
