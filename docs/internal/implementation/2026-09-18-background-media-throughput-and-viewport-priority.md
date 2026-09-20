# 后台媒体吞吐、视口优先级与前台资源隔离

> 日期：2026-09-18。
> 状态：当前实例 profile 后的算法设计；未实施、未验收。
> 上位计划：`Serpent-e9a66b`（交互性能第二阶段）与 `Serpent-3kfe`（核心性能）。
> 关联设计：[文件夹切换与资源加载性能优化方向](2026-09-14-folder-switch-and-resource-loading-optimization.md)。

> 2026-09-20 补充：当前实例证明在讨论提高吞吐或并发之前，必须先修复模型离屏渲染与 AI 队列的取消/活性闭环；否则一个永久 pending 任务会让整个后台队列零进展。详见 [当前实例模型、AI 与 Worker 调度活性分析](2026-09-20-current-instance-model-ai-scheduler-profile.md)。本文的视口优先级、10 秒静默窗和有界并发设计继续有效，但实施顺序后移到 P0 活性门禁之后。

## 1. 结论

当前后台任务不能只靠“增加线程数”提速。正确方向是同时完成四件事：

1. 将平坦持久任务队列改为**需求驱动、有界展开的派生任务 DAG**，不为大型资源库一次性物化所有下游任务。
2. 将媒体调度改为**视口感知、可降级、有限抢占**：查看器/当前可见区最高，滚动方向上的邻近区次之，当前范围其余项再次之，全库回填最低。
3. 普通后台任务必须在最后一次真实交互后**至少安静 10 秒**才开始恢复，并逐级升档；不是 0.5–2 秒。
4. 解码可并行，SQLite 与 artifact 最终发布仍由唯一 Library Worker 协调。先使用现有 Sharp 原生线程和 FFmpeg 子进程的有界并发；只有 profile 证明 Worker 的 JS/GC/原生内存隔离仍是瓶颈时，才进入独立媒体执行器进程池。

并发升档前必须先控制 Renderer 内存增长和逐资产完成事件。当前实例中 Renderer 私有内存随后台缩略图完成从约 8.1 GiB 增至约 10.8 GiB；若直接提高解码吞吐，会更快放大前台 GC、图片缓存和 IPC 压力。

## 2. 当前 profile 证据

本轮只读观察未修改用户资源库；日志、数据库统计与进程采样均只记录脱敏聚合结果。

| 项目 | 当前样本 | 解释 |
| --- | ---: | --- |
| 混合缩略图完成 | 585 项/分钟，约 9.75 项/秒 | 普通图片阶段已有较高突发吞吐 |
| 视频 poster 尾部 | 约 228 项/120 秒，约 1.9 项/秒 | 当前剩余主任务的主要吞吐长尾 |
| 色卡既有基准 | 约 56.86 项/秒 | 64×64 上颜色聚类本体约 0.18 ms，不是主要热区 |
| Library Worker CPU | 20 秒内约 3.48 CPU 秒 | 约占单核 17.4%，整机远未跑满，存在有界并发空间 |
| Renderer 私有内存 | 约 8.1 → 10.8 GiB | 与数千个缩略图完成事件强相关，具体保留点仍需 heap profile |
| 当前 FFmpeg poster 并发 | 1 个进程、每进程 1 编码/过滤线程 | 机器核心数不会自动转化为 poster 吞吐 |
| 当前交互静默窗 | 2 秒 | 低于用户确认的安全边界，应改为至少 10 秒 |

任务总数看似不下降还包含一个统计现象：主缩略图完成后会立即新增一个 `extract_palette`，因此“完成一个、又新增一个”会让聚合 queued 长时间近似不变。任务面板应分开显示主预览与派生分析，并显示各阶段吞吐和预计剩余时间。

## 3. 现有视口调度的有效部分与缺口

现有实现已经具备正确基础：

- Renderer 每 50 ms 合并一次视口变化，只上报与真实 viewport 相交的卡片。
- Worker 给可见波固定高优先级，并把下一次 claim scope 收窄到最新可见 ID。
- 新旧视口重叠低于 50% 时，可把视口外正在运行的 primary job 重新排队并 cooperative abort。
- queued job 不再因滚动而 cancel→重建，避免 Windows journal/fsync 写循环。
- Sharp 已有 background=2、interactive=4 且全局 native cap=4 的保留槽位。

但它仍只有“可见/不可见”两个层级：

1. Renderer 的协议只传一个 `assetIds` 集合，没有上方/下方邻近区、滚动方向、距离、consumer 或 viewport generation。
2. 可见 ID 在 Renderer 归一化时被排序，失去屏幕从上到下和滚动方向上的顺序；Worker 注释声称顺序有意义，但当前协议没有保留该语义。
3. 离开视口的 job 只能靠下一轮 exact scope 不再领取；没有显式降级快照，也没有当前范围内的近邻预取层。
4. 低重叠即中断所有视口外 running primary，会在快速滚动时浪费短任务；已有 Sharp 交互保留槽时，很多取消并非必要。
5. FFmpeg/OIIO 各只有一个全局槽，没有前台保留槽；可见视频 poster 与全库回填只能通过中断争用同一槽。

## 4. 视口感知的优先级模型

### 4.1 不把滚动变成数据库写风暴

`jobs.priority` 继续表示任务的**持久基础优先级**，不能在每次滚动时批量 `UPDATE jobs`。动态优先级保存在 Worker 内存中的 `ViewportPrioritySnapshot`：

```text
ViewportPrioritySnapshot
  libraryId
  consumerId                # 窗口/浏览表面，不是库级单键
  libraryGeneration
  interactionGeneration
  viewportGeneration
  direction = up | down | stationary | jump
  focused[]                 # 查看器、明确 hover、用户重试
  visible[]                 # 与 viewport 真正相交，保留视觉顺序
  nearForward[]             # 滚动方向前方，默认 1.5 个 viewport
  nearBackward[]            # 反方向，默认 0.5 个 viewport
  scopeWarm[]               # 当前页/当前范围的剩余有界候选
```

新快照以 `(consumerId, viewportGeneration)` 原子替换旧快照。旧 generation 的迟到报告直接丢弃。资产离开某个 band 后立刻从内存 overlay 降级，但持久 job 不取消、不重建、不写库。

claim 采用两段式：

1. 先按 `focused → visible → nearForward → nearBackward → scopeWarm` 的明确 ID 顺序，做有界 `asset_id IN (...)` claim；顺序由内存 rank 决定。
2. 所有前台 band 没有可运行 job 时，才回到持久队列按基础优先级、创建时间和公平性领取。

这样改变视图只替换一个数百 ID 的内存快照，不会对数千 queued 行改优先级或触发 fsync。

### 4.2 优先级层级

优先级用严格 lane 表达，而不是允许 aging 穿透所有层级的单一大整数：

| Lane | 典型任务 | 是否可抢占低层 |
| --- | --- | --- |
| P0 intent | 查看器当前资产、明确播放 fallback、用户手动重试 | 是 |
| P1 visible | 当前视口 primary thumbnail/poster、必要尺寸探针 | 是，受抢占预算约束 |
| P2 lookahead | 滚动方向前方近邻，其次反方向近邻 | 不抢占 P0/P1；可在 claim 边界先于普通后台 |
| P3 scope warm | 当前文件夹/合集已加载范围的其余主预览 | 否 |
| P4 maintenance | 全库回填、色卡、metadata、对账修复 | 否 |

同一 lane 内使用：视觉距离、滚动方向、用户意图、等待时间和 consumer 公平性排序。aging 只在本 lane 内增加，不能让全库色卡越过当前视口。

派生优先级不自动继承到同一资产的全部下游任务：当前可见资产的 primary preview 完成后，palette 仍回到 P4；只有 Inspector 当前资产、按颜色排序/过滤所需范围才把 palette 提升到 P0/P1。Proxy 只有真实播放失败或明确查看意图才进入 P0，不能因资产可见就自动转码。

### 4.3 邻近区算法

Renderer 已掌握虚拟布局的 slot 几何，应从布局模型计算 band，而不是通过挂载 DOM 猜测：

- `visible`：与 viewport 相交。
- `nearForward`：沿最近滚动方向 1.5 个 viewport，最多 100 项。
- `nearBackward`：反方向 0.5 个 viewport，最多 50 项。
- 快速滚动时可以把 forward 扩到最多 3 个 viewport，但总 ID 数保持硬上限；停止后回落。
- `jump`（滚动条跳转、文件夹切换、搜索结果替换）立即丢弃旧 near bands，只保留新 destination。
- Lookahead 只生成主预览，不向 Renderer 挂 URL，也不触发图片解码/卡片 state patch，因此不能扩大 Renderer 内存。

初始距离只是调参起点，最终以滚动命中率、浪费率、前台解码 p95 和磁盘队列验证。不得为了提高预取命中率再次把整个 browse page 当成 visible。

### 4.4 有限抢占，避免取消抖动

优先级更新立即影响**下一次 claim**；中止已经运行的 native job 是更昂贵的第二层手段：

1. 新 viewport 先应用 overlay，若存在空闲的前台保留槽，不取消任何旧任务。
2. 只有 P0/P1 已等待、所需 decoder 没有保留槽、且目标 viewport 稳定约 100–150 ms，才中止最低层 running job。
3. P2 lookahead 永不触发 running job 中止。
4. 每个 decoder 设置抢占冷却和浪费预算；建议起点为同一 decoder 最多每 500 ms 一次，同一 job 连续被抢占两次后获得一次完成保护，防止永远重头解码。
5. job 进入最终 artifact 原子发布/数据库提交阶段后不可抢占；迟到产物按 revision/generation fence 决定保留或丢弃。

解码器策略：

- Sharp：沿用全局 4 槽、后台最多 2 槽。通常直接使用空闲的两个交互槽，不再因每次低重叠视口变化中止所有后台图片。
- FFmpeg：把全局 native cap 由 1 提升到 2 做 A/B。前台 epoch 内后台最多占 1 槽，另 1 槽为 visible/viewer 保留；安静满 10 秒后后台才可借用第二槽。只有两个槽都被旧后台占用且 P0/P1 等待时才中止其中一个。
- OIIO：初始仍保持 1 槽；只有真实内存 profile 证明安全才扩。P0/P1 可在稳定窗口后抢占 P4，P2 不抢占。

多窗口同时浏览同一库时，以 consumer 为单位轮转 P1/P2，不能把窗口 A 的 viewport 替换窗口 B；P0 查看器可短时借用，但需要最大连续额度。

## 5. 十秒静默门闩与动态资源 governor

“交互活动”包括导航、滚动/缩放、搜索输入、查看器打开/切换/拖动、显式媒体播放和文件操作；单纯 mousemove 不重置门闩。每次有效交互刷新 foreground epoch：

| 距最后一次有效交互 | 普通后台策略 |
| --- | --- |
| 0–10 秒 | 不启动新的 P3/P4 claim；只运行 P0/P1，P2 仅填充空闲保留槽；已运行后台在不阻塞前台时允许收尾 |
| 10–15 秒 | 恢复一级：Sharp 后台 1、FFmpeg 后台 1、OIIO 0–1 |
| 15–30 秒 | 指标安全时升二级：Sharp 后台 2–3、FFmpeg 后台 2、OIIO 1 |
| 30 秒以上/窗口隐藏 | 指标持续安全才达到平台上限；仍保留 Main/Renderer/系统预算 |

升档每次只增加一个 token，降档立即停止新 claim。任一条件触发降档：

- 文件夹/合集首屏或可见图解码 p95 超预算；
- Renderer 私有内存超过会话基线或持续快速增长；
- 可用内存低于安全水位；
- 系统 CPU、磁盘延迟或 Worker event-loop lag 连续超预算；
- 新 foreground epoch 到达。

不默认硬绑 CPU affinity。Windows/macOS 和大小核拓扑差异大；优先使用低后台进程优先级、并发 token、交互保留槽和动态反馈。概念上至少为 Renderer/Main/系统保留 4 个物理核心，但通过上限实现。平台特定 EcoQoS/低优先级可作为后续增强，必须单独 A/B。

## 6. 派生任务 DAG 与有界前沿

平坦队列目前会在 primary 完成后逐项持久化 palette，使总 queued 看起来不下降，也让大型资源库产生数万行下游任务和大量小事务。改为按 revision 构建逻辑 DAG：

```text
source/revision
  ├─ primary thumbnail 或 video poster
  │    └─ palette（可选、低优先级；Inspector/颜色查询可提升）
  ├─ extracted metadata（按格式/Inspector需要）
  ├─ contact sheet（AI/明确用途才需要）
  └─ playback proxy（源播放真实失败后才需要）
```

库中只物化一个有界 runnable frontier：建议 primary 128–500、palette 64、视频 2、OIIO 1；窗口由 profile 校准。未进入 frontier 的工作由 current revision、artifact policy、失效游标和需求标记推导，不需要提前创建 8 万条 job。崩溃恢复仍以持久 job 和 artifact 真相为准；cursor/exhaustion 必须可失效，不能漏掉最终收敛。

claim 前再次检查 revision、ready artifact、ignore、missing、generator/settings；已有合法结果直接收敛。快速任务的领取、成功状态和 artifact 元数据按小批次事务提交，避免每个 palette 一次完整事务。长 FFmpeg job 仍独立 lease，不把几十个视频锁在一个长事务里。

## 7. 各算法路径的优化空间

### 7.1 视频封面（当前第一吞吐长尾）

当前 poster 从文件起点解码并对前 30 帧使用 `thumbnail` 过滤器，输出 640px JPEG。候选算法必须做同库、同视频集合的速度与视觉双重 A/B：

1. 复用 current revision 的 ffprobe 结果，不为 poster/contact sheet/proxy 重复 probe。
2. 有时长时优先做 input fast seek：短视频从开头；长视频从 `clamp(duration×10%, 1s, 10s)` 附近开始，解 8–12 帧选代表帧。
3. 对近黑、单色或低信息量候选做一次有界二次 seek（例如 30%）；最多两次，不能遍历整条视频。
4. 与现行 `thumbnail=30`、关键帧 fast path比较：记录总解码帧数、spawn→产物时间、失败率和人工视觉可接受率。
5. 评估将 poster 长边从 640 收敛到卡片契约 512；若 hover/查看器依赖 640，则保留用途差异而不是全局降质。
6. 后台运行两个单线程 FFmpeg 进程，而不是让单进程吃多个线程；前台 epoch 保留一个槽。

### 7.2 Proxy

Proxy 继续坚持 source-first、失败后按需生成，不进入全库 backfill。算法方向：

- 开库时清理旧版本遗留的无显式 fallback intent 的 queued proxy。
- ffprobe 与编码器能力结果按 FFmpeg binary/revision 复用；现有“一帧能力测试后缓存”保留。
- 源音轨已经是目标容器支持的 AAC/Opus 时评估 stream copy，避免无意义音频重编码；不兼容时再转码。
- 硬件编码和软件编码分别设资源预算；硬件编码不能因 CPU 低就无限并发占满显存/媒体引擎。
- 当一次明确 proxy 任务开始时 poster 仍缺失，可评估同一 FFmpeg 输入的双输出（完整 proxy + 一帧 poster），避免再次打开和解码源；poster 已存在时不增加额外输出。
- Viewer 关心 time-to-first-playable，后台关心总吞吐，两者分开计时；不得用主动全库转码换取偶发查看器命中。

### 7.3 色卡

颜色聚类本体不再作为优化重点。优先级依次为：

1. 只从 ready thumbnail/poster 或 source-direct 快速缩小路径读取；不为色卡重新做完整视频/RAW解码。
2. 当前视口 primary 先完成，palette 默认 P4；Inspector 当前资产或颜色排序/过滤需要的范围才提升。
3. candidate 查询、job claim、artifact INSERT 和状态完成按 32–64 项批量事务；计算仍受 Sharp native gate 控制。
4. A/B 比较“每个 palette 一个 JSON 小文件”与“小型派生 metadata payload 存数据库”的本地盘/SMB 成本。后者能消除 write+stat 和 artifact 目录膨胀，但会增加数据库写量，未实测前不能直接迁移。
5. source-direct 大图仍慢时，再评估 primary decode 的 64×64 分支复用；只有证明节省显著且不破坏 artifact 独立失效/重试，才合并生命周期。既有实测中从 ready thumbnail 解码约 3.22 ms，盲目耦合收益有限。

### 7.4 Renderer 完成事件

Worker 目前为每个 thumbnail 单独发送 ready 事件，Renderer 即使不在当前视口也会处理布局/资产 patch。改为：

- P0/P1 资产即时逐项或小批送达；P2/P3/P4 只发按 50–100 ms 合并的 ID 批次和聚合计数。
- 非当前 browse scope 的完成事件不进入卡片状态 Map；数据库与下一次 browse 是真相源。
- Folder cover、选中 Inspector、当前 viewer 作为显式订阅，不靠全库广播。
- `serpent://` 资源、解码图片和任何 object URL 设置有界 LRU/释放契约；用 heap snapshot 确认真实保留者后再改缓存大小。

这是提高后台吞吐的前置条件，否则更快的后台只会更快制造 Renderer 内存和 IPC 压力。

## 8. 多线程、多进程与核心预算

### 8.1 第一阶段：不新建数据库 Worker

- Library Worker 保持唯一 SQLite owner和最终 artifact publisher。
- Sharp 使用现有原生线程/信号量；FFmpeg 使用两个独立的单线程子进程做 A/B；OIIO 保持一进程。
- 后台 helper 使用 below-normal/低 QoS，Main 与 Renderer 保持 normal。
- 不允许多个媒体进程直接写数据库；子进程只写 owner 分配的 staging 输出，owner 验证 revision 后原子发布。

### 8.2 条件式第二阶段：媒体执行器进程池

只有满足以下任一条件才实施独立媒体 UtilityProcess：Worker event-loop/GC 仍干扰 catalog 命令；Sharp native memory无法在同进程可靠归因/回收；单进程崩溃会扩大故障域。

进程池上限建议从“1 个交互执行器 + 2 个后台执行器”开始。执行器没有 SQLite、任意 SQL、目录扫描或 Renderer IPC，只接受 owner 发出的、经 schema 验证的一次性 job plan与 staging token。owner 验证输出、revision 和 generator 后提交。进程退出只使已领取 job 回到 queued，不得留下临时文件。

## 9. 验收矩阵

| 目标 | 自动化/Profile 证据 | 平台/人工证据 |
| --- | --- | --- |
| 视口优先级 | 当前 viewport、前后 band、jump、A→B→C、双窗口；断言旧 generation 不 claim，新 visible 在下个边界先于 backlog | 快速滚动无大片空白，反向滚动已预热 |
| 抢占无抖动 | 记录 preemption count、wasted ms、同 job 重启次数；queued 行不因滚动 cancel→重建 | Windows Defender 场景无 fsync 风暴 |
| 10 秒门闩 | 0–10 秒普通后台 claim=0；10 秒后逐级恢复；持续交互时前台仍可用 | 用户连续浏览、停顿、再次滚动 |
| 视频 poster | 同一视频集合对比当前算法、fast seek、双 FFmpeg；目标同机吞吐至少提高 70%，失败率不升 | 抽样检查黑帧、片头、旋转和短视频 |
| Proxy | 原生可播不生成；真实失败才生成；复用 probe/音轨 copy/双输出分别计时 | Windows/macOS 各类 codec 真机 |
| 色卡 | 保持既有输出等价；批量领取/提交与 payload 方案做本地/SMB A/B；不低于既有约 56.86/s 基线 | Inspector/颜色排序最终一致 |
| Renderer 内存 | 5,000 个非当前视口完成事件后内存达到稳定平台，不随总历史数线性增长 | 长时间浏览无明显 GC 卡顿 |
| 前台隔离 | 2,000/5,000/9,000 混合任务运行/暂停同 scope A/B；文件夹首屏约 500 ms、无 timeout | 本地、SMB、Windows 分列 |
| 后台公平 | 安静 10 秒后持续有进展；P4 不永久饥饿；阶段 ETA 可解释 | 8 万资产链接库长时间运行观察 |

profile 报告必须按任务种类分别输出：等待、claim SQL、native decode、artifact 写入、DB commit、IPC/Renderer apply；只报告“每分钟完成总数”无法区分 primary 完成后新增 palette 的阶段迁移。

## 10. 实施顺序与边界

1. 补齐进程级/任务种类 profile 与 Renderer heap 证据；同时实现完成事件批量观测，但不先提高并发。
2. 实现 consumer/generation/bands 协议和内存 priority overlay；先只改变 claim 顺序，不启用更多 decoder。
3. 将普通后台静默窗改为至少 10 秒，加入逐级 governor 与抢占预算。
4. A/B 视频 fast seek 与 FFmpeg 1→2；通过前台延迟、内存和视觉门禁后保留。
5. 将下游派生任务改为有界 DAG/frontier，并批量提交 palette；评估 tiny payload 存储。
6. 优化按需 Proxy；最后根据剩余 profile 决定是否建立媒体执行器进程池。

本设计不把“CPU 使用率更高”当作成功。成功定义是：当前视图先完成、切换视图后优先级立即迁移、前台延迟不因后台积压显著恶化，并且后台在用户静默后以可解释速度稳定收敛。

## 11. 工单分解

| 工单 | 范围 | 前置/说明 |
| --- | --- | --- |
| `Serpent-217028` | 将 profile 扩展到任务种类、native helper、artifact/DB/IPC/Renderer 分段和 Renderer heap | 观测基线；保持打开 |
| `Serpent-df0ec0` | 定位 Renderer 约 10 GiB 内存增长，批量化离屏完成事件并建立资源释放上界 | P0；提高后台吞吐前置 |
| `Serpent-926e2f` | consumer/generation/bands 协议、内存 priority overlay、有限抢占和多窗口公平 | 不用数据库 priority 写风暴实现 |
| `Serpent-7ac453` | 至少 10 秒 foreground gate、逐级并发 governor、低优先级/QoS和资源反馈 | 既有 PERF2 工单已按本文重写边界；依赖 `Serpent-217028`、`Serpent-926e2f` |
| `Serpent-cdf22c` | 视频 poster fast seek/视觉兜底/512评估与 FFmpeg 1→2 A/B | 依赖 `Serpent-df0ec0`、`Serpent-7ac453` |
| `Serpent-e73d04` | 有界派生 DAG/frontier、palette 批量提交、tiny payload A/B和阶段进度 | 依赖 `Serpent-df0ec0` |
| `Serpent-354c55` | 按需 Proxy 的 probe 复用、音轨直拷、硬/软编码预算和双输出 A/B | 依赖 `Serpent-7ac453`；正确性沿用 `Serpent-4e48be` |

独立媒体执行器进程池暂不另立实施单：它是 profile 触发的条件式第二阶段。若完成上述工单后 Worker event-loop/GC 或故障域仍是主要瓶颈，再从 `Serpent-217028` 的证据拆出，不提前把架构复杂度当成既定方案。
