# 渐进式加载全面分析（2026-08-14）

> 状态：定稿（四路代码走查完成：文件夹切换 / 搜索 / 封面 / 缩略图队列，均为只读分析）
> 触发：产品负责人反馈——超大型「绘画资源库」下切换文件夹慢、文件夹封面加载慢、
> 搜索一次性全量返回耗时长。要求：永远渐进式加载，先加载用户能看到和将要看到的内容。
> 原则文档：`docs/internal/ui/0006-progressive-loading-ux-principles.md`（LIB-018 / Serpent-tumv P0 epic）
> 对应工单：Serpent-v4jf（A1，P1）及本文件第五节列出的后续工单

## 一、已确认的核心事实（第一手代码证据）

### 1. 切换文件夹 = 一次性全量拉取最多 50,000 条资产

- renderer `chooseFolder` → `setUiState("loading")`（App.tsx:3283）→ `loadContent`（App.tsx:2556）。
- `loadContent` 并行发起 **9 个 IPC**：listFolders + searchAssets(scopeMode) + 全库计数(limit:1) +
  回收站计数(limit:1) + listLinkedFolders + listTags + listCollections + listSmartCollections
  (+listTrashedFolders)，**全部完成后才 `setAssets`/`setFolders`**（App.tsx:2635-2644）。
- `searchAssets` 带 `BROWSE_SCOPE_SEARCH = { scopeMode: true }`（browse-scope-search.ts:4-6），
  worker 侧 `limit = BROWSE_SCOPE_MAX_ASSETS = 50_000`（shared/browse-scope.ts:6、
  library-service.ts:20539）。一次查询 + 全量 AssetSummary 构建 + IPC 传输 + renderer 原子替换。
- 超 50k 的部分用户永远看不到（scopeMode 截断）。
- 历史背景：REQ-BROWSE-001（Serpent-6w7n）为支持「范围总数量 + 全选全部」取消了列表分页
  （backlog 619 行），backlog 明确注明「缩略图/重元数据等对未显示项按需懒加载（虚拟列表 +
  按需 IPC）」为后续 epic——本次分析正是补上这一半。

### 2. 隐藏大头：Main 转发结果前同步等待 drag 缓存预热

- `asset.search.result` 到达 Main 后、**转发给 renderer 之前** `await primeNativeAssetDragCache`
  （main/index.ts:3547），对 ≤50k 条 assetId 再发 `media.get-asset-drag-infos`（main/index.ts:1525）。
- worker 端逐 asset 顺序 for 循环（worker/index.ts:2452-2488）：`resolveAssetPath`（1-2 次查询）+
  `getThumbnailArtifact`（2 次）+ `getArtifactAbsolutePath`（视情况再 1 次）≈ **50k × 3~4 次
  点查询 = 15-20 万次 DB 查询**，全部在 worker 单线程事件循环上顺序执行，期间阻塞所有其他
  worker 消息（缩略图事件、进度事件、后续请求）。
- 结果本来就绪之后仍要等完这段才转发 → 用户感知的"切换文件夹慢"很大一部分来自这里。

### 3. 搜索 = 同样的 scopeMode 全量

- 搜索框防抖 200ms → `runSearch` → `executeSearchDefinition`（App.tsx:4794-4818）同样带
  `...BROWSE_SCOPE_SEARCH`（scopeMode: true）→ 最多 50,000 条一次性返回。
- worker `searchAssets`（library-service.ts:20508）：FTS5 trigram 候选 + `instr` 精确过滤 +
  relevance 全量排序（逐行 CASE 表达式，无索引，O(n log n)）+ `SELECT COUNT(*)` 全量计数 +
  数据查询 LIMIT/OFFSET（scopeMode 时 50k）。
- 单条 postMessage 带最多 50k 个 AssetSummary（~25 字段，含 sequence）≈ 30-60MB，跨
  UtilityProcess→Main→Renderer 三段结构化克隆 + **3 次 Zod 校验**（worker 响应 main
  worker-client.ts:541、preload preload/index.ts:198、含 portableRelativePathSchema 逐路径正则）。
- **无部分结果渲染**：`applySearchResult` 原子整组替换 `setAssets`（App.tsx:4278）；无
  Suspense/skeleton/增量追加/IntersectionObserver 触底加载。搜索期间旧列表原样停留，
  结果到达后整组跳变。
- **无请求取消**：renderer 有 generation 丢弃旧结果（App.tsx:4796/4807），但 worker 侧旧查询
  不取消，连续输入会排队执行多个全量查询（worker 单线程全同步，一次查询占死事件循环，
  缩略图/AI/进度全部停摆）。
- **超时风险**：`asset.search` 与 `media.get-asset-drag-infos` 都不在长超时白名单
  （worker-client.ts:67-99），默认 REQUEST_TIMEOUT_MS = 15s（worker-client.ts:52）——大库慢
  搜索可能直接超时失败/空等 15s。
- **分页能力已就绪但未接线**：worker 支持 limit/offset/count-only（limit:0）；renderer 的
  `asset-browse-load-more.ts`（browseLoadMoreObserverRoot / resolveSearchTotalAfterAppend /
  countNewlyAddedAssets）是**全仓库无引用的死代码**；`searchOffset` 状态在（App.tsx:813/2664/4280）。

### 4. 查询质量：COUNT + 数据查询双重全量 JOIN 扫描

- `searchAssets` 先 `SELECT COUNT(*)`（:20893-20897）再数据查询（:20900），`baseFrom` 无条件
  带 4 个 LEFT JOIN（asset_metadata / duration_meta / palette_meta / technical_thumbnail，后者
  带每行 `LOWER(relative_file_path) LIKE '%.mp4…'` CASE，:20730-20744）——即使筛选/排序没用到。
- 数据查询又**单独**跑 `thumbnailArtifactMap`（`asset_id IN (50k 占位符)` + 3 LEFT JOIN + CASE，
  :20929、:20260-20339）与 `withImageSequenceSummaries`（再 2 个 50k 占位符 IN 查询，
  :20933、:11807-11843）——三遍冗余扫描。
- 默认 name 排序 `ORDER BY a.relative_file_path ASC, a.asset_id ASC`（:20593-20594）只有
  `managed_folder_id` 单值 + `assets_folder_path_idx`（library-service.ts:942）能免排；recursive
  时 `IN (WITH RECURSIVE…)`（:20800-20814）通常要临时 B-tree 全量排序。

### 5. 文件夹封面 = 素材从未被高优先级调度 + 无渐进刷新

- **不存在封面生成 job，coverArtifactIds 不落库**：`folder.browse-entries` 每次现算
  `folderCoverArtifactMap`（library-service.ts:11185-11237），JOIN assets→revision_artifacts，
  门禁 `status='ready'`，按文件名取每夹 ≤3 个。
- **主因**：封面素材（子文件夹直接资产）不在当前视图 visible 波内（`asset.list` 只调度当前
  文件夹直接资产，worker/index.ts:1203-1218），只能等 p50 整库后台填充按路径字母序生成；
  `folder.browse-entries` 不调度任何缩略图场景（worker/index.ts:1048-1057）→ 大库封面极晚。
- **无渐进刷新**：`asset.thumbnail.ready` 只 patch 资产列表（App.tsx:2892-2911），不重取
  folderBrowseEntries → 封面生成后卡片仍显示空文件夹图标，直到导航/树变化。
- FolderCard `<img loading="lazy">`（FolderCard.tsx:110-115），与资产缩略图共用
  serpent://preview 通道，renderer 无请求队列/优先级。

### 6. 缩略图与窗口化现状

- 缩略图队列已有场景优先级：startup=100 / refresh=150 / linked·restore=250 / mutation=300 /
  visible=350（worker/index.ts:552-563）；队列排空后 p50 整库按路径字母序后台填充
  （worker/index.ts:500-504）。
- 解码并发受限（workerMediaDecodeConcurrency，worker/index.ts:471；逻辑核−3 + 进程级
  sharp/ffmpeg/OIIO 三信号量 + 模型渲染单飞）。
- renderer 窗口化已实现：columnWindow/overscan（viewport-window.ts，overscan = max(1200px,
  视口×3, 卡片×8)）；**但布局计算是全量的**——MasonryColumns 每次 render 重算
  distributeMasonryItems + layoutMasonryAssetRects + 每列 columnWindow（heights.map +
  reduce 全量，masonry-columns.tsx:173-210；viewport-window.ts:110-113），滚动每帧触发
  O(N) 布局（50k 项每帧 10-50ms JS）。
- `Serpent-4mlf` 快速滑动退回默认图标仍未解决：`resolveAssetCardCoverUrl` 严格
  `status === 'ready'` 门（asset-card-hover-preview.ts:65-83）；**根因线索已明确**——
  `enqueueThumbnailJobs` 每次 browse 调度都跑"陈旧件失效"UPDATE，把一批 ready 缩略图置
  `invalidated_at`（GIF gifstill / 音频 cover / 视频 4:3 封面，library-service.ts:19501-19615）
  → 下次 searchAssets 返回 thumbnailStatus=null → 默认图标，直到再生成 + ready 事件补丁。
  2026-08-14 的「保留 ready + eager」方案已被撤回（开发日志 2026-08-13 linked-folder-jank
  103-105 行），当前无 sticky thumbnail。验证步骤：在含 GIF/音频/视频的库中 browse 后观察
  失效 UPDATE 是否把 ready 缩略图批量打回默认图标。
- `Serpent-1s3d` 截断白区仍未解决：scroll→rAF→setState→commit 滞后 + 旧窗口 spacerAfter 露白
  （开发日志 :113 已确认）；overscan 只放大"可容忍滞后距离"不消除滞后；全量 scope 浏览 +
  每次 setAssets 全量 O(n) 布局重算（canvas-asset-layout.ts:86-117）压缩帧预算放大滞后；
  E2E 瞬时 scrollTo 与真实 momentum 滚动不一致导致自动化绿、人工失败。
- serpent://preview 每次请求：Main `protocol.handle("serpent")`（main/index.ts:5690-5901）→
  `media.get-artifact-path`（worker/index.ts:2344-2351）→ `getArtifactAbsolutePath`
  （library-service.ts:18967-19035）：1 次 SQL + 2 次 lstat + 2 次 realpath 同步磁盘 IO，
  **无缓存**（响应带 immutable HTTP 头，浏览器层可缓存，但路径解析每次都查库）。

## 二、渐进式优化候选清单（按收益/风险排序）

### A. 浏览/切换文件夹
1. **A1 ★ drag 缓存预热移出响应路径**（几乎纯赚）：`primeNativeAssetDragCache`（main/index.ts:3547）
   不 await、fire-and-forget 或只预热可见窗口前几十条；`media.get-asset-drag-infos` 改批量 SQL
   （`asset_id IN (...)` 分批 500-1000）而非逐 asset 3-4 次点查询。收益：切文件夹端到端延迟
   直接砍掉 15-20 万次 DB 查询；零产品行为变化。
2. **A2 ★ Worker 侧分页/游标化浏览查询**（最大结构性收益）：scopeMode 不再一次取 50k，按页
   （200-500）+ 稳定 keyset 游标（`(relative_file_path, asset_id)` 复合键），renderer 接线
   `asset-browse-load-more.ts` 死代码，IntersectionObserver 触底追加。顺带修复超 50k 看不到。
   风险：worker 命令语义 + preload API + renderer 状态管理（追加/去重/选择语义）需逐调用点核对。
3. **A3 首屏只取可见窗口 + 轻量行**：首屏 `limit = 可见卡片数×overscan（如 200）`，后台补拉；
   或 worker 返回轻量行（assetId/thumbnailStatus/thumbnailArtifactId/width/height 等布局必需
   字段），细节字段（rating/favorite/byteSize/sequence…）按需补。需新增轻量 DTO + 协议类型，
   Inspector/选择/拖拽消费方适配。
4. **A4 9 个并行 IPC 拆分「首屏必需」+「后台补充」**：资产列表先到先渲染；文件夹树/标签/合集/
   计数后台到达后增量更新（setFolders/setTags 本就独立 state，不再 Promise.all 阻塞）。
5. **A5 消除 COUNT + 数据查询双重 JOIN 扫描**：baseFrom 按需拼接（无 filter/sort 依赖时去掉
   duration_meta/palette_meta/technical_thumbnail JOIN）；COUNT 用轻子查询；thumbnailArtifactMap
   与主查询合并复用。纯 worker 端改动，需回归全部筛选/排序组合。
6. **A6 文件夹树增量更新**：listManagedFolders 不再每次全量重算（O(F²) 递归计数
   library-service.ts:10999-11031 改 SQL 递归 CTE）；只在变更事件时重拉。
7. **A7 布局计算 memo 化**：MasonryColumns/JustifiedAssetRows 的 distribute/layout 用 useMemo
   依赖 [assets, availableWidth, cardSize, showCaption]，viewport 变化不再触发全量重算。
8. **A8 快速连续切换去抖/取消**：300ms 内连续 chooseFolder 去抖；worker 端跳过被取代的排队请求。

### B. 搜索
9. **B1 分页 + 增量渲染**：搜索结果分页（200/页），首屏先渲染，滚动追加；结果计数与列表分离
   （count-only 已存在 limit:0）。
10. **B2 搜索取消**：worker 队列层按 libraryId 丢弃旧 asset.search（requestId 机制已具备）。
11. **B3 超时白名单**：asset.search 归入长超时档或改可取消。
12. **B4 relevance 排序走 FTS5 bm25()**（可选，需实测排序 vs 传输占比）。

### C. 封面
13. **C1 ★ 封面场景优先级**：folder.browse-entries 把各子文件夹封面候选资产（≤3/夹）以新场景
    `cover`（priority 400 > visible 350）入队——大库首屏封面先于资产缩略图生成。
14. **C2 封面渐进刷新**：thumbnail.ready 命中封面候选时局部更新 folderBrowseEntries。
15. **C3 首屏封面 eager**：FolderCard 首屏 loading="lazy" → eager（对齐资产卡片行为）。

### D. 通用
16. **D1 serpent:// 路径解析缓存**：getArtifactAbsolutePath 按 (libraryId, artifactId) 缓存，
    以 changeSequence 失效——消除每图 1 SQL + 4 磁盘调用。
17. **D2 browse-entries 派生结果缓存**：封面/递归计数以 changeSequence 为失效键缓存。

### E. 缩略图/滚动（缩略图队列 subagent 补充）
18. **E1 可见窗口优先解码**：新增 renderer→worker 可见 ids IPC，复用 azf6 boost SQL
    （`SET priority = MAX(priority, ?)`）——滚动时当前窗口资产优先入队，不再只靠查询结果
    前 100 项的 visible 波（worker/index.ts:552-575、1496-1502）。
19. **E2 填充波按窗口游标附近优先**：p50 整库按路径字母序填充改为按当前浏览窗口游标附近优先。
20. **E3 动态 overscan + 方向感知**：按滚动速度 × commit 延迟自适应 overscan，替代固定
    max(1200px, 视口×3, 卡片×8)；方向感知（只向滚动方向加跑量）。
21. **E4 last-known-good 缩略图保留**：恢复「保留 ready 缩略图 + img 复用 + onError 兜底」
    （勿做全量 eager——2026-08-14 方案已撤回）；配合修复 4mlf 的失效 UPDATE 行为。
22. **E5 布局记忆化**：卡片 memo / distribute-layout useMemo（同 A7），降 commit 延迟。

## 三、已实现 vs 未实现

**已实现（不要重复做）**：
- renderer 侧窗口化渲染（columnWindow/overscan，纯 renderer 裁剪，worker 不分页）。
- 响应取消（contentLoadGenerationRef 丢弃过期 loadContent，App.tsx:2576-2611）。
- 序列帧隐藏（查询层排除 position > 0，searchAssets :20772-20779）。
- 文件夹计数/封面批量化（managedFolderCountMaps/folderCoverArtifactMap 单查询聚合，非 N+1）。
- 缩略图队列多级优先级 + visible 波（350）+ p50 后台填充 + 解码并发受限。
- 渐进式原则文档 0006（§2 点名资产列表/文件夹树，但实现没跟上）。

**未实现（核心缺口）**：
- worker 侧分页/游标：没有——scopeMode 一次取满 50k；load-more 死代码未接线，超 50k 看不到。
- 首屏只取可见窗口：没有——等 9 个 IPC + 50k 数据 + drag 缓存预热完成后才 setAssets。
- drag 预热在响应路径同步 await：没有优化（最容易被忽略的隐藏大头）。
- AssetSummary 精简：没有——全字段 3 进程 3 次 Zod 校验。
- 文件夹树增量：没有——每次 loadContent 全量重建 + O(F²) 计数。
- 浏览查询 JOIN/COUNT 复用：没有——两遍全量扫描 + 三遍冗余 IN 查询。
- 布局 memo：没有——滚动每帧 O(N) 全量重算。
- 封面优先级/渐进刷新/eager：没有。
- serpent:// 路径解析缓存：没有。
- 可见窗口优先解码（renderer 上报可见 ids + 复用 azf6 boost SQL）：没有。
- 4mlf 的 last-ready 缩略图保留：没有。

## 四、与既有工单/需求的关系

- LIB-018（Serpent-tumv，P0 epic）「禁止同步加载：打开资源库约1秒可交互并全面渐进占位」——
  本分析是其在浏览/搜索/封面路径的具体展开，新工单挂 tumv 之下（dep 关系）。
- REQ-BROWSE-001（Serpent-6w7n，已验收）「范围总数量 + 全选全部」——渐进式分页必须兼容
  全选全部语义。
- Serpent-1s3d（瀑布流截断白区）、Serpent-4mlf（快速滑动退回默认图标）——窗口化相关未决项，
  本分析给出根因线索（overscan 不消除滞后 + 布局全量重算；enqueueThumbnailJobs 批量失效
  ready 缩略图，含 GIF gifstill/音频 cover/视频 4:3 封面）。4mlf 修复方向见 E4；1s3d 见 E3/E5。

## 五、工单清单（bd）

| 工单 | 标题 | 优先级 | 对应候选 |
|---|---|---|---|
| Serpent-v4jf | 渐进式加载：drag 缓存预热移出浏览响应路径（A1） | P1 | A1 |
| （待开） | 渐进式加载：浏览/搜索游标分页 + renderer 增量渲染（A2/B1） | P1 | A2/B1 |
| （待开） | 渐进式加载：查询质量——按需 JOIN、COUNT 轻量化、消除冗余 IN 扫描（A5） | P2 | A5 |
| （待开） | 渐进式加载：文件夹封面生成优先级 + 渐进刷新（C1/C2） | P1 | C1/C2 |
| （待开） | 渐进式加载：搜索结果请求取消 + 超时档位（B2/B3） | P2 | B2/B3 |
| （待开） | 渐进式加载：serpent:// 路径解析缓存（D1） | P2 | D1 |

## 六、优先级建议

A1（drag 预热移出路径，小改动纯赚）→ A2/B1（游标分页 + 接线 load-more，根治切换/搜索慢）→
C1/C2（封面优先级 + 渐进刷新，直接命中用户症状）→ A5（JOIN 按需化，纯 worker）→
B2/B3（搜索取消 + 超时）→ D1（路径解析缓存）；A3/A4/A6/A7/A8、C3、D2、E1-E5 按需跟进。
4mlf/1s3d 的根因验证与修复建议单独处理（复用既有工单 Serpent-4mlf / Serpent-1s3d；
修复方向见 E4 / E3+E5）。
