# 查看器与缩略图加载延迟：Worker 饥饿排查与修复方案（2026-08-24）

> 状态：问题已复现，日志归因完成，尚未实施本文件中的结构性修复。
> 对应工单：`Serpent-29125f`。
> 范围：Windows 本地库与链接库；现象在 NAS 上会更严重，但本次已经证明它不只发生在 NAS。

## 1. 用户可见问题

当前有两个相互关联的表现：

- 双击打开图片、PDF、视频或文本后，查看器可能需要数秒才真正显示内容；同一个文件重复打开时耗时也不稳定。
- 图片先显示模糊缩略图，随后才变清晰。观察上经常是 Inspector 元数据出现后图片才变清晰，容易误判为“图片在等待元数据”。
- 已经生成好的缩略图有时也会很晚才显示；切换资源库时还可能短暂失败或空白。

本次复现使用了两个真实资源库：

- “混合内容测试库”：数据库约 8,863 个资产，其中大部分位于忽略目录，当前可见约一千余项。
- “图像测试库”：约 7,000 个可浏览资产，派生文件目录约 21,500 个文件。

复现中重点观察了 PDF 和多张不同尺寸的 JPG。本文不记录用户机器上的绝对路径。

## 2. 结论摘要

### 已确认

1. **数据库查询不是本次延迟的主要瓶颈。** 真实库中的主键、元数据、标签、色卡点查均为毫秒以下到数毫秒级；日志中的 `asset.metadata.get` 通常为 8–13 ms。
2. **图像没有在业务逻辑上等待元数据。** 原生图片预览与 Inspector 元数据请求已经并行；两者只是一起被堵在同一个 Library Worker 前面。
3. **主要时间消失在 Worker 收到消息回调之前。** Main 记录的预览往返可达 5.45 秒，而 Worker 回调内部真正处理预览只用约 229 ms。
4. **打开资源库后的后台对账仍会饿死交互请求。** 对账链包含同步 SQLite、同步递归文件枚举和同步 `lstat`。当前“交互空闲让步”只能发生在这些同步片段之间，不能抢占已经开始的同步片段。
5. **后台对账没有可靠地随资源库关闭而取消。** 最新日志两次出现旧资源库关闭后，对账继续访问已关闭数据库的 `The database connection is not open`。
6. **缩略图路径存在明显的请求积压和重复上报。** 单次会话出现 212 次可见窗口上报和 141 次派生文件路径查询；Worker 恢复响应时这些消息成批爆发。

### 高可信度根因

`refreshManagedAssetsOnOpen()` 的最后一次“发现新文件”会调用完整的 `refreshManagedAssets()`。该调用在一个同步 `better-sqlite3` 事务中递归枚举托管目录和链接目录，并对文件执行同步状态读取。枚举函数本身也是 `readdirSync` + `lstatSync` 的递归实现。只要这个同步片段开始执行，UtilityProcess 的消息端口就无法处理新到达的查看器和缩略图请求。

本次日志没有开启 `SERPENT_REFRESH_STAGE_LOG`，因此还缺少“某一个同步阶段独占了多少毫秒”的直接 span；但是主进程往返、Worker 回调内部耗时、长时间无任何 Worker 命令、随后成批释放积压消息，以及关闭后的对账报错已经共同锁定了后台对账链。实施修复前应补一轮阶段日志作为最终基线，而不是重新猜测数据库或源文件带宽。

## 3. 请求时序

图片查看器的主要路径如下：

```text
Renderer 双击资产
  ├─ requestPreview()
  │    └─ Main -> Library Worker: media.get-preview-artifact
  │          └─ 返回 preview/source 模式、revision 和色彩状态
  ├─ Inspector 元数据请求（并行）
  │    └─ Main -> Library Worker: asset.metadata.get
  └─ 得到 preview 结果后创建 serpent://source URL
       └─ Main -> Library Worker: media.get-source-path
            └─ Main 从源文件构造 Response
                 └─ Renderer 解码并将模糊层升级为清晰层
```

业务上，`asset.metadata.get` 不控制 `serpent://source`。但是这些请求都共用一个 Library Worker。当 Worker 正在执行不可抢占的同步后台工作时，所有消息都只能在 Electron/UtilityProcess 消息队列里等待。Worker 恢复后，元数据查询通常先在十几毫秒内完成，紧接着预览和源文件请求完成，所以视觉上看起来像“元数据加载完成才允许图片变清晰”。

相关实现：

- `src/renderer/AssetPreviewModal.tsx`：查看器请求预览。
- `src/renderer/zoomable-preview-image.tsx`：模糊层、原图加载与升级。
- `src/renderer/use-inspector-asset-metadata.ts`：Inspector 元数据独立请求。
- `src/main/index.ts`：`serpent://source`、`serpent://preview` 与派生路径批处理。
- `src/worker/index.ts`：Worker 消息分派、后台调度与计时日志。
- `src/worker/library-service.ts`：预览解析、源路径、开库对账和文件扫描。

## 4. 日志证据

复现日志为 `serpent-20260824T002900.log`。日志中的 `worker.cmd` 通过 `console.error` 输出，因此被日志系统标为 `level=error`；正常命令也会这样显示，不能把每一条 `worker.cmd` 当成失败。

### 4.1 最慢的 PDF 查看

同一个 PDF 的两次 Main 往返：

- `viewer.preview-worker-timing.workerMs = 5450`
- `viewer.preview-worker-timing.workerMs = 3964`

对应的 Worker 回调内部处理：

- `media.get-preview-artifact.runMs = 228.80`
- `media.get-preview-artifact.runMs = 205.52`

同一时段的其他请求：

- `asset.metadata.get.runMs = 10.99`
- `ai.content.get.runMs = 1.03`
- `media.get-source-path.runMs = 1.59`
- `viewer.source-timing` 从路径解析到 Response 可用为 9–16 ms。

结论：5.45 秒中，约 5.2 秒不在预览处理、元数据查询或源路径查询内部，而发生在 Worker 的消息回调能够开始执行之前。

### 4.2 多张 JPG 的重复结果

在另一个资源库中，Main 记录到的预览往返包括：

- 935 ms、3,754 ms、1,459 ms、3,465 ms、1,305 ms、2,813 ms。

对应的 Worker `media.get-preview-artifact.runMs` 约为：

- 5.95–125.23 ms，最慢不超过 229 ms。

同期元数据查询约 8–13 ms，源路径点查约 0.7–1.6 ms。文件大小和像素尺寸无法解释 0.7–3.7 秒的额外等待，而“请求何时终于进入 Worker 回调”可以解释。

### 4.3 Worker 计时存在盲区

当前 `SERPENT_WORKER_CMD_LOG=1` 的 `waitMs` 在 `parentPort.on('message')` 回调已经开始后才设置起点，因此它只能测量解析到 dispatch 之间的时间，无法测量：

```text
Main postMessage
  -> UtilityProcess 消息排队
  -> Worker 事件循环被同步后台工作占用
  -> parentPort message 回调终于开始
```

因此日志中 `waitMs = 0.02` 并不表示请求没有排队。Main 侧的完整往返减去 Worker `runMs` 才暴露了这段盲区。

### 4.4 数据库点查排除

对“混合内容测试库”数据库的只读基准：

- 资产主键点查：平均约 0.0035 ms。
- 元数据点查：平均约 0.0032 ms。
- 色卡记录点查：平均约 0.004 ms。
- 标签点查：平均约 0.0033 ms。
- SQLite 查询计划均命中现有索引。
- 色卡 JSON 文件读取：平均约 0.096 ms。
- 链接根目录 `realpath`：平均约 0.15 ms。

即使考虑 Electron IPC、Zod 校验和冷缓存，这些结果也不足以产生数秒级随机等待。

### 4.5 缩略图请求积压

本次会话记录：

- `asset.thumbnail.visible-window`：212 次，Worker 单次约 10–16 ms。
- `media.get-artifact-paths`：141 次，Worker 单次通常约 3–10 ms。
- 一秒内曾集中处理四十余次可见窗口上报和三十余次派生路径查询。

需要区分两个因素：

1. Worker 同步阻塞期间，Renderer/Main 已发出的消息会排队，恢复后自然形成“瞬间爆发”。
2. Renderer 的可见窗口 effect 依赖整个 `assets` 和 `browseLayout`。尺寸补齐、缩略图 ready 和瀑布流重排会改变可见集合，进而再次上报，确实存在反馈循环。

每次可见窗口上报在 Worker 中又会执行忽略过滤、中断视口外任务、提升任务优先级以及同步尺寸探测。单次不算慢，但高频重复后会持续占用同一个 Worker。

### 4.6 切库竞态

日志还记录了：

- 旧资源库关闭后，`open.background-reconciliation` 继续执行并访问已关闭数据库。
- 切库时出现数十条 `Artifact was absent from path batch`。
- 旧资源库的后台任务在新资源库已经打开后才报告 `LIBRARY_NOT_OPEN` 或数据库已关闭。

这不是单纯的性能问题，也是生命周期正确性问题。修复不能只增加超时、延迟启动或捕获异常；必须让后台工作具有可取消、可等待的所有权。

## 5. 代码层根因

### 5.1 开库对账的同步不可抢占区

`runOpenBackgroundReconciliation()` 依次执行数据库校验、忽略清理、旧代理退休、备份、回收站清理、资产刷新、索引预热和派生文件对账。

它调用的 `refreshManagedAssetsOnOpen()` 看似每 128 个本地资产或每 16 个网络资产让步一次，但最后仍执行一次完整发现：

```ts
this.refreshManagedAssets(libraryId, { assetIds: [] });
```

`refreshManagedAssets()` 内部把以下工作放进同步 SQLite 事务：

- 枚举每个链接文件夹。
- 递归枚举托管 Assets 目录。
- 每个文件执行同步 `lstat`。
- 建立完整快照 Map/Set。
- 对比、插入、更新 revision 和搜索索引。

`enumerateLinkedSources()` 与 `enumerateManagedSources()` 使用同步递归。事务内部既有文件系统 I/O，也有可能很大的内存与 SQL 循环。任何 `await yieldForInteractiveIdle()` 都无法进入这个调用内部。

### 5.2 交互优先级只能影响“下一项工作”

`noteInteractiveMediaRequest()` 会延长交互空闲窗口，也会尝试中断不相关的缩略图任务。但它只有在 Worker 已经收到并开始处理查看器消息后才执行。如果 Worker 正在同步扫描，消息回调本身无法开始，所以该优先级机制无法抢占真正的阻塞源。

### 5.3 可见窗口反馈循环

Renderer 的可见窗口 effect 当前依赖：

```text
api, library, assetViewMode, browseLayout, assets, trashedAssets
```

`asset.dimensions.ready` 与 `asset.thumbnail.ready` 会更新 `assets`；瀑布流重新布局后，可见集合可能变化；effect 随后重新测量并上报。当前只按有序 ID 字符串去重，不对短时间布局收敛做防抖，也没有 Worker 侧的最后窗口幂等缓存。

### 5.4 缩略图路径仍依赖 Worker 实时查询

每个 `serpent://preview` 请求都需要 Main 通过 `media.get-artifact-paths` 向 Worker 解析派生文件路径。Main 只在 2 ms 窗口内合并同时到达的请求；卡片跨多个渲染帧渐进挂载时，会形成许多小批次。即使派生文件已经 ready，Worker 饥饿仍会让卡片一直等待 URL 响应。

### 5.5 查看器重复读取原图（次要问题）

`zoomable-preview-image.tsx` 当前既用隐藏的完整 `<img>` 解码源图，又通过 `fetch + createImageBitmap + canvas` 构造中间层。在 Worker 响应恢复后，同一原图可能被读取/解码两次。它会增加 CPU、内存与文件读取，但不能解释本次“Worker 回调开始前已经丢失数秒”的主要延迟，应在主阻塞修复后再优化。

### 5.6 插件媒体 Provider 前置等待（独立风险）

`media.get-preview-artifact` 会先尝试插件媒体 Provider，再回退原生路径。没有匹配 Provider 时已经有快速路径；存在匹配但插件卡住时仍可能产生最长约 35 秒的独立等待。此次复现没有证据指向插件 Provider，但实施者应保留分阶段日志，避免未来把两类延迟混为一谈。

## 6. 修复设计

### 6.1 先补齐可观测性

不要直接根据现有 `worker.cmd.waitMs` 调参。应先补三层时间戳：

1. Main 在 `LibraryWorkerClient.request()` 调用 `postMessage` 前记录 `sentAt`。
2. Worker 在 `parentPort.on('message')` 第一行记录 `callbackAt`。
3. Worker 在 handler 前后记录 `dispatchAt` / `completedAt`，Main 收到响应记录 `resolvedAt`。

至少输出：

```text
ipcQueueMs = callbackAt - sentAt
parseDispatchMs = dispatchAt - callbackAt
serviceMs = completedAt - dispatchAt
returnMs = resolvedAt - completedAt
totalMs = resolvedAt - sentAt
```

时间戳应只在 `SERPENT_WORKER_CMD_LOG=1` 时启用，并带 `requestId`、`commandType`、`libraryId`。如果跨进程 `performance.now()` 时基不一致，应使用 `Date.now()` 或 Main 生成的 Unix 毫秒时间。

同时为开库对账的每个阶段增加开始、结束、取消与条目数日志。已有 `SERPENT_REFRESH_STAGE_LOG=1` 可以继续使用，但应覆盖完整发现、链接枚举、托管枚举、数据库提交和派生目录枚举，而不只记录函数内部局部阶段。

### 6.2 为每次开库建立明确的后台任务所有权

每次成功打开资源库时创建一个 reconciliation generation 和 `AbortController`：

- Worker 只允许当前 generation 继续执行。
- 关闭、切换、重新打开同一资源库前先 `abort()`。
- 后台任务在每个异步时间片和每次数据库提交前检查 signal/generation。
- 关闭数据库前等待该资源库的 reconciliation Promise 结束；等待必须有短的硬上限，超限后记录诊断并禁止后台任务继续碰数据库。
- `runOpenBackgroundReconciliation()` 捕获 `AbortError` 时正常退出，不记录为产品错误。

禁止只依赖 `openById.has(libraryId)`。任务可能在一次同步调用中拿着旧 `OpenLibrary` 引用，检查通过后数据库才被关闭；需要 generation + abort + close 顺序共同保证。

### 6.3 把文件枚举移出 SQLite 事务

完整发现应改成两阶段：

1. **文件系统阶段**：异步、可取消、按时间片枚举，生成小批量 snapshot。
2. **数据库阶段**：只把当前批次的差异放进短事务，提交后立即让出事件循环。

建议约束：

- 每个同步时间片以 4–8 ms 为预算，而不是固定 4,096 个条目。不同磁盘、Defender、SMB 和文件数量下，固定条目数没有稳定延迟意义。
- 每批最多处理 32–128 个文件，达到时间预算或数量上限即 `setImmediate`/timer 让步。
- 在进入子目录前应用文件夹忽略规则，忽略目录不应再枚举其后代。
- 不在数据库事务中执行 `readdir`、`lstat`、`realpath`、hash 或网络文件系统访问。
- 不为整个资源库一次性构建超大的 `Map`/`Set` 后才提交；以目录或小批为单位收敛。
- 交互活动发生时暂停新的发现批次；已经开始的批次必须在一个帧预算内结束。

如果完整发现对“打开即可浏览”不是必需，应把它移到首屏与查看器均稳定后的低优先级阶段。文件监听器负责正常增量变化，完整扫描作为最终一致性补偿，而不是开库首屏前后的强竞争者。

### 6.4 对可见窗口上报双重幂等

Renderer：

- 上报 key 使用稳定集合，不因 DOM 查询顺序变化而变化；如果 Worker 不需要视觉顺序，可排序后比较。
- 将 `assets` 的任意字段变化从 effect 依赖中移除；只在滚动、画布尺寸、布局几何版本或资源库/范围变化时重新测量。
- 使用标准 `IntersectionObserver`/`ResizeObserver` 或一个统一的 viewport controller，避免每个缩略图 patch 都重新扫描全部 DOM。
- 增加约 50–100 ms 的短防抖，并保留滚动停止后的最终上报；不要用长延迟破坏当前窗口优先级。

Worker：

- 按 `(libraryId, stableAssetIdSet)` 保存上一次已处理窗口，相同集合直接确认，不再重复执行尺寸探测和任务调度。
- 尺寸已经存在时不得重复产生 `asset.dimensions.ready`。
- 新窗口到达时可以取消旧的“可见尺寸探测”，但不应反复改写 queued 任务产生写入风暴。

### 6.5 缓存派生文件路径并处理切库

Main 增加有界缓存：

```text
(libraryId, artifactId, usage, revision/changeSequence) -> absolutePath
```

要求：

- 第一次批量解析后，后续 `serpent://preview` 不再经过 Worker。
- `thumbnail.ready/failed`、artifact invalidation、资源库关闭和 change sequence 变化时精确失效。
- 关闭资源库时拒绝该库所有尚未发出的 path batch，并清理缓存。
- 切库后旧协议请求返回明确的 410/取消结果，不应记为 `Artifact was absent from path batch`。
- 不允许跨资源库复用 artifactId 缓存。

这一步能显著改善“缩略图已经存在但仍等 Worker”的情况，但不能替代 6.3；查看器的源路径和其他交互命令仍需要 Worker 可响应。

### 6.6 查看器后续优化

在 Worker 饥饿修复后，再处理：

- 合并中间层和完整层对同一源图的重复读取/解码。
- 记录 Renderer 的 `preview request start/end`、`middle bitmap ready`、`full img onLoad` 和最终清晰层 commit。
- 对原生图片走最短 source-first 路径；RAW/OIIO/色彩转换保留必要派生路径。
- Inspector 元数据、AI 内容和色彩空间继续渐进加载，不得重新成为首帧门禁。
- PDF 另记录源 Response、pdfjs 文档解析、首屏页面渲染三个阶段，避免把 PDF 自身渲染成本算到 Worker 排队。

### 6.7 媒体解码并发

当前高核 Windows 机器上，媒体解码并发可能达到物理核数减三；Sharp/libvips 内部还可能自行并行。它会在真正生成缩略图时造成 CPU 过度订阅，但本次大部分目标资产已经有 ready 缩略图，所以它不是此次复现的首要根因。

实施者应在结构性阻塞修复后，用 `Serpent-l0yb` 的 Windows 基准测量 2、4、8 等并发档位，而不是直接把并发降为 1。交互延迟和整库吞吐必须分别记录。

## 7. 不应采用的修复

- 只把 Worker 请求超时从 15 秒提高到更大。它只延后报错，不减少等待。
- 只在 Renderer 隐藏 loading、延长模糊缩略图显示时间或增加动画。这会掩盖问题。
- 只给查看器任务提高数据库 priority。同步扫描期间消息回调无法开始，priority 尚未生效。
- 只减少 `asset.metadata.get` 字段或增加 SQLite 索引。本次证据已经排除它们是主要瓶颈。
- 在同步递归循环中偶尔 `await Promise.resolve()`。微任务让步不保证消息端口和 timer 获得执行机会；必须使用真正的 macrotask/time-slice，并拆掉事务中的文件 I/O。
- 捕获“database connection is not open”后静默忽略。生命周期竞态仍会访问旧库，也可能引发更严重的数据问题。
- 仅用固定条目数决定让步。文件系统单条成本跨 SSD、SMB 和杀毒环境差异过大，应使用时间预算。

## 8. 验证计划

### 8.1 自动化测试

至少增加以下覆盖：

1. **对账可抢占**：注入慢速文件枚举，在完整扫描期间发送 `media.get-preview-artifact`，证明 `ipcQueueMs` 和总往返不超过预算。
2. **切库取消**：对账进行到一半时关闭并打开另一个库；旧任务停止，日志中没有数据库已关闭、`LIBRARY_NOT_OPEN` 或旧库写入。
3. **忽略目录剪枝**：巨大忽略目录的子项不被读取、不被 stat，也不进入 snapshot。
4. **短事务**：文件系统 seam 断言不在 SQLite transaction 回调内执行。
5. **可见窗口幂等**：相同集合、不同 DOM 顺序只触发一次 Worker 工作；尺寸 patch 不形成循环。
6. **路径缓存隔离**：同一 artifact 重复请求命中缓存；切库、invalidated、revision 变化后失效；不同资源库不串用。
7. **协议取消语义**：切库时旧 `serpent://preview` 返回可预期取消/410，不产生 absent-path 错误风暴。

任何修改 `library-service`、开库/关库或 Library Worker 生命周期的实现，都必须完整运行：

```bash
npm run test:library-availability
```

修改 Renderer/Main/Worker/自定义协议后，还必须运行对应真实 Electron E2E。E2E 应后台执行并使用隔离 userData。

### 8.2 20,000 资产基线

使用仓库大型库 fixture，至少记录：

- 开库到主窗口可交互。
- 开库对账运行期间，查看器预览 `ipcQueueMs`、`serviceMs` 和总耗时的 p50/p95/max。
- ready 缩略图首屏路径解析与图片 decode 的 p50/p95/max。
- 可见窗口上报次数和去重率。
- 切换资源库后的旧任务数量、取消耗时和错误日志数。

验收目标沿用仓库产品门槛：资源库打开/切换持续超过 3 秒才显示简洁身份提示和切换入口，结构快照完成后再进入主界面；进入主界面后查看器/Inspector 首屏约 500 ms 内开始呈现。对本工单建议增加：后台对账期间原生图片/PDF 的 Worker IPC 排队 p95 不超过 100 ms，单次不可抢占同步片段不超过 16 ms。具体阈值应在 Windows 真机基线后固定。

### 8.3 人工真机复验

开启：

```powershell
$env:SERPENT_VIEWER_TIMING_LOG='1'
$env:SERPENT_WORKER_CMD_LOG='1'
$env:SERPENT_REFRESH_STAGE_LOG='1'
npm start
```

复验步骤：

1. 打开真实大型资源库后立即双击图片、PDF、视频和 Markdown。
2. 在后台对账和缩略图生成期间连续切换不同文件。
3. 同一文件首次、第二次、第三次打开分别记录耗时。
4. 快速切换两个资源库，观察旧缩略图请求和旧对账是否完全取消。
5. 滚动瀑布流，确认 ready 缩略图不再成批等待或空白。

通过条件：

- 图片清晰层不再与 Inspector 元数据出现时间绑定。
- 无数秒级、无法由源文件读取或 PDF 渲染解释的 Worker 排队。
- 无 `database connection is not open`、旧库 `LIBRARY_NOT_OPEN`、absent-path 风暴。
- 相同可见窗口不会持续重复上报。
- ready 缩略图不因后台对账而延迟数秒。

## 9. 推荐实施顺序

1. 补跨进程 IPC queue 和 reconciliation stage 插桩，复现一次并保存修复前基线。
2. 建立开库对账 generation/AbortController 和安全关闭顺序。
3. 将完整文件枚举移出 SQLite 事务，改成按 4–8 ms 时间片的异步批处理。
4. 修复可见窗口重复上报和 Worker 幂等。
5. 增加 Main 派生路径缓存与切库批次取消。
6. 运行 Library Availability、定向 Worker 测试和真实 Electron E2E。
7. 再根据 Renderer timing 决定是否合并原图双重读取，以及是否调整 Sharp 并发。

前三步解决查看器和缩略图共同的根因；第四、第五步收口缩略图请求放大；最后一步只处理根因消除后仍然存在的解码成本。不要把这些步骤混成一次无法归因的大改。
