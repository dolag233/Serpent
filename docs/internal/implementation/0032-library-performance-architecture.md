# 0032 实施规格：大型资源库端到端性能架构

> 状态：设计稿 v1（2026-08-25）
> 范围：资源库打开、浏览、搜索、缩略图、查看器、后台任务、文件监听与恢复
> 关联原则：[渐进加载 UX](../ui/0006-progressive-loading-ux-principles.md)、[Worker 饥饿排查](../research/2026-08-24-viewer-thumbnail-worker-starvation.md)

## 0. 目标

本规格把大型资源库性能从零散优化收敛为一套端到端架构。目标不是让某一个 SQL、解码器或动画单独变快，而是保证用户正在进行的操作始终先获得响应，后台工作可以持续但不能占住首屏。

目标容量沿用产品定义：单资源库最多约 10 万资产、2 TB 原始内容；Windows 与 macOS 行为一致；资源库可以位于本地磁盘、移动硬盘、NAS 或第三方同步目录。

核心指标：

- 打开资源库后约 1 秒内进入可交互主界面。
- 切换文件夹、合集、过滤或搜索后，500 ms 内开始出现首屏内容；固定搜索首屏不超过 1 秒。
- 双击资产后，500 ms 内出现可理解的首帧、缩略图或格式占位；后台元数据、色卡、AI 不得成为首帧门禁。
- ready 缩略图进入可见窗口后，不得因为后台对账或其他媒体任务产生秒级等待。
- 删除、恢复、移动等操作后，当前视图 200 ms 内先局部更新，后台持久化随后收敛。
- 后台任务可以总耗时较长，但任何单段不可抢占工作都必须有明确预算、所有者和诊断记录。

## 1. 约束与不变量

以下边界不因性能优化而改变：

1. Renderer 不获得任意路径、SQL、文件系统或子进程能力。
2. Main 不打开资源库数据库，不扫描资源库目录。
3. Library Worker 仍是 SQLite 和资源库文件操作的唯一所有者。
4. SQLite 仍是元数据真相源；缓存只能加速，不能成为另一套不可对账的状态。
5. 文件操作必须保持可恢复语义，不能为了减少事务而牺牲删除、撤回、导入和重启恢复。
6. 资产排列顺序、Tab/Shift 选择顺序和滚动锚点必须稳定，不能用更快但语义不同的瀑布流算法替换。
7. 性能日志不得记录开发机器绝对路径、密钥或其他隐私；只记录资源库 ID、资产 ID、文件名和经过分类的阶段信息。

## 2. 当前基线

当前代码已经具备若干正确机制，后续设计必须在其上收敛，不能重复实现：

- 浏览首屏分页、按偏移加载和过期 generation 丢弃。
- `layoutOnly` 几何读取、瀑布流/平铺的稳定阅读顺序和滚动锚点补偿。
- 可见窗口缩略图上报、相同窗口幂等、可见任务抢占 startup wave。
- 搜索请求按 lane 保留最新请求。
- 开库后台对账具有 generation、取消和分批处理基础。
- 缩略图、查看器图像、视频 poster/proxy、联系表、色卡等 artifact 已分类型存储。
- durable jobs、priority、attempt、lease、暂停/取消/重试已经存在。
- Main 已有预览文件本地镜像缓存；图片查看器已经避免对同一原图进行两套完整解码。

尚未收敛的问题不是“完全没有优化”，而是这些机制分散在 Renderer、Main、Worker 和多个媒体路径中，缺少统一的请求所有权、lane 预算、缓存失效规则和阶段指标。结果是局部机制正确，但混合负载下仍可能互相放大。

## 3. 性能热区

| 层级 | 热区 | 典型症状 | 主要资源 |
| --- | --- | --- | --- |
| 首屏 | 打开/切换资源库 | 主界面迟迟不可操作、旧库任务继续运行 | SQLite、扫描、生命周期 |
| 首屏 | 文件夹/合集导航 | 内容和侧栏一起等待、计数刷新拖慢画布 | SQL、COUNT、IPC |
| 首屏 | 网格与虚拟化 | 滚动白区、重排跳动、缩略图成批出现 | Renderer、布局、解码 |
| 首屏 | 查看器 | 双击后空白、模糊层等待元数据、退出跳顶 | IPC、源读取、解码 |
| 数据 | 扫描与目录枚举 | 链接目录、忽略规则和 NAS 导致秒级停顿 | 文件系统、网络往返 |
| 数据 | SQLite/IPC 请求放大 | 单次查询很快但大量请求一起排队 | Worker 事件循环、序列化 |
| 数据 | 元数据 | EXIF、视频 probe、色彩信息拖住首帧 | 文件读取、子进程、SQLite |
| 数据 | 搜索/过滤/计数 | 输入后旧查询仍执行、侧栏重复 COUNT | FTS、动态 SQL、缓存 |
| 媒体 | 缩略图/代理 | 重复生成、不可见资产抢占、原生可播仍生成代理 | CPU、内存、子进程、磁盘 |
| 媒体 | 大文件/复杂格式 | RAW、TIFF、PDF、视频或 3D 首开很慢 | 解码器、峰值内存、随机读取 |
| 媒体 | 色卡/AI/索引 | 后台工作让浏览和查看不稳定 | CPU、网络、数据库写入 |
| 后台 | 导入/删除/恢复 | 长事务、重复 hash、操作后 UI 不收敛 | 文件系统、事务、缓存失效 |
| 后台 | 任务调度 | 队列很长但看不出在等什么 | job store、lane、日志 |
| 后台 | watcher/网络盘 | 事件风暴、反复扫描、远端断线卡死 | watcher、目录枚举、重试 |

## 4. 目标架构

```mermaid
flowchart LR
  UI["Renderer：用户意图与稳定占位"]
  Broker["Main：请求代理、路径缓存、协议流"]
  Scheduler["Worker：交互调度器"]
  ReadModel["浏览会话与摘要读模型"]
  DB["SQLite 真相源"]
  Media["媒体 artifact lanes"]
  Reconcile["扫描、监听与一致性维护"]

  UI -->|语义请求 + generation| Broker
  Broker -->|requestId + lane + deadline| Scheduler
  Scheduler --> ReadModel
  ReadModel --> DB
  Scheduler --> Media
  Scheduler --> Reconcile
  Media -->|ready / failed / progress| Broker
  Reconcile -->|changeSequence| ReadModel
  Broker -->|渐进事件| UI
```

架构由六个协同部分组成：

1. **请求代理**：跨进程标记请求身份、generation、lane 和时间戳。
2. **交互调度器**：统一决定谁可以开始工作；只允许在安全边界抢占，不强杀正在写文件的操作。
3. **浏览会话**：一次导航建立稳定结果序列，分页、几何、计数和选择复用同一快照。
4. **artifact 策略**：明确卡片、查看器占位、查看器高清和播放代理的不同角色。
5. **渐进查看器**：首帧、升级、元数据和邻项预取彼此独立且可取消。
6. **后台维护**：扫描、watcher、色卡、AI、索引和清理只能使用剩余预算。

## 5. 跨进程请求模型

### 5.1 请求信封

Main 转发给 Worker 的交互请求统一附加内部信封：

```ts
type PerformanceLane =
  | "interactive-control"
  | "visible-media"
  | "viewer-upgrade"
  | "mutation"
  | "background-primary"
  | "background-secondary"
  | "maintenance";

type WorkerRequestEnvelope = {
  requestId: string;
  libraryId?: string;
  libraryGeneration?: number;
  interactionGeneration?: number;
  lane: PerformanceLane;
  sentAtEpochMs: number;
  deadlineAtEpochMs?: number;
};
```

Renderer 只发送领域语义和必要的 `interactionGeneration`，不自行决定性能 lane。Main 根据命令类型分类，避免插件或 Renderer 把普通后台任务伪装成高优先级工作。

### 5.2 过期规则

- `libraryGeneration` 不匹配：请求在进入业务 handler 前取消。
- `interactionGeneration` 已被同 lane 的新请求替代：返回 typed cancelled，不进入 SQLite 或文件系统。
- source/artifact 请求对应的 revision 不再是当前 revision：返回 stale，不解析旧文件。
- 请求超过 deadline：只有尚未进入 scheduler admission boundary 的可取消请求被丢弃；`onAdmitted`
  开始后即视为已开始，已经开始的文件写入必须完成到安全提交点再取消。

### 5.3 统一计时

仅在诊断开关启用时记录：

```text
ipcQueueMs     = Worker 回调开始 - Main 发送
dispatchMs     = handler 开始 - Worker 回调开始
executeMs      = handler 完成 - handler 开始
returnMs       = Main 收到 - handler 完成
totalMs        = Main 收到 - Main 发送
```

所有后台任务另记录 `ownerType`、`lane`、`itemsProcessed`、`yieldCount` 和最长连续占用时间。这样可以区分“SQL 慢”“文件慢”“解码慢”和“请求根本没获得执行机会”。

## 6. 交互调度器

### 6.1 lane 语义

| Lane | 内容 | 开始规则 |
| --- | --- | --- |
| `interactive-control` | 浏览首屏、搜索、计数、metadata 摘要、source/artifact 路径 | 最高优先；不得执行文件扫描或解码 |
| `visible-media` | 当前视口缩略图、当前 PDF 首页 poster | 可抢占尚未 claim 的后台媒体任务 |
| `viewer-upgrade` | 当前查看器原图、RAW 高清、PDF 页、播放 fallback | 每个 viewer session 最多一个主升级任务 |
| `mutation` | 导入提交、重命名、移动、删除、恢复 | 每个资源库串行；短事务提交 |
| `background-primary` | 非可见缩略图、技术元数据、索引补齐 | 有界并发；交互活跃时暂停 claim |
| `background-secondary` | 色卡、AI、联系表、低优先级代理 | 默认单路；系统压力时最先暂停 |
| `maintenance` | 对账、备份、清理、远端轮询 | 4–8 ms 时间片；每片后让出事件循环 |

### 6.2 默认预算

预算作为可测量默认值，不写死为平台能力结论：

- SQLite Owner 同时只执行一个同步事务；交互读事务目标小于 50 ms，写事务目标小于 100 ms。
- `visible-media + viewer-upgrade` 共用原生解码预算，默认最多 2 个外部解码进程；viewer 至少保留一个名额。
- `background-primary` 默认最多 2 个原生任务。
- `background-secondary` 默认 1 个任务。
- model offscreen、HTML capture 等单窗口 renderer 继续 single-flight。
- 任一资源压力错误触发全局 cooldown，但 interactive SQL/source path 查询不能被一起冻结。

后续可按 Windows/macOS 真机基准调整并发；不根据逻辑核心数无限放大，因为 Sharp、FFmpeg、OIIO 等内部还会自行并行。

### 6.3 admission control

任务进入 durable job 表之前先检查：

1. 资产是否仍属于当前资源库 generation。
2. revision 是否仍是当前 revision。
3. 是否已被忽略或已删除。
4. 媒体类型是否支持该 job，例如音频不能进入色卡。
5. artifact key 是否已有 ready/active/queued 记录。
6. 原生播放/查看是否已经满足需求，是否真的需要代理。

已知不应执行的任务不得先插入再显示 `ASSET_IGNORED` 或 `UNSUPPORTED_FORMAT`。

## 7. 资源库打开与后台对账

### 7.1 readiness 状态

```ts
type LibraryReadiness =
  | "opening"
  | "summary-ready"
  | "browse-ready"
  | "reconciling"
  | "ready"
  | "degraded";
```

状态含义：

- `opening`：取得资源库所有权、打开数据库、执行必要迁移与恢复。
- `summary-ready`：资源库名称、能力、根目录和 change sequence 可用，主界面可以出现。
- `browse-ready`：当前范围首屏摘要已返回。
- `reconciling`：扫描外部变化、修复孤儿 artifact、补齐派生数据。
- `ready`：当前 generation 的必要对账完成。
- `degraded`：网络盘离线或部分维护失败，但已打开数据仍可浏览；写入按能力门禁处理。

只有取得数据库所有权、迁移和最小恢复属于打开阻塞路径。全库扫描、缩略图、色卡、AI 和普通索引维护不能阻止 `summary-ready`。

### 7.2 对账所有权

每次打开资源库创建：

```ts
type ReconciliationOwner = {
  libraryId: string;
  libraryGeneration: number;
  controller: AbortController;
  promise: Promise<void>;
};
```

关闭或重新打开同一资源库时：先 abort，等待 Promise 到达安全点，再关闭数据库。旧 owner 无权发送事件、写缓存或触碰新 generation。

### 7.3 startup burst gate

开库后的对账与全库媒体回填共享一个按 `libraryId + libraryGeneration` 隔离的
startup burst gate。gate 在 `library.opened` 响应投递前保留一个 opening sentinel；只有
首个成功的 `asset.search`/`folder.browse-entries` 响应已经投递且该库的在飞命令归零后，
才允许维护任务进入 scheduler。不同资源库的 browse 不能释放彼此的 gate；关闭、重新打开
代际替换和 Worker shutdown 只取消对应 gate。15 秒上限是降级逃生阀，不是首屏成功证明。

### 7.4 文件系统与事务分离

对账分成两阶段：

1. 异步文件系统阶段：`opendir`/异步 `lstat`，在进入子目录前应用忽略规则，按目录和时间片产生小批 snapshot。
2. 短数据库阶段：只提交当前批次差异，不在事务中执行 `readdir`、`lstat`、`realpath`、hash、解码或网络访问。

每个维护时间片预算 4–8 ms，或最多 32–128 个条目，任一条件先达到就让出。固定条目数只作为上限，不能替代时间预算。

## 8. 浏览会话与摘要读模型

### 8.1 BrowseSession

一次文件夹、合集、智能合集、搜索或过滤导航创建稳定浏览会话：

```ts
type BrowseSession = {
  sessionId: string;
  libraryId: string;
  libraryGeneration: number;
  changeSequence: number;
  queryFingerprint: string;
  total: number;
  createdAt: number;
};
```

首个响应返回 `sessionId + total + firstPage`。后续页面、几何、全选 ID 和计数必须复用同一 session，避免 Renderer 为同一范围重新拼装多次动态 SQL。

当资产内容变化时：

- 不影响当前 scope/order 的 metadata 更新，只 patch 可见摘要。
- 影响过滤、排序、成员关系或数量的变化，使 session 标记 stale；Renderer 保留现有画面并安静创建新 session。
- 旧 session 请求返回 stale，不再继续占用 Worker。

### 8.2 AssetSummary 分层

首屏摘要只包含：

- assetId、revisionId、文件名、扩展名、大小、修改/添加时间。
- 已知宽高、时长、评分、喜欢、availability。
- 卡片 artifact 状态和 ID。
- 当前卡片展示确实需要的轻量字段。

以下内容不进入首屏门禁：完整 EXIF、相机参数、codec 明细、全部标签实体、合集明细、AI 内容、完整色卡、插件字段和大段文本。

Inspector 使用字段组渐进补齐：

```text
summary -> organization -> authored metadata -> technical metadata -> AI/plugin
```

任一组失败不阻止其他组显示。

### 8.3 缓存结构

Worker 为每个打开资源库维护统一 `LibraryReadCache`：

- folder tree summary：按 `changeSequence + showIgnored`。
- collection recursive counts：按 `changeSequence`。
- browse order/session：按 `queryFingerprint + changeSequence`。
- technical metadata：按 `assetId + revisionId + extractorVersion`。
- artifact descriptor：按 `assetId + revisionId + kind + generatorVersion`。

缓存失效只能由 change event、revision 更新、设置变化或生成器版本变化触发。不得用“每次打开面板清空全部缓存”维持正确性。

## 9. 大列表、布局与虚拟化

### 9.1 Renderer 数据模型

Renderer 不长期持有 10 万个完整 `AssetSummary`。它维护：

- 当前 BrowseSession。
- 当前窗口及小范围 overscan 的完整摘要。
- 轻量几何块：索引、宽高比、累计布局 checkpoint。
- 选中 ID、焦点 ID、滚动锚点和本地 optimistic patch。

### 9.2 几何分块

当前全量 `layoutOnly` 可以作为过渡方案，但 10 万资产时不应每次导航都传完整字符串 ID 和尺寸数组。目标接口按块返回：

```ts
type BrowseGeometryBlock = {
  sessionId: string;
  startIndex: number;
  entries: Array<{ index: number; assetId: string; width: number | null; height: number | null }>;
};
```

Renderer 只请求视口附近和滚动目标附近的块。长距离拖动滚动条时先用默认宽高比估算位置，再用真实块修正；修正围绕逻辑锚点 `assetId + relativeOffset`，不能跳到列表顶部。

布局计算从 React render 中抽离到独立纯模块；如 20k/100k 基准证明主线程计算成为热点，再迁入 Renderer Web Worker。Web Worker 只能计算几何，不访问资源库或业务 API。

### 9.3 媒体节点预算

- DOM 只保留可见区域和约 1–2 屏 overscan。
- 当前实现为快速滚动保留约 5 个 viewport 的结构化 runway，但只有与真实 viewport 相交
  的卡片获得立即加载优先级并挂载媒体 URL；overscan 卡片只保留几何/图标，不触发源图或
  artifact 解码。这是为避免白区的结构预算，不等于 5 个 viewport 的媒体解码预算。
- 不可见卡片释放 `<video>`、canvas、PDF page 和大图解码资源；普通 `<img>` 是否保留由内存预算决定。
- 同一帧收到多个 `thumbnail.ready` 时批量 patch，并在一次布局提交中完成。
- 可见窗口上报由统一 viewport controller 产生，不依赖任意 `assets` 字段变化。

## 10. artifact 策略

### 10.1 角色

```ts
type ArtifactRole =
  | "card-thumbnail"
  | "viewer-placeholder"
  | "viewer-image"
  | "video-poster"
  | "playback-proxy"
  | "contact-sheet"
  | "audio-waveform"
  | "technical-metadata"
  | "palette";
```

artifact 的幂等键：

```text
assetId + revisionId + role + generatorId + generatorVersion + settingsHash
```

ready 和确定性 failed 都需要缓存。只有源 revision、生成器版本、相关设置或用户显式重试发生变化时重新生成；打开资源库、切换文件夹和刷新视图不能成为再生成理由。

### 10.2 格式策略

| 格式类别 | 卡片 | 查看器 | 代理规则 |
| --- | --- | --- | --- |
| 小型浏览器原生图片 | 源图直出或小缩略图 | 真实源图 | 不生成代理 |
| 大型 JPEG/PNG/WebP/AVIF | card thumbnail | placeholder 后加载真实源图 | 仅缓存缩略图 |
| SVG/GIF | 静态卡片图 | 源矢量/动画 | 不用静态图替代查看能力 |
| RAW/ARW | 内嵌 JPEG 优先 | placeholder 后进入真实 RAW/高质量解码 | 内嵌图不能冒充高清原图 |
| TIFF/TGA/EXR/PSD/ICO | card thumbnail | 专用 viewer-image 或源格式解码 | ICO 选择最大有效图层 |
| PDF/HTML | 首页 poster | 按页/按范围加载 | 不把整份文档转成单张巨图 |
| 浏览器原生可播视频 | poster | 直接播放源文件 | 真实播放失败才生成代理 |
| 非原生视频 | poster | 先显示 poster，proxy ready 后播放 | 代理按 revision 幂等 |
| 音频 | waveform | 原生播放或必要音频代理 | 不进入色卡 |
| 3D | 单视图 card render | 源模型 viewer | AI 四视图与卡片图分开 |

source-direct 由文件体积、像素总量、动画/多页属性、平台能力共同决定，不能只看扩展名。
当前卡片策略的明确 admission 为：原生 JPG/JPEG/PNG/WebP/GIF、尺寸已知、长边不超过
2048 px、源文件不超过 1 MiB、总像素不超过 2,000,000；这只约束卡片/布局预览，查看器
显式 source 路径仍可按 revision 鉴权读取完整源文件。

### 10.3 路径和字节缓存

Main 的本地预览镜像继续作为网络盘加速层，并增加两类指标：hit/miss、复制字节和 eviction。artifact path 解析使用有界 LRU：

```text
libraryGeneration + artifactId -> authorized absolute path
```

资源库关闭、artifact invalidated 和删除资源库时精确失效。该缓存只减少 Worker 路径查询，不能绕过权限校验或把绝对路径发给 Renderer。

## 11. 查看器状态机

```text
closed
  -> resolving
  -> placeholder-visible
  -> source-loading
  -> ready
  -> degraded
```

每次打开产生 `viewerSessionId + assetId + revisionId`。所有 preview、source、proxy、PDF range、metadata 和相邻预取都携带 session；关闭、切换资产或 revision 改变时 abort。

规则：

1. 已有 placeholder 时立即挂载，不等待 source URL、metadata 或 proxy。
2. 浏览器可直接处理的图片只保留一个完整源图解码；placeholder 在 `naturalWidth > 0` 后才隐藏。
3. 用户的缩放、平移、旋转和镜像属于 viewer session 状态，清晰度升级不得重置。
4. Inspector 请求与画面请求并行，Inspector 失败不能改变画面状态。
5. 相邻预取最多前后各 1 项，并使用 `viewer-upgrade` 的剩余预算；快速连续切换时只保留最终邻项。
6. 关闭查看器先取消 session，再恢复浏览锚点；旧图加载完成不得闪现在新 session。

PDF 额外要求：

- 同一 session 只允许一个 loading task。
- 首页面 poster 立即显示。
- 通过受控 Range transport 按 offset/length 读取，Renderer 不获得路径。
- 首页 render 先于全部页面 placeholder 创建。
- 长文档只保留当前页附近 canvas，限制首屏 canvas 像素预算，空闲时再升级清晰度。

## 12. 搜索、过滤、文件夹与合集

### 12.1 搜索和过滤

- `query + filters + scope + sort + showIgnored` 规范化后生成稳定 fingerprint。
- 输入约 200 ms 防抖后创建新 BrowseSession；Worker 在进入 SQLite 前丢弃同 lane 旧请求。
- FTS、普通浏览、ids-only、layout/geometry 和 count 使用独立 lane key，互不误取消。
- 技术元数据过滤只查询 ready artifact 投影，不在搜索请求内现场生成 metadata。
- 随机排序必须使用稳定 session seed；过滤开启后仍保持有效随机结果和分页一致性。

### 12.2 侧栏与计数

侧栏使用一次 `LibraryNavigationSummary` 返回 folders、linked folders、collections、smart collections、trash 和必要计数。画布首屏请求必须先入队，侧栏 hydration 随后渐进更新。

计数规则：

- 文件夹在递归开启时返回当前文件夹与后代资产总数。
- 合集递归计数对资产 ID 去重，不把子合集数量计入资产数。
- 叶子合集走直接 membership index；只有存在后代时才执行递归查询。
- MCP、插件、导入或删除更新标签/合集后，以 change sequence 局部失效过滤和侧栏缓存。

## 13. watcher、链接文件夹与网络盘

### 13.1 本地磁盘

- watcher 事件先进入 coalescing buffer，以目录和资产归并。
- 连续复制中的文件必须经过 size/mtime 稳定窗口后再导入和生成 artifact。
- 一批事件只产生一次 change sequence 推进和有限数量 UI patch。

### 13.2 网络盘

- 网络盘不承诺高频 watcher 可靠性；使用低频目录 fingerprint/mtime 扫描。
- 远端扫描按目录 checkpoint 恢复，断线立即停止新的写入和解码读取。
- ready preview 可以从 Main 本地镜像缓存读取；源文件打开仍需重新验证远端可用性。
- UI 显示后台校验或离线状态，但保持已有缓存内容可浏览。

### 13.3 忽略规则

忽略规则在进入目录前匹配。被忽略目录的后代不得 `opendir`、`lstat`、入库、创建 job 或进入后台任务 UI。规则保存后：

- 新增忽略：局部取消匹配资产任务并从当前 session 移除。
- 删除忽略：只扫描受影响规则前缀，不启动无范围全库扫描。

## 14. 导入、移动、删除与恢复

每批文件操作使用明确状态机：

```text
planned -> filesystem-running -> db-committing -> artifact-invalidating -> completed
                                 \-> recovering -> completed/failed
```

设计要求：

- 文件枚举、复制、hash 和解码不在 SQLite transaction 内执行。
- 去重先按大小、文件名、已有 source fingerprint 缩小候选，再对候选读取内容 hash。
- 每个事务只提交当前小批次，并更新 operation manifest/checkpoint。
- Renderer 先做 optimistic patch；Worker 失败时用 typed result 精确回滚受影响资产。
- 删除/恢复/移动后同步失效当前 BrowseSession、合集计数、标签过滤、artifact path 和技术元数据缓存。
- 应用完整退出再启动后，文件系统、SQLite、operation manifest 和 artifact 必须能够对账。

## 15. 可观测性

统一性能事件：

```ts
type PerformanceSpan = {
  requestId?: string;
  ownerId: string;
  libraryId?: string;
  assetId?: string;
  assetName?: string;
  lane: PerformanceLane;
  stage: string;
  queueMs?: number;
  executeMs: number;
  itemCount?: number;
  bytes?: number;
  cache?: "hit" | "miss" | "store" | "evict";
  outcome: "ok" | "cancelled" | "skipped" | "failed";
  reasonCode?: string;
};
```

诊断日志只记录文件名，不记录绝对路径。面向用户的后台任务 UI 显示：文件名、任务类型、排队/运行阶段、进度、简短失败原因和重试动作；内部 `queueMs` 等仅在诊断日志中显示。

需要建立以下固定仪表：

- Worker event-loop lag 与最长连续占用。
- 各 lane 队列深度、claim、取消和完成数。
- browse session 创建、复用和失效数。
- SQLite query/transaction p50/p95/max。
- artifact cache hit/miss、重复生成和失败重试。
- viewer placeholder、source response、decode、first paint、upgrade commit。
- watcher 合并率、目录访问数、忽略剪枝数。

## 16. 实施拆分

### 阶段 A：统一指标与所有权（P0）

建议新增/抽取：

- `src/shared/performance-contract.ts`：lane、readiness、内部诊断结构。
- `src/main/library-request-broker.ts`：请求信封、Main/Worker 跨进程计时。
- `src/worker/interactive-scheduler.ts`：lane admission、最新 generation、时间片门禁。
- 从 `library-service.ts` 抽取 `reconciliation-owner.ts`，收敛打开/关闭/切库所有权。

完成条件：所有交互和后台 owner 可区分；旧库任务不能访问已关闭数据库；日志无绝对路径。

### 阶段 B：首屏与查看器（P0）

- 抽取 `src/renderer/viewer/viewer-session-controller.ts`，统一图片、PDF、视频和复杂图像的 session/cancel。
- Main artifact path LRU 接入 library generation 精确失效。
- Inspector 字段组渐进加载，不参与 primary surface 判定。
- PDF loading task 去重、Range transport、首页优先和页面虚拟化。

完成条件：后台对账期间图片/PDF 首帧不出现无法解释的秒级等待；快速打开/退出不跳顶、不闪旧图。

### 阶段 C：浏览会话与虚拟化（P1）

- `src/worker/browse-session-store.ts`：查询 fingerprint、稳定顺序、分页/geometry/count 复用。
- `src/renderer/browse/use-virtual-browse-session.ts`：窗口摘要、几何块、逻辑锚点。
- `App.tsx` 只保留组合层；新增交互不得继续内联进巨型组件。
- 侧栏改为 `LibraryNavigationSummary` 渐进 hydration。

完成条件：20k/100k 资产不向 Renderer 常驻传输完整摘要；切换范围首屏稳定，侧栏不会抢在画布前执行。

### 阶段 D：媒体与缓存（P1）

- `src/worker/artifact-policy.ts`：格式能力、source-direct、artifact role 和幂等键。
- durable job claim 前 admission control。
- RAW 内嵌预览、复杂图像 viewer-image、原生视频直放和代理 fallback 分开。
- Eagle/Billfish 导入保留 copy-first 首屏，超出 512 边长或字节预算的外部预览在后台
  有界归一化；旧 artifact 在新 artifact 事务提交前保持可用。
- PreviewCache 增加观测与按库预算；生成器版本变更只失效相关 artifact。
- 可见媒体波次使用重叠率和 generation 做抢占；轻量 viewport wave 不得顺手触发全局补队列
  或尺寸回填；连续 claim 之间让出 Worker event loop，并保持 bounded wave 的 primary/
  secondary 边界。

完成条件：同一 revision 不重复生成；原生支持格式不无条件生成代理；非视觉资产不进入色卡；
外部库大尺寸预览不会成为可见窗口的长期原样解码负担，归一化失败不丢失旧预览。

本阶段的可见媒体队列稳定化记录在
[D.6 开发日志](../development/2026-08-26-library-performance-architecture-stage-d6-visible-media-queue-development-log.md)。
它解决了严格 20k 基准中“数据库 artifact 已 ready 但真实卡片没有 `src`”的摘要/布局快照
竞态，但修正后的 `all-images` 基准还暴露出冷缩略图生成尾延迟：实际 20,000 live asset
本地 APFS 夹具冷跑为 1/10（全部解码 p50 1,176.9ms、p95/max 5,005.7ms，first visual
wave p50 155.1ms），同一夹具 warm 对照为 7/10（全部解码 p50 179.2ms、p95/max 5,015.3ms，
first visual wave p50 134.8ms）。因此 20k 严格门禁尚未通过；该结果不覆盖 100k、Windows、
NAS/SMB、packaged 或人工验收。

### 阶段 E：扫描、监听与文件操作（P1/P2）

- 对账改为异步目录迭代 + 短事务批次。
- watcher coalescing、稳定文件窗口、网络盘周期 scan。
- operation manifest 与 BrowseSession/changeSequence 的局部失效接线。

完成条件：后台维护不制造秒级 Worker callback 黑洞；忽略目录不被访问；完整重启后对账一致。

## 17. 测试与验收

### 17.1 自动化

必须补充：

1. 慢目录枚举期间请求浏览、source path 和 ready artifact，证明交互请求在预算内开始执行。
2. 对账进行中切库，旧 generation 全部取消且无关闭数据库访问。
3. 相同 BrowseSession 的分页、geometry、count 复用同一快照；变化后正确 stale。
4. ignored、deleted、revision mismatch 和 unsupported job 在入队前被筛掉。
5. 同一 artifact key single-flight；ready/failed 缓存与生成器版本失效正确。
6. 查看器 session 切换、快速关闭、placeholder→source 升级和 metadata 并行。
7. 长 PDF 只加载首页和邻页，单 session 无重复 source/range 请求。
8. 文件夹/合集递归计数正确，合集资产去重，标签/MCP 更新触发局部失效。
9. 本地 watcher 事件合并、网络盘轮询、忽略目录剪枝。
10. 操作中断后完整进程重启，对账 DB、文件、manifest 和 artifact。
11. Eagle/Billfish 大尺寸缩略图的 copy-first、后台归一化、失败保留旧 artifact 和重试标记。

任何触及资源库打开、关闭、schema、`library-service` 或 Worker 生命周期的实现都必须完整运行：

```bash
npm run test:library-availability
```

跨 Renderer/Main/Worker、协议、预览和真实媒体解码修改还必须运行对应 Electron E2E，后台执行并隔离 userData。

### 17.2 性能基线

使用仓库 20,000 资产基线，并增加 1k、100k 与混合媒体场景。每次记录：

- 冷/热开库到 summary-ready、browse-ready、ready。
- 文件夹/合集/过滤/搜索首屏 p50/p95/max。
- Worker `ipcQueueMs/executeMs` 和 event-loop lag。
- 可见缩略图首张、全部首屏和 cache hit。
- 查看器 placeholder、首帧、高清升级和取消。
- 后台任务吞吐、队列深度、峰值内存与子进程数。
- 外部库预览归一化的原样复制字节、归一化耗时/吞吐、输出字节、峰值内存和可见窗口解码
  尾延迟；合成基准不能替代真实 Eagle/Billfish、Windows 与 NAS/SMB 证据。
- 本地 SSD、Windows/macOS、SMB/NAS 分开记录，不能互相替代证据。

### 17.3 人工验收

- 打开大库后立刻滚动、搜索、切换文件夹并双击图片/PDF/视频。
- 后台缩略图、元数据、色卡或 AI 运行时重复上述操作。
- 快速切换资源库和快速打开/退出查看器。
- 调整侧栏与卡片尺寸，确认锚点、选择和阅读顺序稳定。
- 网络盘断开/恢复时确认界面状态清楚、已有缓存仍可浏览、写入受控。

## 18. 禁止采用的修复

- 只增加 IPC、library.open 或查看器超时。
- 用 loading 动画、延长模糊层或隐藏失败提示掩盖排队。
- 在同步扫描内部偶尔 `Promise.resolve()`，却仍把文件 I/O 放在长事务中。
- 无限提高缩略图并发或按逻辑核心数启动同数量外部解码器。
- 为减少查询把完整资源库元数据常驻 Renderer。
- 缓存绝对路径却没有 generation/revision 失效。
- 将缩略图成功视为原图查看成功。
- 将低清 RAW 内嵌图、PDF 首页或视频 poster 当作真实源内容。
- 删除测试或放宽断言来消除真实性能/生命周期失败。

## 19. 完成定义

本规格只有在以下条件同时满足时才能标记完成：

1. 请求所有权、lane、generation、取消和计时贯穿 Renderer/Main/Worker。
2. 打开、浏览、查看器和后台维护使用明确的渐进状态，不互相作为门禁。
3. 浏览会话、摘要缓存和 artifact key 具有可证明的失效规则。
4. 20k 性能基线达到项目目标；100k、Windows/macOS、网络盘结果有独立记录。
5. Library Availability、相关 Worker/单元/E2E 全绿。
6. 人工验证确认首屏、查看器、滚动锚点和后台负载体验没有回归。
7. 开发日志按需求、实现、自动化和人工/平台证据四列记录，不以“代码存在”替代验收。
