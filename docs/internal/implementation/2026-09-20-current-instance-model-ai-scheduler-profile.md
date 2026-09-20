# 当前实例模型、AI 与 Worker 调度活性分析

> 日期：2026-09-20
> 状态：P0 活性与取消增量已实现；合成 20K 基线通过，真实实例与病态 loader 尚未验收
> 范围：暂停 AI 后仍然卡顿、缩略图不再推进、FBX 查看缓慢、大型链接目录导入阻塞
> 隐私：本文只保留聚合指标、匿名阶段和仓库相对路径，不记录真实库名、文件名、本机路径或请求标识。

## 1. 执行结论

当前实例不是“机器核心不够”或“AI 仍在正常计算”。数据库里的 AI 任务确实已经取消，但其中一个模型任务的执行链没有结束：普通模型缩略图先卡在离屏页面的 HDRI 加载；随后模型 AI 四视图等待同一条进程级串行 gate；AI 取消信号又在 Worker 内被新的 `AbortController` 截断。Main 离屏队列没有逐请求取消和阶段 watchdog，最终形成：

```text
可选 HDRI 永久 pending
  → 模型 render gate 不释放
  → 已 cancelled 的 AI 协程仍在 await
  → ai.process-queue 持有 background-secondary admission
  → source/artifact 查询、缩略图队列和同步轮询排队
  → 图片不再生成，FBX 查看拿不到源/产物，前台看起来整体卡死
```

20 秒进程采样中 CPU 接近空闲，与“异步等待时持有全局许可”完全一致。暂停 AI 只改变了持久任务状态，没有终止正在运行的协程，也没有释放 scheduler owner。因此用户观察到“AI 已暂停但仍慢”不是反例，正是当前取消语义失效的直接证据。

修复顺序必须是：

1. 先恢复模型链路与 AI 队列的**活性和取消闭环**。
2. 再把前台源/产物解析从长外部等待中隔离，并合并陈旧轮询。
3. 把大型链接目录发现移出独占 mutation。
4. 单独优化 FBX 冷转换的进程隔离、内存峰值和隐藏预加载。
5. 最后才讨论提高媒体并发；不能给会永久占位的路径增加更多线程。

## 2. 本轮证据

### 2.1 运行资源与队列

| 观测 | 当前样本 | 含义 |
| --- | ---: | --- |
| 主 Renderer 私有内存 | 约 5.0 GiB | 偏高；需要 heap/分配 profile，不能仅凭工作集归因 |
| Library Worker 私有内存 | 约 2.0 GiB | 模型/媒体转换和积压 promise 是候选，需要分阶段证明 |
| 离屏 Renderer 私有内存 | 约 70 MiB | 在模型缩略图请求出现时创建，并停在 HDRI 阶段 |
| 20 秒 CPU 增量 | Main、Worker、Renderer 均接近空闲 | 当前主瓶颈不是 CPU 饱和 |
| scheduler 排队请求 | 峰值超过 380 项 | 长 owner 期间轮询与路径请求持续堆积 |
| 缩略图任务 | 约 4,350 queued | 20 秒两次快照完全相同，当前没有有限进展 |
| 图片 AI 任务 | 数千项 cancelled | 用户暂停操作已经写入持久状态 |
| 最新模型 AI 任务 | 创建后约 2.3 秒即 cancelled | 但对应队列 owner 此后仍持续十余分钟 |

### 2.2 两个独立的长 owner

1. `asset.import.prepare` 作为 mutation owner 连续占用约 728 秒；`folder.list` 与 `browse.session.open` 最大排队约 725 秒。代码路径在 mutation 内递归执行同步目录读取、逐文件 `lstat` 和排序。
2. 随后的 `ai.process-queue` 作为 background-secondary owner 连续占用超过 754 秒；`media.get-source-path`、`media.get-artifact-paths` 等请求等待数百秒，且 owner 仍在增长。

它们是两个不同阶段、不同根因的事故：前者是文件发现与 mutation 作用域过大；后者是外部异步等待、取消传播和离屏 renderer 活性失效。不能只改 scheduler 优先级来同时掩盖两者。

### 2.3 模型离屏阶段

- 离屏窗口已创建，页面进入 `offscreen-thumbnail.stage.hdri-loading`。
- 此后没有 `hdri-ready`，也没有进入 `model-loading`。
- 页面源码已明确知道自定义协议 HDRI 可能永久 pending，但生产路径仍默认先等待 HDRI，且没有超时或 fail-open。
- 当前 companion payload 还包含超过协议扩展名长度上限的项，产生请求校验失败。该问题不是本次永久 pending 的直接原因，但会制造额外失败、日志和无效 I/O。

### 2.4 FBX 边界

当前 FBX 卡顿首先发生在模型文件真正转换之前：查看器所需的 source/artifact 查询已经被长期后台 owner 挡住。与此同时，冷转换代码还存在独立风险：

- 在 Library Worker 中同步读取整个 FBX。
- 输入被复制到 WASM heap，输出再复制并组装 GLB，峰值内存可能同时保留多份大缓冲。
- 转换使用进程级串行链；一项大文件会延迟后续模型。
- 相邻查看器的 `preloadOnly` 仍可能创建完整 WebGL renderer、场景和资源，只是不继续动画循环。

所以要先修“拿不到路径”，再测“拿到路径后的冷转换”。不能把两段耗时合成一个 FBX 总时间后盲目加并发。

## 3. 根因定位

### 3.1 P0：可选环境光成为不可取消的前置门闩

`src/renderer/offscreen-thumbnail/page-renderer.ts` 在加载模型前等待 HDRI。环境光只影响画面质量，不应决定模型任务是否能够结束。对后台缩略图和 AI 输入，应优先使用确定性的 key light；若保留 HDRI，也只能并行尝试，并在短预算后 fail-open。

### 3.2 P0：取消信号在模型 AI 分支被截断

模型 AI 分支调用模型视图渲染时创建新的 `AbortController`，没有传入队列任务的 signal。于是数据库状态能变成 cancelled，执行链却无法观察取消。Worker pending map 的清理也依赖 signal；Main 没有对应的逐请求 cancel 消息。

### 3.3 P0：Main 离屏队列没有任务级 watchdog 与回收

Main 的串行队列只在 frame 回复、renderer 崩溃或全局 dispose 时 settle。某个 loader 永久 pending 时，active job 和后续队列都没有终止条件。需要给 window-ready、environment、conversion、model-load、render、readback、reply 各自建立阶段预算和稳定错误码。

### 3.4 P0：AI 批处理把外部等待包在一个 scheduler owner 中

`ai.process-queue` 一次领取多项工作，并在同一个 background-secondary 请求内跨越图片准备、模型离屏渲染和供应商网络等待。批大小只应控制一次补货量，不应成为 scheduler lease。SQLite owner 必须只包围短小、本地、可计时的临界段。

### 3.5 P1：前台媒体解析与普通后台工作共用相互排斥的许可

`media.get-source-path` 和 `media.get-artifact-paths` 为避免 source request storm 曾从 interactive 降为 background-primary；这个方向本身合理。但当 background-secondary 在外部等待时仍持有许可，它们无法进入，导致 Viewer 和缩略图协议层一起饥饿。正确方案不是把所有请求重新提升为 interactive，而是：长任务在外部等待时不持有 owner；可见范围只读解析进入有上界的 foreground-read 预算。

### 3.6 P1：轮询没有 latest-wins 背压

同步、状态和媒体摘要请求在 owner 被卡住时持续产生。等 owner 恢复，这批已经过时的工作还会形成恢复洪峰。相同 library、command、scope/generation 的轮询只需要一个 in-flight 和一个 latest pending。

### 3.7 P1：大型链接目录发现发生在独占 mutation 内

同步递归读取、逐项 `lstat` 和排序的成本与数据库变更被包成一个十余分钟临界区。`setImmediate` 只能让出事件循环，不能结束 scheduler promise，也就不会释放 mutation owner。

## 4. 优化算法

### 4.1 模型渲染：可取消的分阶段状态机

将每个离屏请求表达为状态机：

```text
queued
  → window-ready
  → environment-optional
  → model-source-ready
  → model-loaded
  → rendered
  → readback
  → replied
```

每次状态迁移都检查 signal、generation 和 deadline。`environment-optional` 不得阻止进入 `model-source-ready`：后台模式默认直接使用 key light；高质量模式允许 HDRI 与模型加载并行，超时即丢弃 HDRI 结果。取消 active job 时：

1. Worker 发出带 request token 的 cancel。
2. Main 从 queued 集合删除，或向 active page 转发 abort。
3. 若底层 loader 不支持 abort，在 500 ms 预算内销毁并重建离屏窗口。
4. 回收该请求的 source 授权、object URL、纹理、scene、renderer 与 pending promise。
5. gate 必须 settle，使下一任务能够运行。

companion 列表在 Worker 边界先 canonicalize：只保留已存在且在允许集合中的文件，扩展名统一为小写、去掉前导点，不把任意长字符串送入协议。

对应工单：`Serpent-032dfc`。

### 4.2 AI 队列：claim / prepare / await / commit 四阶段

建议的调度伪代码：

```text
claim slice under scheduler (短事务，返回有限 job descriptors)
for each descriptor under concurrency budget:
  prepare slice under scheduler (读取必要摘要、签发受控能力)
  await external work without scheduler owner
  if cancelled: release resources and stop
  commit slice under scheduler (重新核对 revision 与终态，短事务发布)
enqueue continuation if runnable work remains
```

关键不变量：

- scheduler owner 的生命周期不能跨离屏渲染、网络、退避、计时器或进程等待。
- job 进入终态后 500 ms 内，active owner、模型 gate、pending promise 与授权都必须归零。
- commit 必须重新检查 job 状态、library generation 和 asset revision，避免取消后晚到结果被发布。
- 并发预算同时考虑任务数和字节数；模型、图片、视频分别计费，不能只用“同时 32 项”。
- 长批次以 continuation 重新入队，最大连续 owner 时间先以 50 ms 作为 profile 起点，而不是在 promise 内循环 yield。

对应工单：`Serpent-db9f4f`。

当前实现状态：本轮已把 AI 队列收口为阶段化 continuation。Main 将一次补货切成不超过 8 项的 continuation；Worker 保持 claim/commit 在 scheduler admission 内，并通过每个任务的 `runExternal` 回调分别释放 media prepare、模型离屏、contact-sheet 和供应商等待的 admission，等待完成后再重新取得许可。同一 `ai.process-queue` 的并发 lane 共享带引用计数的 released scope，只有所有外部阶段结束后才重新取得 owner，避免一个 lane 提前重获许可而另一个 lane 绕过 scheduler。`SERPENT_WORKER_CMD_LOG=1` 下输出 `worker.ai.phase` 的 claim / prepare / external-await / commit（含 job-state commit）时长。仍需在真实 Electron 与永久 pending provider fixture 中证明 50 ms owner 预算、cancel-to-release 和终态收敛，因此本项仍保持 P0 open；当前已不再把整个 bounded wave 包在一个 opaque `runWithoutAdmission` 中。

### 4.3 前台只读路径与后台背压

前台可见 Viewer/Thumbnail 所需的路径解析可进入一个严格白名单的 foreground-read 通道：只允许无副作用、索引命中的短查询，并限制同库并发和最大执行时间。它不能与长写事务无界并发，也不能容纳 AI、对账或全量状态查询。

同时把轮询改为按键合并：

```text
key = library + command + scope/generation
state = { inFlight?, latestPending? }
```

新请求到来时，若同键已 in-flight，只替换 latest pending；旧等待者共享结果或收到 `superseded`。窗口隐藏、库非活动或连续超时后指数退避；库切换立即丢弃旧 generation。任务完成事件能更新的 UI 不再固定频率全量查询。

对应工单：`Serpent-e11b74`；对账自身的 continuation 仍由 `Serpent-be29a9` 负责。

### 4.4 大型链接导入：发现与提交解耦

目录发现使用可取消的异步迭代器，按目录或时间片产出 bounded batch；每一批在独占 mutation 外完成 I/O 和分类，只把规范化后的最小记录送入短事务。批次提交完成后结束当前 scheduler promise，再把 cursor 作为 continuation 入队。

批大小由两条预算共同控制：条数上限和实际 wall time。建议以 mutation 连续持有不超过 100 ms 为初始目标，动态缩放批量。取消、进程退出和文件变化依靠 cursor、幂等去重和重启对账收敛；不得一次性把八万条路径全部留在内存。

对应工单：`Serpent-c15b2a`。

### 4.5 FBX：转换执行器与轻量预热

冷转换移入不拥有 SQLite 的有界 UtilityProcess：

1. Worker 校验 asset/revision，签发受控输入和 staging 输出能力。
2. helper 读取源、执行 WASM 转换，并直接写 staging GLB；IPC 只返回小型摘要，不传输大 GLB buffer。
3. Worker 重新核对 revision 后原子发布 artifact，并用短事务登记。
4. 取消、超时、helper 崩溃或 revision 改变时删除 staging；启动时回收确认属于本应用的遗留 staging。

转换缓存键包含源 revision、转换器版本和选项。并发初始为 1，并增加按输入字节和估计峰值内存的 token；只有 A/B 证明内存稳定、前台不回归后才允许借第二槽。

相邻 Viewer 的预加载仅确保转换 artifact 和轻量元数据可用，不 mount 第二套完整 Three.js scene/WebGL context。真正切换为当前资产后再创建 GPU 资源；离开后释放 geometry、material、texture、render target 和 renderer。

对应工单：`Serpent-0727d8`；Renderer 全局保留者由 `Serpent-df0ec0` 的 CDP heap profile 继续证明。

## 5. 验收与 A/B 矩阵

### 5.1 P0 活性门禁

| 场景 | 必须满足 |
| --- | --- |
| HDRI 永久 pending | 使用 fallback 完成或稳定失败；下一模型任务仍可执行 |
| 模型 AI 运行中取消 | 500 ms 内 scheduler owner、model gate、pending map 与授权收敛 |
| 供应商请求永久 pending | 不持有 Worker scheduler；普通媒体任务继续推进 |
| late reply | 不发布到已取消 job、旧 revision 或旧 library generation |
| renderer 异常 | active job settle，窗口回收重建，后续任务不被毒化 |

### 5.2 前台预算

- 文件夹切换目标：内容身份约 500 ms 内改变；图片渐进补齐。
- Worker 已不被真实写事务占用时，可见 source/artifact 路径查询 p95 目标小于 50 ms。
- 病态 AI 或模型任务存在时，普通图片缩略图不得出现连续 10 秒零进展。
- 大型链接目录导入时，单次 mutation 连续持有目标不超过 100 ms，且前台 browse 不出现秒级以上排队。
- FBX 冷启动分开记录 path resolve、convert、artifact publish、viewer load 和 first frame；热缓存不得重复转换。

这些是实现阶段的目标预算，不是本轮已通过结论。

### 5.3 Profile 矩阵

| 维度 | 对照 |
| --- | --- |
| AI | 运行、暂停、运行中取消、永久 pending fixture |
| 模型环境 | HDRI 正常、超时、协议失败、禁用 HDRI |
| 媒体 backlog | 空、约两千、约五千、八万级逻辑资产 |
| 链接导入 | 稳定目录、深层目录、取消、运行中修改、完整重启 |
| FBX | 小/中/大源文件、冷缓存/热缓存、快速连续切换 |
| Viewer preload | artifact-only、完整隐藏 mount；比较 heap、GPU context 与首帧 |
| 平台 | 本地盘实测；Windows、macOS、网络源分别记录，不能相互外推 |

每轮报告至少包含：scheduler queue/wait/run、active owner 及连续持有时间、cancel-to-release、各 job kind 吞吐、source/artifact latency、offscreen stage、Renderer/Worker 私有内存、CDP heap 分类、event-loop lag、首卡和解码覆盖率。超时必须单列为失败，不能塞进 p95。

## 6. 工单拆分与依赖

| 优先级 | 工单 | 边界 |
| --- | --- | --- |
| P0 | `Serpent-032dfc` | 模型离屏渲染的全链取消、HDRI fail-open、watchdog、renderer 回收 |
| P0 | `Serpent-db9f4f` | AI 队列四阶段化，外部等待不持有 scheduler，终态与运行时收敛 |
| P1 | `Serpent-c15b2a` | 链接目录发现移出 mutation，分块 continuation 提交 |
| P1 | `Serpent-0727d8` | FBX helper 转换、字节/内存预算、artifact-only 邻居预热；依赖 `Serpent-032dfc` |
| P1 | `Serpent-e11b74` | 状态/同步轮询 latest-wins 合并、TTL、队列上界 |
| P0 | `Serpent-df0ec0` | Renderer heap 与隐藏 3D 预加载保留者证明，已有工单继续执行 |
| P1 | `Serpent-be29a9` | reconciliation 自身的有界 continuation，边界不扩大到 AI |
| P1 | `Serpent-217028` | 导航/任务 profile 增加模型阶段与 cancel-to-release 指标 |

推荐依赖顺序：`Serpent-032dfc` 与 `Serpent-db9f4f` 可并行设计但需联合验收；它们通过 P0 活性门禁后，再执行 FBX helper 与更高媒体并发。导入拆分和轮询合并可以独立推进。

## 7. 四列可追溯

| 需求条目 | 计划实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 模型取消 500 ms 内释放 | Worker 模型调用链、Main 离屏队列、offscreen page | Worker/Main/offscreen 永久 pending 与 cancel fixture | 当前真实实例只证明失败；修复后待真实 Electron/FBX |
| HDRI 不阻塞模型 | offscreen 环境阶段 | HDRI pending、协议失败、fallback 完成 | 当前阶段日志证明停在 hdri-loading；修复未验证 |
| AI 外部等待归还许可 | AI process queue 与 scheduler continuation | vendor/offscreen barrier + 普通媒体有限进展 | 当前实例证明 owner 超过 12 分钟；修复未验证 |
| 导入不长持 mutation | linked source walker 与 import continuation | 2 万/8 万 fixture、取消、重启 | 当前实例证明约 12 分钟 owner；修复未验证 |
| FBX 转换隔离 | helper UtilityProcess、artifact publish、Viewer preload | 大小分层、取消/崩溃、缓存命中、资源释放 | 当前实例只证明前置路径饥饿；冷转换热点待新 profile |
| 轮询队列有界 | Main poll coordinator、Worker status lane | 同键突发、多库、隐藏/恢复、超时/late reply | 当前实例证明队列数百项；修复未验证 |

当前 P0 活性增量已有定向单测、类型检查、资源库可用性门禁和合成 20K 性能基线证据，但尚未完成真实 Electron/病态 loader A/B，因此不得写成性能验收通过。AI 队列已加入有界 continuation 与 claim/prepare-external/commit 阶段日志；这不是对真实实例吞吐的证明。链接目录分块、FBX helper、Renderer heap 证明和完整对账 continuation 仍待后续增量。
