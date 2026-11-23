# 冷可见页的尺寸与源预览等待

工单 `Serpent-7d664f`，整体性能 `Serpent-3kfe` 的后续增量。前一轮完成了虚拟画布重复渲染优化；本轮继续解决真实素材跳转等待，尚未完成，不以代码存在或单次基准通过宣称性能达标。

## 实测定位

扩展既有真实链接源隐藏 Electron 旅程，增加 opt-in `SERPENT_REAL_NAV_TRACE_STAGES=1`。浏览请求、结果、页面发布、图片地址绑定、load/decode 均在 Renderer 同一时钟记录；只输出阶段与数值，不输出原名、目录或 URL。CDP 额外记录匿名路由与请求跨度。原有目标滚动比例、真实解码覆盖率断言保留。

28,930 项只读真实媒体、隔离临时库，第一轮阶段追踪 **1 passed**：

| 跳点 | 浏览结果到达 | 首个图片地址 | 最后图片地址 | 九成图片显示 |
| --- | --- | --- | --- | --- |
| 55% | 76ms | 241ms | 714ms | 731ms |
| 85% | 54 / 116ms（两页） | 291ms | 543ms | 556ms |
| 25% | 48ms | 247ms | 1063ms | 1120ms |

地址绑定后，load 多为数十毫秒；CDP source headers 多为 8–26ms。部分 custom-protocol CDP finished 时间早于 headers 且 encoded bytes 为 0，因此这些字段只作辅助，不把它们解释为严格传输顺序或零字节文件。关键证据来自同一 Renderer 时钟的长地址等待、短 bind→load。

`SERPENT_REAL_NAV_REPEAT_JUMPS=1` 在同一应用和库内重复四个跳点，**1 passed**：冷首轮九成显示约 1258 / 664 / 668 / 1027ms；重复后约 566 / 290 / 248 / 71ms。重复时部分新进入视口的资产仍收到尺寸事件，不能把全部重复跳转称作已完全热缓存；25% 第二次无尺寸事件，所有图片地址在约 26ms 一起绑定，九成约 71ms。它提示冷事实补齐是主路径，不能把首次冷库结果冒充已有全部预览的库。

## 代码原因与复用点

- 可见窗口同时启动独立尺寸探测和 primary thumbnail wave。未知尺寸的 source-direct 候选尚不能按安全阈值直出，primary claim 也会自己读头。
- 独立探测以 16 个 ID 为批次，批内串行进行链接路径安全校验、open/stat/read/close 和 metadata 持久化；全部完成后才发事件。
- 两条路径没有共享在途结果。顺序碰巧对齐时可避免重复读；同时进入时会重复。
- 非图片缺 metadata width 时也会进入独立探测并读头后返回 null。新准入应先排除非图片，而不是增加整库扫描。

复用 `SingleFlightRead`、现有 `AsyncSemaphore`、原有安全路径解析、metadata 工件写入、原图直出阈值和既有尺寸事件，不新建媒体任务系统或改 IPC schema。

当前实现按库实例及 revision 单飞；只共享进行中的读取，结束不缓存。等待准入后重新查询 canonical metadata，避免旧候选快照在另一个消费者已写入后再次开文件。独立探测有两个消费者，完成即领取下一项、持久化后逐项回调，不等待慢项。所有消费者合计每库最多三个 header、全局最多四个，给其他库保留容量；Sharp/FFmpeg 解码预算未改变。

读取在库实例/修订切换后不写入、不发布。primary 在异步读头后也重新校验 revision、删除、asset availability、链接根目录 status 和忽略状态。根目录离线时资产行可能尚未更新 availability，不能只校验资产行。失败的 metadata 写入不被宣布为 source-ready。

继续跟踪发现 Renderer 的可见报告使用 50ms trailing debounce：滚动及尺寸补齐不断重启 deadline，连续滚动期间完全不报告新页。改为 requestAnimationFrame 加固定 80ms 最短间隔，最新状态覆盖待发状态，deadline 跨几何 effect 重建保留，切库重置；cleanup 取消旧 owner 的 frame。首帧可立即发布，持续滚动也定期发布；保留 mutation re-arm key 和 Worker generation 校验。未采用无节制每帧报告：原型虽更早出首图，但增加命令和几何查询成本。

## 当前验证状态

第一版仅做 header 并发和逐项发布，重新构建真实旅程 **1 passed**，九成显示约 1286 / 748 / 686 / 1080ms，没有明显改善。后续增加既有 `MEDIA_QUEUE_LOG` 下的 header admission/read 与 metadata 文件/数据库阶段计时：metadata 文件 p50 约 0.5–0.8ms，数据库约 1.2–1.6ms，header 含安全路径检查的 p50 约 20–35ms，冷长尾数百毫秒。数据不支持优先批量重写数据库事务或放宽路径安全校验。

最终固定节奏/有界共享 header 版本的两次独占隐藏 Electron 观测均 **1 passed**，每次 28,930 项真实源、四个固定跳点。第一轮首图 556 / 231 / 222 / 280ms，九成 818 / 864 / 575 / 1044ms；第二轮首图 479 / 205 / 213 / 271ms，九成 959 / 631 / 548 / 857ms。连续滚动四秒分别新增 35 / 34 个媒体地址（旧 trailing 版本为 0），帧 p95 19.2 / 19.3ms；托管文件夹提交至侧栏出现 114 / 144ms。只说明这个独立临时库的结果，未达到所有冷跳转 500ms 的目标，也不是原实例同库复测。

随后做一组受控前后对照：两版保留上轮 viewport membership 优化和 RAW 方向修复，仅切换本轮的 Renderer 报告及 Worker header 行为；同源、同四个跳点、各自全新隔离库，串行重新构建运行。两版各 **1 passed**，四点最终解码覆盖均 100%，实际比例偏差小于 0.0003。

| 跳点 | 首图：原版 → 本轮 | 九成显示：原版 → 本轮 |
| --- | --- | --- |
| 5% | 399 → 400ms | 1059 → 853ms |
| 55% | 271 → 236ms | 674 → 751ms |
| 85% | 320 → 279ms | 612 → 554ms |
| 25% | 316 → 276ms | 953 → 904ms |

连续四秒滚动时新媒体地址 0 → 32，帧 p95 18.6 → 18.9ms，脚本样本 365 → 468。原版滚动时没有进行相同的加载工作，因此不能宣称本轮降低滚动 CPU 或提高帧率；收益是停止等待“鼠标停下来”才开始补图。创建可见 165 → 196ms，未显示创建加速。九成显示存在一处变慢，数据不支持宣称整屏稳定明显提速。

对照脚本前两次在拼接保留 RAW 的差异片段时没有重算新行偏移，Worker 构建失败，未启动 Electron；随后改为按旧行号重建、逐段校验原行，才完成上述对照。源码均由 finally 恢复，未把脚本构建失败归为产品回归，专用备份目录已清理，最终 `.vite` 对应恢复后的当前源码。

### 自动化命令与结果

| 命令 | 当次结果 |
| --- | --- |
| `node scripts/run-vitest-with-electron.mjs run tests/worker/visible-image-dimension-probes.test.ts --disableConsoleIntercept` | 最终 13/13 passed，9.47s；含单 drain=2、同库=3、跨库=4、单飞、canonical race、取消/关闭重开/修订替换、忽略和根目录离线。 |
| `node scripts/run-vitest-with-electron.mjs run tests/worker/thumbnails.test.ts -t "probes a queued\|returns header-probed dimensions" --disableConsoleIntercept` | 3 passed / 81 skipped。既有 primary / 可见尺寸回归。 |
| `npx vitest run tests/unit/coalesced-frame.test.ts tests/unit/visible-window.test.ts tests/unit/viewport-window-hook.test.tsx tests/unit/virtual-browse-canvas.test.ts` | 4 files / 27 passed。包含持续滚动、固定 deadline、几何 owner 更换与取消。 |
| `npm run test:library-availability` | 9 files / 238 passed / 1 skipped，80.88s；Electron native ABI 与 FTS5 probe OK。 |
| `node scripts/run-vitest-with-electron.mjs run tests/worker/large-library-fixture-generator.test.ts --disableConsoleIntercept` | 临时输出、20,000 项、mixed profile、seed 20261116，1 passed，75.15s。 |
| `node scripts/run-vitest-with-electron.mjs run tests/worker/large-library-performance.test.ts --disableConsoleIntercept` | 上述临时 fixture 经环境变量传入，3 passed，14.05s。 |
| `SERPENT_REAL_NAV_SOURCE_ROOT`、`SERPENT_E2E_HIDE_WINDOW=1`、`SERPENT_REAL_NAV_TRACE_STAGES=1`，运行 `node scripts/run-e2e.mjs tests/e2e/real-linked-navigation-perf.test.ts` | 当前源码重新构建、隔离 userData。上述最终两轮各 1 passed，逐跳验证实际位置误差 <0.01、真实解码覆盖率 ≥90%；最终均为 100%。 |

20k 标准基线：startup 10.4ms、全部浏览 12.6ms、文件夹切换 0.5ms、合集 6.0ms、递归合集 46.4ms、布局 116.2ms、搜索 16.8ms、Inspector 0.3ms；并发完整对账 2730.3ms，viewer resolve p50/p95/max 为 1.7/2.8/5.2ms，103 样本，事件循环间隙 p95/max 为 1.0/80.9ms。远端 metadata snapshot 4992.2ms，cached open 528.3ms。deleteRefresh 本次为 null、没有覆盖，不得写成通过。标准 fixture 不代替真实媒体旅程；生成与基准串行执行，整个专用临时根已在 finally 清理。

### 审查、失败与限制

单一 Luna 独立双轴审查发现两项实际阻断：primary 读头 await 后缺少 late-ignore/deleted/availability 检查，以及 linked root 已 offline 但资产 availability 仍 available 的窗口。均已修正并补测试，最终复核没有新增代码阻断。审查没有执行前台交互，详见对应审查记录。

Worker 测试最初错误使用普通 Node，发生 native ABI 不匹配，未进入有效断言；改用仓库 Electron wrapper，没有重编译依赖。随后三项夹具名称被自动序列识别折叠，修正为非序列名称并验证资产数量。最终 13 项通过。首轮失败时 afterEach mock reset 错误导致八个临时目录遗留；修正 cleanup 生命周期后新 fixture 全部清理，旧八个目录的删除被自动审批策略拒绝，未换工具绕过。

全仓 TypeScript 检查仍被另一文档格式开发的四项错误阻断（`clip-canvas-preview` 及其单测），本轮文件未报告类型错误。定向 ESLint 通过；`App.tsx` 既有 AI jobs dependency 警告另列，不写全仓绿。用户明确要求不做 Computer Use；前台、packaged、macOS 未执行。原运行旧实例同库的一分钟创建延迟仍未关闭。源文件始终只读，未提交或推送。

最终定向 ESLint 命令覆盖本轮两个 Renderer 文件、两个 Worker 文件及四个新增测试/探针文件，0 errors / 1 条既有 AI jobs dependency warning。测试隔离 catalog、20k fixture 与 A/B 源码备份根均已清理，最终只读检查对应工作区前缀数量为零。本轮十个输出目录的 `.last-run.json` 清理命令另被自动审批拒绝（仅返回 blocked by policy），没有重试或更换工具；与早期八个失败 fixture 及上一轮已记录的状态文件分开保留清理事实。

本增量的新增源码、测试、文档与 tracked 新增行已检查本地绝对路径、用户目录、UNC、已知本地名称与凭据前缀，无真实隐私命中。精确例外两项：`tests/e2e/browse-jump-stage-probe.ts:57` 的应用自有协议前缀判断，以及 `:84` 的同协议路由正则；它们是应用协议而非盘符路径，朴素盘符正则命中末尾字母加冒号，逐行核实后列为例外，没有放宽正则。未运行全仓提交门禁，本轮也没有提交。

后续范围：冷源路径检查与 header I/O 长尾、旧 viewport pending 队列的相关性、重复同值完成事件的 Renderer 投影、后台媒体吞吐，以及原库升级后的同负载确认。上述诊断不是这些后续项已实现的证据；整体 `Serpent-3kfe` 继续进行。

## 追加：同值完成事件的资产投影

Luna 只读追踪区分了两个问题：同一 revision 的 primary 和 standalone 都可能发布 dimensions；`applyAssetThumbnailPatches` 对同值无条件克隆 summary / 数组及 sequence frame，导致下游重算，并且 App flush 对每批正尺寸都刷新筛选成员和文件夹计数。专用 geometry / preview patch 已有值比较，因此不能把这条同值事件链说成直接导致 viewport effect reset。

另一个独立问题是 summary-page merge 对相同内容仍更换 layout 引用。当前 `BrowseLayoutEntry` 没有 revision 身份，不能仅按尺寸或预览相等就丢弃 same-ID 新 revision 的重新调度。本增量不改这部分，也保留已有 re-arm。

已让七个 summary 字段按值比较，undefined 不写入、null 保留清空语义；sequence frame 只有非空新工件 ID 才改变。初版仅按当前 summary 尺寸变化决定 membership sync，Luna 实现 helper 与单测、主 agent 集成 App；定向三个 Renderer 文件 **20 passed**。所有 geometry / preview patch 始终完整执行，即使 summary 已知尺寸也不能阻止 layout 补齐。

追加 `SERPENT_REAL_NAV_PROBE_DUPLICATE_DIMENSIONS=1`，使用同一真实源隐藏旅程的临时库：选取已经测得尺寸的真实图片，只在该临时库赋一个虚构标签，通过现有标签表达式应用过滤，验证图片 `complete && naturalWidth > 0`。测试经真实 Electron webContents / preload 发送十个受控同值 dimensions 事件，逐次跨两帧，folder.filtered-counts 请求增量 **0**；随后尺寸变化一像素，请求增量 **1**，还原尺寸仍正常刷新。该受控输入不宣称是实际两条 Worker 源同时完成，但验证了真实 Renderer/IPC 链没有以“事件没有消费”冒充去重。

该原型重新构建后 **1 passed，31.5s**；同轮冷跳转首图 923/413/234/332ms、九成 1284/779/500/931ms，连续滚动媒体地址 34、帧 p95 19.3ms，创建可见 111ms。上述受控前后性能表属于追加投影改动之前的版本；新一轮仍有冷长尾，不更新为稳定提速结论。追加定向 ESLint 0 errors / 1 条既有 AI jobs warning；全仓 typecheck 仍只有同一四项其他开发错误。

独立审查随后指出：summary 值相等并不能证明 filtered-counts 快照已更新。Worker 部分 backfill 会先逐项持久化，再在 await 返回后发布尺寸事件；Renderer 的 counts invoke 和完成事件没有源码级 sequence fence。跨频道交错未复现，不记为已证实回归。为保留原首通知行为，最终改用 effect owner 内的有界 `AssetDimensionPublicationTracker`：首个有效发布始终触发 membership 失效，只跳过同资产、当前 revision、mediaType 和尺寸相同的重复发布；revision / 类型 / 尺寸变化重新触发。最多保留 512 项，owner 更换后清空，只会多做首次失效，不依赖 summary 推测 counts 新鲜度。受控 E2E 先发一次通知，再验证后续十次同值为零请求。

最终 tracker 版本：`npx vitest run tests/unit/asset-thumbnail-patches.test.ts tests/unit/browse-filter-membership.test.ts tests/unit/thumbnail-completion-projection.test.ts` **3 files / 28 passed**。当前源码重建真实 Electron **1 passed，32.5s**，十个重复发布计数请求 **0**、实际尺寸变化请求 **1**、还原继续刷新；四个跳点首图 886/303/198/269ms，九成 1315/697/478/854ms，最终实际解码均 100%。滚动新增地址 35、帧 p95 18.9ms，创建可见 106ms。旧 viewport / 首次启动的冷长尾仍在，不能宣称全库目标完成。此追加增量仅 Renderer，不重跑未修改的 Worker/库可用性/20k 后端套件；同一审查者最终复核待返回。

最后一次回归将新输出放入专用新临时根并在同一测试 wrapper 的 finally 清理，确认成功；没有触碰任何先前被拒绝的删除目标。此前新增投影旅程的 45 字节状态文件删除同样被策略拒绝，本轮遗留合计 **11 个状态文件 / 495 字节**，另有前述八个早期失败 fixture；均保留并报告，没有以新 wrapper 绕过旧目标的限制。

### 追加：排队尺寸事件的 revision 栅栏

最终复核又找到一个已有的确定代码路径：folder-cover 订阅允许尚未加载 summary 的尺寸事件入队，接收时没有当前 summary 可比；原 pending map 不保存 revision。如果下一帧前同 ID 的 R2 summary 已进入，R1 尺寸仍会直接应用到 R2。这个缺口不是 tracker 引入，但属于本轮异步完成投影的同一条路径，纳入修复。

新 `AssetThumbnailPatchQueue` 沿用原 merge 函数，按资产保存一帧内有序 revision 分组。只合并相邻同 guard，避免旧的 versioned dimensions 和新的无版本 thumbnail 一起被吞掉；drain 快照与后续入队隔离。App 将 dimensions 事件已有的 revision 随 patch 保留，flush 按当前 summary 再解析 geometry/membership，React 的 functional setAssets 又按执行当时的 current 解析一次。已知当前 revision 不匹配的组被丢弃；无版本的既有事件保持原语义，没有伪造 revision。compact layout 本身没有 revision，未加载 ID 仍可先补 geometry，不能把这一层写成完整的端到端版本保证。

队列初版定向 **4 files / 35 passed**，重新构建真实 Electron **1 passed，31.1s**，仍保持十个重复计数请求为零、真变化一次。该版单纯放行未知 ID 的完整 versioned patch；独立复核指出 preview route 仍会漏入无修订的 compact slot，不能只保护已加载 summary。

最终未知 ID 仅投影 width/height；完整 patch 按 asset/revision 暂存至默认最多 512 条的 `DeferredVersionedThumbnailPatches`，summary 到达后只重放匹配 revision。不同 revision 独立保存，较旧的晚到事件不会覆盖另一条新事实。App 的 assets 变化 effect 调用当前订阅 owner 的重放函数，再次经版本化队列及 flush 校验；owner cleanup 清缓存、解除 callback 并取消 RAF。既防止旧 route 泄漏，也保留早于 summary 到达的正确 source route。无 revision 的旧事件仍沿原行为，未知 slot 的几何本身没有完整版本保证。

最终命令：`npx vitest run tests/unit/asset-thumbnail-patch-queue.test.ts tests/unit/asset-thumbnail-patches.test.ts tests/unit/browse-filter-membership.test.ts tests/unit/thumbnail-completion-projection.test.ts` **4 files / 40 passed**。包含同一快照对 R1 有效、对 R2 无效，mixed 新 thumbnail / 旧尺寸，未知 ID 仅几何、晚 summary 的完整 source route 重放、R2 先存 / R1 晚到、LRU 上限及清理。没有把纯模块确定时序断言冒充已在桌面复现该交错。

当前最终源码重新构建真实隐藏 Windows Electron **1 passed，31.0s**：首图 **387/236/199/302ms**，九成 **779/573/496/862ms**，四点最终实际解码 100%；连续滚动四秒新增 **35** 个地址，帧 p95 **19.0ms**，创建可见 **177ms**。十个重复尺寸通知仍为 **0** 次计数请求、真实变化 **1** 次，还原仍刷新。最新真实观察不是新的受控 A/B，不能将与此前不同运行的差值直接算成确定提速倍数。新输出与隔离库均由本次生命周期 finally 清理，旧被拒绝目标未触碰。

同一个独立 Luna 审查者最终确认此前指出的已加载 summary 与未知 slot route 两条路径都已覆盖，没有发现本范围新增的其他具体阻断；审查未运行测试。整体 `Serpent-3kfe` 和原实例同库 `Serpent-jpxsz` 继续进行，`PREVIEW-COLD-027` 待用户体验验收，尚未提交或推送。

当前最终文件的定向 ESLint 再次为 **0 errors / 1 条既有 AI jobs dependency warning**；`npm run typecheck` 仍只有其他 `clip-canvas-preview` 开发及其测试四项既有错误，本轮新文件无新增错误。最终 `git diff --check` 通过；本增量隐私检查无违规，保留前述两个精确应用协议例外。只读确认隔离 catalog、header/A-B 备份和最新专用输出前缀均为零；没有清理或改写用户源文件。

## 四列可追溯

| 需求条目 | 实现位置 | 自动化测试 | 人工 / 平台证据 |
| --- | --- | --- | --- |
| 快项逐项发布，不被慢 header 整批挡住 | `src/worker/library-service.ts:26169`；`src/worker/index.ts:1662` | `tests/worker/visible-image-dimension-probes.test.ts:212` | 隐藏 Windows Electron 真实源对照各 1 passed；前台未执行。 |
| 同修订单飞及有界文件 I/O | `src/worker/library-service.ts:19312`、`:4867` | 同测试 `:250`、`:293`、`:343`、`:398`、`:437` | Electron Worker 测试 13/13；真实不同卷/慢盘公平性未验证。 |
| 不发布过时、离线或已取消的结果 | `src/worker/library-service.ts:26224`、`:34950` | 同测试 `:472`、`:515`、`:542`、`:579`、`:607`、`:635` | 完整库可用性 238 passed / 1 skipped；packaged/macOS 未执行。 |
| 连续滚动也上报最新可见区，限制频率且可取消 | `src/renderer/coalesced-frame.ts:10`；`src/renderer/App.tsx:3180` | `tests/unit/coalesced-frame.test.ts:32`、`:45`、`:58`、`:71` | 真实滚动媒体地址 0 → 32；帧 p95 无明显变化，待用户验收。 |
| 同值卡片投影不重建引用，完成通知有界去重且保留首条失效 | `src/renderer/asset-thumbnail-patches.ts:15`、`:79`；`src/renderer/App.tsx:5310` | `tests/unit/asset-thumbnail-patches.test.ts:73`、`:193`、`:202`、`:248`；`tests/e2e/dimension-completion-regression.ts:9` | 当前隐藏 Windows Electron 1 passed；真实图片解码，受控十次重复 0 请求、尺寸变化 1 请求。前台 / packaged / macOS 未执行。 |
| 排队后已知资产换修订，旧尺寸不写入新 summary | `src/renderer/asset-thumbnail-patch-queue.ts:77`；`src/renderer/App.tsx:5311`、`:5436` | `tests/unit/asset-thumbnail-patch-queue.test.ts:38`、`:54` | Renderer 确定时序断言通过；桌面交错本身未执行，compact index 无 revision 的限制保留。 |
| 未加载 slot 不使用未核实的 source route，匹配 summary 到达后重放 | `src/renderer/asset-thumbnail-patch-queue.ts:90`、`:118`；`src/renderer/App.tsx:5385`、`:5449`、`:5579` | `tests/unit/asset-thumbnail-patch-queue.test.ts:131`、`:187`、`:208`、`:236` | 当前真实源正常浏览/解码 Electron 1 passed；特定晚到次序由 Renderer 单测覆盖，桌面该次序未单独触发。 |
