# 文件夹提交后可见性与连续导航

- 原实例问题：`Serpent-jpxsz`；Renderer 增量：`Serpent-f6df4d`。整体性能目标仍进行中，未提交/推送。
- 上一轮持久暂停修复已有独立证据；本轮不靠暂停后台任务取得导航数据。
- 复用 [PERF2 设计 §7](../implementation/2026-09-13-interactive-performance-design.md) 和现有 `useInlineFolderEdit`、导航摘要、`LibraryViewSessionToken`、文件夹返回 summary；不新建第二套目录或任务模型。

## 当前证据与根因边界

用户旧安装实例已退出，但没有升级后同库测量证据，不能宣布一分钟问题关闭。当前测试只在隐藏隔离实例中建立新目录库，链接两组只读真实素材；目录创建仅发生在隔离库自己的托管根，不修改真实源。

单一 Luna 只读审计确认：

1. create/rename 返回完整实体后，inline hook 先结束编辑，再 `reloadCurrentContent`。创建 callback 只展开父级，不 upsert 目录。
2. `loadContent` 默认刷新侧栏；先完成当前 scope 的 `openBrowseSession`，再启动 library-wide navigation summary，直到 summary 应用才 `setFolders`。因此新目录显示依赖与其无关的首屏和导航聚合。
3. navigation summary 缓存用窄 browse sequence，但返回 `changeSequence` 是宽 journal sequence，不能与 create receipt 的窄 `committedCatalogSequence` 比较。
4. `deferNavigationHydration` 只取消尚未开始的 idle work，已发出的旧 summary 仍可能到达；局部投影需要显式 fence。现有库 view token 可隔离切库与同库重开。
5. inline session 目前只以同 create parent / rename folder 判断身份；旧 write 或 post-commit refresh 完成可能影响新开的同父编辑。刷新失败与写入失败仍在同一个 catch 内，必须分开。

普通 counts 不应误报为无条件重复请求：`refreshSidebar=true` 时，旧 countPromise 分支关闭；只有筛选存在时还需更新 filtered counts。当前父级 folder-card entries 是一次批量请求，不是 N+1；它在 folders/linkedFolders 更新后异步收敛，不能删掉封面和递归统计更新。

## 新测量旅程

扩展既有 `tests/e2e/real-linked-navigation-perf.test.ts`，通过 opt-in `SERPENT_REAL_NAV_PROBE_FOLDER_INTERACTIONS=1` 在链接导入后立刻跑三轮：所有资产 → 创建托管空目录 → 进入该目录并确认 active、空状态及 0 个 asset 节点 → 返回所有资产并验证实际图片解码 → 3 秒尾观察。前后读取匿名 queue summary，不暂停或取消生成。复用现有 Renderer 帧/长任务探针和 Worker command span；输出不含源路径、名称或 URL。

初版时长由 Node `Date.now()` 包围 Playwright 操作/断言，**包含 actionability、IPC 和断言轮询，是自动化墙钟上界**。后续补 Renderer 本地输入事件 → DOM / 双 rAF / 解码标记；校正测量不能作为产品提速。

两组均使用同一产品构建，Renderer 四个脚本的聚合 SHA-256 为 `f8ca93c38e3f6f2f16a2a09d8c1b32d2f63010a45dcab5d375dbced0936b7ea2`。本地时钟探针与后续产品修改另列。

| 初版基线 | 图像素材源 | 照片/RAW 素材源 |
| --- | --- | --- |
| 链接资产数 | 28,930 | 15,465 |
| 导入 | 11,461 ms | 6,270 ms |
| 三次创建可见（墙钟） | 258 / 142 / 121 ms | 635 / 293 / 218 ms |
| 三次空目录可用（墙钟） | 471 / 144 / 75 ms | 353 / 243 / 251 ms |
| 三次返回首图 / 九成解码（墙钟） | 133 / 168 / 160 ms | 456 / 444 / 441 ms |
| 最终可见图片 | 24/24，每轮尾段 coverage=1 | 25/25，每轮尾段 coverage=1 |
| queued 范围 | 98–600 | 99–599 |
| 实际 succeeded 进展 | 1→34→74→82 | 1→54→124→157 |
| Worker create 执行 min/p50/max | 7.16 / 12.18 / 12.55 ms | 6.58 / 6.83 / 8.45 ms |
| Worker browse.session.open count | 14 | 14 |
| navigation summary count | 7 | 7 |
| 结果 | 1 passed / 27.7 秒 | 1 passed / 25.5 秒 |

执行入口：当前产品代码上一轮构建完成后，`node node_modules/playwright/cli.js test tests/e2e/real-linked-navigation-perf.test.ts --reporter=line`；source、hidden、output 通过环境变量传入。两次新 catalog/profile/output 均在确认其子进程退出、校验所有者与 reparse points 后清理；未触碰先前被拒绝清理的目标。未复现一分钟延迟；这不是旧安装实例的同负载复测。

## 本轮 Renderer 实施范围

### 校准后的改动前基线

为避免把 Playwright 轮询时间当成产品耗时，增加本地 clock：capture 真实 Enter/click，只用该 Renderer 的 `performance.now()` 计间隔。Observer 不读取布局，只合并到唯一 rAF checker；DOM 为首帧观测，paint checkpoint 为目标条件持续到后续两帧，不是 compositor 实际时间戳。成功、超时、替换和 finally 都回收监听/observer/帧；必须实际捕获输入并完成 marker，缺失/超时会失败。

首次 clock 把整棵导航树没有 mutation 作为 paint 确认条件，导致不相干更新延长 checkpoint（例如 active DOM 约 9 ms 而 checkpoint 约 566 ms）；其两次旅程虽执行通过，**那些 paint 值不用作基线或优化收益**。已改为只检查目标条件持续成立，并在同一未修改产品构建重跑两组。

| 最终改前本地计时 | 图像素材源（28,930） | 照片/RAW 素材源（15,465） |
| --- | --- | --- |
| 输入→新目录 DOM（ms） | 115.6 / 105.5 / 136.7 | 349.4 / 177.4 / 161.1 |
| 输入→目录两帧 checkpoint（ms） | 143.1 / 134.0 / 160.9 | 440.9 / 205.7 / 185.5 |
| 点击→空画布 checkpoint（ms） | 75.4 / 57.3 / 59.4 | 216.6 / 129.6 / 133.8 |
| 点击→九成可见图片解码（ms） | 75.5 / 82.3 / 73.3 | 205.9 / 151.0 / 135.2 |
| 最终可见解码比例 | 每轮 100% | 每轮 100% |
| queued / running 观测 | 93–596 / 0–5 | 96–598 / 3–11 |
| succeeded 进展 | 2→22→30→62 | 4→54→124→160 |
| 结果 | 1 passed / 27.9 秒 | 1 passed / 25.0 秒 |

两组 import 分别 12,255 / 5,926 ms；Worker 创建执行 min/p50/max 为 7.84/8.79/8.92 与 6.09/6.80/8.81 ms；各 14 次 browse session open、7 次 navigation summary。相同入口和环境开关，最终 clock / helper / harness 定向 ESLint 通过。新建产物均按生命周期清理。上述产品构建 hash 与初版相同，**这些值的变化来自测试时钟校准和运行波动，不是产品优化**；后续真正改后数据必须使用相同最终 clock。

### CPU 诊断单列

照片/RAW 源另开 CPU profiler：1 passed / 26.3 秒，产物清理。大量 `getTextAlternativeInternal`/CSS query 是 Playwright 注入脚本的可访问性定位开销，不归因产品；这进一步说明工具墙钟不能当纯用户响应。Bundle 样本落到 `viewport-window.ts` 的 `canvasViewportIsMeasurable`（clientHeight/clientWidth 读取）及 `workspace-scroll-position.ts` 的恢复循环。样本可能把被迫布局成本记在读取者上，**不能仅凭函数 self samples 宣称该函数是根因**；下一步需关联 Layout/UpdateLayoutTree 与调用/写入顺序。该诊断不并入性能 A/B 数据。

由 Luna xhigh 实现，root 负责复杂方案、串行验证与独立复核安排：

- 成功响应直接 upsert 托管/链接目录；子树重命名更新路径和 virtual identity，不等待全内容/导航刷新才能显示。
- 本地 projection epoch 与库 view token 阻止提交前旧 summary 覆盖、切库/同库重开迟到污染。只保存当前 view，不跨库积累 Map。
- 真正的编辑会话 token 隔离同父新编辑和旧 write/refresh；Enter/blur 防重。已提交后的刷新错误独立处理，不能回到写入失败路径。
- 保留当前父级 card/cover/count 与 filtered counts 的后台收敛；不把新空目录插进无关范围或筛选结果。
- 本轮不改 Shared、Preload、Worker、Service、NAS 缓存或 schema。父工单的数据库快照窄序列水位、完整协议和全部 NAS 验收仍保留，不能凭这个 Renderer 增量关闭父工单。

直接单测覆盖可控 Promise 交错；真实大库旅程重跑相同测量，另在隔离根内复制少量真实图片建立可写链接 fixture，验证托管/链接 create 与 rename 的 UI/磁盘/索引一致，不对原链接素材写入。

## 验证状态

初版与最终 clock 两组基线通过，另有一轮诊断 profile；产品改后最终结果见下节。前台按用户要求未执行；packaged/macOS 与原库升级后的同负载未验证。


## 初次改后测量与审查修正

当前源码首次构建后，同一最终 clock 通过两组隐藏 Windows Electron：图像源 1 passed / 30.9 秒，照片/RAW 源 1 passed / 26.1 秒。三次创建 input→DOM 分别为 45.2/52.5/31.0 与 81.5/63.9/88.7 ms；导航摘要各 7→4 次，browse session open 仍各 14 次。空画布与返回九成解码没有一致改善：图像源首轮 506.8 ms，同轮 browse 队列观测最大 421 ms，不能删去该慢样本或据此宣称全流程已优化。后台继续产生实际成功任务。

直接 Renderer 套件首跑 41 passed / 4 failed；失败已定位为三个新编辑器的 act 闭包尚未切换、一个 linked 子目录 fixture 使用了完整 id 而非 basename。修正 fixture/harness 后同 6 文件 45 passed。定向 ESLint 零错误，只有 App 既有 AI callback dependency 警告；全仓 typecheck 仍为其他 CLIP 轨道 4 项错误，不写成全绿。

真实功能 probe 前两次停在 linked child 重命名输入框等待。第二次增加不带数据的 DOM/focus 生命周期诊断，随后只读追踪发现 App 会把当前主视图中已有的 folder card 作为唯一编辑 surface，并给侧栏传 null；原 probe 仅查侧栏输入，不能证明产品没有启动编辑。修正为既有两种输入 selector，撤去诊断，并增加 card surface 与正在查看后代时重命名祖先两种旅程。两次失败及诊断产物均在子进程退出后清理，没有以单纯重跑当作修复证据。

单一 Luna Standards/Spec 审查确认一个 P2：linked 当前路径 rename 成功后，旧回调 await chooseFolder（内部吞读取错误）后无条件 true，导致 history 已变、scope 仍旧，且不再刷新。修正方案不是重复旧路径：成功写立即重映射当前逻辑目录的 virtual identity 和当前 history，废弃旧 content generation，再统一 after-paint 刷新；后续读取失败只报告 post-commit 错误，不恢复失效旧 scope。将 App 两个约 62 行 adapter 抽为 useFolderMutationBridge，保持 App 只接线。新增独立 hook 用例与最终当前构建/真实旅程正在验证；最终结果另列。

## 滚动性能后续候选（未实施）

只读审计没有把 CPU getter 样本判成强制布局。可验证候选是 geometry 变更引起 renderKey 函数身份改变并重建 viewport effect、同帧 MO/RO 测量未合并、恢复循环每帧无条件 scrollTo。正常滚动 publish 已复用几何缓存。后续需要带调用原因/次数的 Chrome trace 对齐 Layout 与 UpdateLayoutTree，再决定是否修改；当前没有这一证据，不能把创建投影的改善写成滚动优化完成。

## 当前源码最终验证

最终构建 Renderer 的 4 个 JS 按文件名排序、连续内容的 SHA-256 为 `ae22261e1009ef3114de91091bd9c6a644e1bacbe27bfafd97cc5bc448ec0b39`。类型导入和接口注释的末次清理不改变运行代码。每组只有三轮，不作为全局 p95 或所有负载的保证；两组原始值全部保留。

| 同一最终本地时钟，ms | 图像素材源（28,930）改前 → 改后 | 照片/RAW 素材源（15,465）改前 → 改后 |
| --- | --- | --- |
| 输入→新目录 DOM | 115.6/105.5/136.7 → 46.8/29.3/34.8 | 349.4/177.4/161.1 → 132.2/66.1/79.6 |
| 输入→目录两帧 checkpoint | 143.1/134.0/160.9 → 78.2/55.9/69.2 | 440.9/205.7/185.5 → 162.9/107.8/112.2 |
| 点击→空画布 checkpoint | 75.4/57.3/59.4 → 110.1/80.7/60.2 | 216.6/129.6/133.8 → 85.3/163.9/138.4 |
| 点击→九成图片解码 | 75.5/82.3/73.3 → 88.3/81.5/84.1 | 205.9/151.0/135.2 → 102.4/158.6/153.6 |
| 首屏解码/每轮尾段最低 coverage | 24/24；100% | 25/25；100% |
| browse session / navigation summary 次数 | 14/7 → 14/4 | 14/7 → 14/4 |
| 改后实际 succeeded 进展 | 2→38→74→85 | 4→50→124→160 |
| 改后 Electron 结果 | 1 passed / 28.1 秒 | 1 passed / 26.0 秒 |

改后 import 分别 11,717/6,525 ms；创建 Worker 执行 min/p50/max 分别 8.69/10.17/10.49 与 7.09/8.14/8.15 ms。创建可见中位数 115.6→34.8、177.4→79.6 ms，证明本地提交投影缩短这一特定等待；空目录和返回图片没有一致提速，照片/RAW 库仍有最大 115 ms 的长任务。首次改后图像源 506.8 ms 慢样本仍保留在上节，最终重跑不将它抹去。

执行与检查：

- 当前源码构建：`node scripts/run-e2e.mjs tests/e2e/real-linked-navigation-perf.test.ts --reporter=line`，通过环境变量开启 folder-interaction 模式和隐藏隔离实例；第二组复用该构建，入口为 `node node_modules/playwright/cli.js test tests/e2e/real-linked-navigation-perf.test.ts --reporter=line`。没有暂停背景生成，没有同时跑 lint/tsc 干扰性能测量。
- 同一构建 folder-mutation-acceptance 模式最终 **1 passed / 21.7 秒**：复制两张真实小图到自有目录，验证图片 complete/nonzero dimensions；托管创建/重命名、链接子目录和后代创建、卡片重命名、active grandchild 下重命名父目录；最终导航 active/crumb、typed API 的新 ID/路径、owned 磁盘子树一致。该测试证明最终收敛；不能用其最长等待预算证明所有 linked 投影都已低延迟。
- 该功能 probe 第三次在新增祖先 crumb 断言失败，原因明确为祖先使用 `.scope-crumb-button`、只有末级为 `.scope-crumb-label`。更正到真实既有按钮后重跑通过。三次失败有可定位的 selector/fixture 原因，没有将未解释的 flaky 当作关闭依据。
- `npx vitest run` 定向 7 文件（folder-mutation-projection、use-folder-mutation-bridge、use-inline-folder-edit、inline-folder-edit、defer-navigation-hydration、folder-browse-scope、folder-card-rename）：**50 passed / 7.31 秒**。
- 定向 11 文件 ESLint 首次只有 type-only import 1 错误与 App 既有 AI callback 1 警告；改为 `import type` 后单独复查 bridge 通过。最终本范围零错误，既有警告保留。`npm run typecheck` 最终仍只有其他 CLIP 轨道 4 项错误，extension 检查因前一命令失败未执行。
- 本轮仅改 Renderer，不重复 Worker、库可用性、20k Worker 或全量测试。之前暂停/尺寸改动的门禁独立记录，不混为本轮证据。单一 Luna 双轴复核确认原 P2 与 App 结构项已解决；详见[独立审查](../reviews/2026-11-16-folder-interaction-visibility-review.md)。
- 每次本轮新建的 catalog/profile/owned-source/output 均在确认拥有的子进程退出、边界/reparse 校验后清理；最终无本轮 Electron 残留和 folder-run 目录。先前被拒绝清理的目标不重试。真实原始素材从未改名、移动或删除。
- 提交前准备的本范围增量扫描覆盖 15 个源码/测试/文档文件，盘符/用户目录/UNC/凭据模式零命中，`git diff --check` 通过。这是本增量检查，不冒充整个脏工作区的提交门禁；本轮未提交。

### 四列追溯与保留项

| 需求增量 | 实现位置 | 自动化证据 | 人工/平台证据 |
| --- | --- | --- | --- |
| 成功创建/改名直接更新目录及后代 | `folder-mutation-projection.ts:97`、`use-folder-mutation-bridge.ts:58` | `folder-mutation-projection.test.ts:50` 起；真实 helper `folder-mutation-acceptance-probe.ts:345` | 隐藏 Windows 开发构建通过；前台、原库同负载、packaged/macOS 未执行 |
| 旧 summary / 切库 / 重开不覆盖新投影 | `folder-mutation-projection.ts:52`、`App.tsx:4776` | `folder-mutation-projection.test.ts:247`、`use-folder-mutation-bridge.test.tsx:265` | 可控 Promise/会话单测；特定桌面交错未强制注入 |
| 当前 linked 子树 rename 不依赖二次读取提交身份 | `use-folder-mutation-bridge.ts:78`、`App.tsx:9013` | `use-folder-mutation-bridge.test.tsx:217`、`:240`；真实 helper `:419` 的 active descendant 场景 | 正常真实旅程通过；读取拒绝由单测强制触发，未在 Electron 注入 |
| 新编辑器不被旧提交/刷新清除，Enter/blur 防重 | `use-inline-folder-edit.ts:80` | `use-inline-folder-edit.test.tsx:147`、`:174`、`:202`、`:228` | 单测通过；用户交互验收待进行 |
| 后台持续生成时目录响应 | `use-folder-mutation-bridge.ts:43` | `folder-interaction-perf-probe.ts:87`；两组最终计时与成功数见上表 | 新隔离库/真实只读素材；不是原安装库的同负载复测 |

`FOLDER-CREATE-031`、`FOLDER-RENAME-032` 仅为待人类验收的 Renderer 增量。`Serpent-f6df4d`、`Serpent-jpxsz` 与整体性能目标继续进行中，不关闭：inactive tab 与过去 history entries 的 linked path 重写、本轮未涉及的删除链路、NAS snapshot 窄水位、原库一分钟延迟及连续滚动/视频/代理/色卡/长期内存仍未完整验证。当前没有提交推送。
