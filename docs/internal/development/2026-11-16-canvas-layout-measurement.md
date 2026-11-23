# 真实画布布局工作的定位

关联 `Serpent-47cc35`、`Serpent-jpxsz` 与整体 `Serpent-3kfe`。上一轮文件夹提交显示的局部改善保留，不据此关闭切换、滚动或整体性能问题。本轮先收集布局证据，当前没有新的产品修复或人类验收结论。

## 待验证的具体候选

只读审计已确认以下代码事实，但尚未证明其用户耗时占比：

- `useCanvasLocalViewport` 的监听 effect 依赖 `renderKey`。两个虚拟布局的 callback 依赖 geometry map，尺寸/摘要补充可改变函数身份，因而可能重建监听并同步测量。
- ResizeObserver / MutationObserver 的测量未跨回调合并；常规 scroll publish 已使用缓存几何，不应再把所有滚动都描述成布局读取。
- `restoreWorkspaceNavViewport` 在目标已到位时仍逐帧调用 `scrollTo`，直到 extent 连续稳定或达到尝试上限。重复写存在，不等于已证明强制布局。

先前 CPU profile 的 getter 样本不能单独证实强制 Layout；Playwright 自身可访问性定位和可见性轮询也会产生额外工作，必须隔离。

## 测量协议

复用隐藏隔离 `real-linked-navigation-perf` 旅程和已授权只读真实素材，增加 opt-in `SERPENT_REAL_NAV_TRACE_CANVAS_LAYOUT=1`。在追踪开始前确认首屏真实解码并读取滚动 extent；追踪期间只在一段 Renderer 脚本里执行四次远跳、四秒连续滚动和一秒尾观察，不轮询几何、不运行可访问性定位。追踪结束后再验证图片完整解码及非零尺寸。

诊断 helper 仅在内存处理 Chrome trace，限制大小，不保存包含 URL/路径/源内容的原始数据；出参只含固定事件名、匿名统计、归一化代码位置和有界计数。成功或失败回收 stream、CDP listeners、page-side patch/observer/RAF。它会扰动执行时序，所以用于归因；产品 A/B 耗时另用不带 trace 的旅程。

Luna 负责测试 helper 与解析用例，主 agent 负责测量设计、harness 接线和串行真实运行；另一 Luna 并行只读审计媒体任务吞吐。本轮不触碰原始素材、不抢前台、不重建运行中的开发实例、不提交推送。

## 当前状态

已完成真实 trace、针对callback/observer生命周期的产品增量、定向测试和当前构建对照。真实底部查看返回/缩放/双布局回归发现并修复了另一项恢复所有权问题，当前构建的末端断言已完成，见[重排记录](2026-11-16-preview-reflow-ownership.md)；没有整体性能完成结论。20k Worker基线不在本次Renderer层运行，既有Worker检查结果不能替代本轮布局证据。

## 当前构建的常规旅程基线

先在同一未改产品构建、没有 layout instrumentation 下串行跑既有四跳和四秒滚动，入口 `node node_modules/playwright/cli.js test tests/e2e/real-linked-navigation-perf.test.ts --reporter=line`，source/hidden/output 走环境变量。滚动段保留该旅程既有 CPU profiler，不能称为无 profiler 的真实用户帧耗时；两组运行期间没有并跑 lint/tsc/其他测试或源树遍历。

| 指标 | 图像源 A（28,930） | 照片/RAW 源 B（15,465） |
| --- | --- | --- |
| 四跳首图 ms | 466/380/280/283 | 562/209/387/352 |
| 四跳九成解码 ms | 910/717/634/951 | 948/612/738/788 |
| 四秒滚动 script samples | 650 | 1,779 |
| 滚动 frame p95 / max ms | 20.2/37.3 | 69.1/88.0 |
| 滚动 long tasks | 0 | 7，合计364ms、最大55ms |
| 结束可见图片 coverage | 96% | 100% |
| 结果 | 1 passed / 31.2秒 | 1 passed / 24.4秒 |

每一跳都校验实际比例与九成解码；结束的 96% 不是全图解码保证。B 的 528 个样本落在当前 bundle 的 `canvasViewportIsMeasurable`，函数体已核对为 `clientHeight/clientWidth` 读取。基线此时还不能凭CPU采样判为强制布局。测试新建 catalog/profile/output 在拥有的进程退出及边界/reparse 检查后清理，没有残留 Electron；未改原素材。

## 实际 trace 与根因

当前构建、源 B 的 trace 诊断 **1 passed / 27.3秒**。计数观测11,095.9ms，stream59,606,775字节、206,360事件，未丢数据、未截断、未遇无效事件；初始捕获1个canvas和1个虚拟grid。结束30/30图片真实解码。

| 浏览器事件 | count | total ms | p95 ms | max ms |
| --- | ---: | ---: | ---: | ---: |
| Layout | 133 | 173.46 | 2.5 | 7.48 |
| UpdateLayoutTree | 440 | 1,507.04 | 15.5 | 21.60 |
| PrePaint | 789 | 114.74 | 1.5 | 2.93 |

getter→measure→hook 栈关联146次事件、1,183.78ms。同一事件的多个栈帧共享duration，所以栈行不可相加；本证据主要揭示**同步样式树更新**，不能把1.5秒全部叫作Layout。canvas height/width/rect读取603/146/453次，grid rect378次；252帧有重复读取，单帧最多16次。此旅程没有触发scrollTo恢复写（计数为0），因此不能把先前恢复循环的重复写判为这轮连续滚动主因。

公开hook复现测试也实际RED：DOM尺寸未变，仅25次更换几何callback，ResizeObserver构造由1到26；其余4项通过。最终测试文件停写后再跑，仍同一确定失败，不是靠重跑消除的flaky。

## 实施增量

`useCanvasLocalViewport` 将committed callback的发布和DOM observer生命周期分开：callback在layout effect更新到ref，用已有snapshot和上次已捕获的scrollTop重算成员；实际scroll、resize、直接结构变化仍沿既有路径处理。跨geometry版本重置旧key，即使字符串相同也不能用旧坐标跳过重算。避免在React已写DOM后为了更新callback而读取任何几何getter（包括scrollTop），保留原overscan、优先级和同步scroll响应。

定向5文件55项通过，包含同key新geometry、真实resize、折叠canvas、最新callback生效与listener/geometry读取预算。首轮lint有3项测试变量风格问题，修正后定向5文件零错零警告。诊断流解析另用碎片JSON、脱敏、data-loss、失败清理与幂等stop/dispose测试覆盖。首轮全仓typecheck发现新增测试变量的Element/HTMLElement推断问题，已改用有类型的querySelector；其他CLIP轨道4项错误保留，最终复查另列。

最终typecheck确认本轮类型问题已消除，仍只有其他CLIP轨道4项既有错误，extension检查因此未执行。当前产品构建与真实改后结果如下；唯一独立Luna未发现具体阻断，保留未强制注入的浏览器clamp时序边界。

## 当前源码改后对照

当前构建4个Renderer JS按文件名排序连续内容SHA-256为 `c620d0be2dd3d4b42db07cafd0ba4df8b4bf8a543c033a23df5e5168c93edeb6`。由 `node scripts/run-e2e.mjs tests/e2e/real-linked-navigation-perf.test.ts --reporter=line` 重新构建，后两次复用该构建直接Playwright；所有运行串行，不与lint/tsc或媒体源统计竞争。A、B正常旅程各1 passed（29.5/23.5秒），B改后trace另1 passed（26.8秒）。

| 普通旅程，改前→改后 | A（28,930） | B（15,465） |
| --- | --- | --- |
| 四跳首图 ms | 466/380/280/283 → 429/391/223/270 | 562/209/387/352 → 459/167/327/364 |
| 四跳九成解码 ms | 910/717/634/951 → 954/782/568/1,004 | 948/612/738/788 → 805/525/700/711 |
| 四秒滚动 script samples | 650→468 | 1,779→1,224 |
| 滚动 frame p95/max ms | 20.2/37.3→19.6/32.2 | 69.1/88.0→58.6/69.9 |
| 滚动 long tasks count/total ms | 0/0→0/0 | 7/364→1/51 |
| 创建可见（工具墙钟）ms | 68→64 | 164→411 |
| 结束可见解码比例 | 96%→96% | 100%→100% |

两组每个实际跳点仍在1%容差内，九成以上可见图片实际解码。样本很少，A有更慢的图片点，B创建的工具墙钟也更慢；不能用这些单次对照保证所有操作稳定提速或掩盖后台竞争。

### 诊断变化及未解决部分

B改后trace完整：61,109,410字节、212,358事件，观测11,275.5ms；无丢失/截断/无效事件，结束30/30解码。canvas height/width/rect由603/146/453到402/0/319，grid rect378到242；单帧最大/p95读取由16/14到9/7。旧getter→measure栈不再出现，证明重复测量路径已移除。

但是UpdateLayoutTree总耗时 **1,507.04→1,515.78ms**，几乎不变；Layout173.46→150.08ms。耗时转到其他React commit/native image与layout-effect栈，不能将旧getter所关联的1.18秒当作已节省CPU。普通B中(program)采样1,527→2,077，与script相加3,306→3,301，也提示**样本归类迁移**：script样本少不等于整体CPU总量少。当前只有较小的帧间隔改善，照片库58.6ms的p95仍明显卡顿。

后续需要定位样式失效范围及节点规模，核对原生图片设置src触发样式更新的机制，再决定更完整方案；不改UI外观来掩盖成本。已安排一手实现研究，以及同catalog保持canvas尺寸的导航内容渲染敏感性诊断。恢复循环本轮scrollTo仍为0，不列为当前滚动主因。

## 已加载目录树的渲染敏感性

用 `SERPENT_REAL_NAV_PROBE_STYLE_SENSITIVITY=1` 在同一真实源B、隔离catalog做四个4秒连续滚动窗口；不启用CPU profiler或trace。复用当前源码构建，入口 `node node_modules/playwright/cli.js test tests/e2e/real-linked-navigation-perf.test.ts --reporter=line`。临时修改仅存在于诊断实例的导航content-visibility，finally还原原有inline value及priority，不是产品变更。

首轮导航树尚未加载，导航仅102节点、文件夹行0，四窗p95约19.5–20.5ms，没有证明目录树无影响。补足真实前置条件后，document 11,034节点，导航9,576节点、1,045文件夹行；canvas 1,236节点、100个挂载卡片。

| 四窗顺序 | 帧间隔p95 ms | 最大帧间隔 ms | 可见图片实际解码 |
| --- | ---: | ---: | --- |
| 导航可见 | 29.8 | 49.8 | 30/30 |
| 导航内容临时隐藏 | 22.8 | 24.5 | 30/30 |
| 导航恢复可见 | 29.7 | 40.0 | 30/30 |
| 再次临时隐藏 | 22.4 | 43.9 | 30/30 |

四窗canvas宽高不变，每窗滚动1,600px、无long task，probe末端断言完成。该顺序重复说明导航渲染成本是可测的贡献，但没有区分具体CSS selector失效、布局或绘制，也不是最终产品A/B；不能把临时隐藏导航直接作为解决方案。下一步审计树节点的挂载范围、样式失效边界及既有虚拟化能力。原始图片设置src和React commit的一手实现调研见[研究记录](../research/2026-11-16-image-source-style-recalculation.md)，尚未证明React自身存在缺陷。

本轮单一独立Luna对viewport增量无具体阻断；主agent核对当前构建两个布局实际解码、自然底部返回和缩放断言。`CANVAS-OBSERVER-033`待人类验收；前台按用户要求未执行，原库同负载、packaged/macOS仍未验证，整体优化继续。

## 目录树候选的影响范围

独立只读审计确认：闭合的目录后代在 `filterCollapsedDirectoryEntries` 被裁掉，合集仅对未闭合分支递归，不能把现状描述成「折叠仍挂载全部后代」。展开后的目录未窗口化。每次Sidebar render会map全部可见目录，且每个linked行以 `linkedFolders.find` 查找自身，形成重复的线性扫描。

滚动补取未加载摘要页时，分页hook会调用App的 `setAssets`。Sidebar是普通函数组件，App传入许多新建handler，因此与资产无关的目录行也会重建。这证明计算路径存在，但还没有Profiler数据说明其占比。壳级和行级`:has`存在同样仅是代码事实，当前不能断言它们导致全局失效；不能通过忽略callback比较或截掉目录语义来跳过验证。

下轮短trace会先等待真实目录行出现、预热四秒滚动，再分开开启invalidation与selector-stats类别，追踪两秒；原11秒布局协议保持不变。指标以字段实际出现为证据，缺失不补零；selector只在内存分类，不保存原始trace或输出路径、ID及原始selector。当前待诊断Renderer构建4个JS的连续内容SHA-256为 `dea7f9e8236cb4ac4831e3a2039421a5b6fef1045e8d4cc5035c9cfa48792455`，包含前述reflow修复；只有测试诊断接线在变，不改产品基线。

### 已完成的细分追踪

新增parser直接单测8项通过、相关4文件lint通过。主agent核对producer字段时发现初版使用`elapsed`而一手实现为`elapsed (us)`，且带壳前缀的行级`:has`被误归到壳级；用正确字段和实际形式的selector升级夹具，先取得7 passed / 1 failed，再修正读取和pseudo主体分类，最终8 passed。新夹具只用相对虚构路径，不新增盘符例外。

原定2秒invalidation capture实际 **1 failed：byte-cap**，额外事件超出64MiB门限；不使用其截断数据作性能结论。调整为200ms，并在该模式去掉广泛的disabled timeline与stack类别，保留所需timeline、invalidation和user timing。不是增加内存上限或重跑同一不稳定条件。原11秒协议和selector模式不受影响。

同一照片源B、同一产品构建，两个有效结果：

- SelectorStats两秒：**1 passed / 18.0秒**，4,291,045字节、11,968事件，完整且无data loss/事件截断/无效事件；观测2,100.6ms，最后25/25图片解码。21个SelectorStats事件中6个不含已知数组路径，保留missing计数；已知应用marker分类的壳/行/资产关系选择器耗时14,997/17/2,040µs，ordinary 38,149µs，另2,803条无法分类。不声明覆盖全部样式或已核对stylesheet身份。开启该类别时UpdateLayoutTree1,632.46ms，强烈受统计开销干扰，不能与普通运行帧耗时做A/B。
- 最小invalidation 200ms：**1 passed / 16.1秒**，2,077,229字节、4,365事件，完整无丢失/截断/无效事件；观测227.9ms，最后30/30图片解码。4次UpdateLayoutTree的elementCount均在args出现，合计1,268；StyleRecalc事件1,253，其中1,247归入包含rule字样的固定桶，1次relational。总UpdateLayoutTree19.40ms，Layout1.04ms。事件没有与导航/画布DOM节点身份关联，不能把这些计数认作导航树全部被失效，也不能据一个短窗排除其他负载。

本轮只保存匿名摘要，新建output/catalog已在拥有的进程结束后清理。Web和Node访问一手源码遇到网络失败，selector的精确producer字段由前轮实际读过的固定Chromium源码记录恢复，并由本轮运行时非缺失统计验证；没有猜测未知序列化分支。下一候选是保留完整导航内容的layout/style边界敏感性实验，以及已确认的重复linked目录查找复杂度修正。

## 屏幕外普通目录行的原型

在已包含Map增量的同一构建上，使用照片源B继续四窗实验。只在隔离实例临时添加owned样式与marker，为普通NavRow启用 `content-visibility:auto`，intrinsic block size引用既有 `--shell-control-height`；focus-within或有插入线标记的行保持visible，inline编辑与合集递归外壳不套用。28px固定行高和22px disclosure已静态核对。规范边界参考[CSS Containment](https://www.w3.org/TR/css-contain-2/)；跳过内容和paint clipping的机制与实际性能收益分开判断。

入口为既有真实旅程，设 `SERPENT_REAL_NAV_PROBE_STYLE_SENSITIVITY=1`、`SERPENT_REAL_NAV_STYLE_CANDIDATE=rows-auto`，不启用CPU profiler/trace。**1 passed / 35.0秒**；15,465项资产，1,045个目录行、1,049个普通树行，导航9,576个DOM节点。四窗p95/max分别为31.4/54.9 → 23.5/41.3 → 31.3/44.9 → 24.0/37.3ms；各窗30/30图片真实解码、无long task，画布宽高与导航几何/extent、导航DOM及逻辑焦点顺序不变。临时规则与marker已恢复，新建output/catalog清理，无原始素材修改。

该结果是同库预热路线的敏感性诊断，不是最终普通负载A/B，尚未写入产品CSS。首次deferred计数检查row自身得到0；row自身box本来仍存在，该检查不足以证明内容是否跳过。已将一次性采样改为检查内部button，但修改后的计数尚待运行，不把0解释为不存在跳过，也不据帧耗时推定具体机制。跨屏实际Tab/focus、scrollIntoView、托管测试目录编辑和实际拖放插入线回归在开发，前台和辅助技术未验证。

原型保留导航DOM，而画布会因真实图片尺寸补充自然改变DOM和scroll extent。断言因此限定到本实验控制的导航DOM/顺序和两面板viewport几何，不要求后台尺寸更新期间整个document节点数或画布extent完全静止；每窗仍报告实际extent。这是隔离归因范围，未放宽导航自身的尺寸和语义要求。

产品落地后的实际操作及同构建普通负载交叉对照见[后续记录](2026-11-16-offscreen-navigation-rows.md)。961行内容跳过已由内部button验证，修正了原型只检查own box得到0的测量缺口；普通负载仍不理想，不能用预热结果替代。

## React重复工作的后续候选

只读审计确认：有效thumbnail patch在 `App.tsx:5376` 更新assets可重渲染Sidebar；完全无变化的patch由 `applyAssetThumbnailPatches` 返回旧数组，不能说任何通知都必然触发。纯thumbnail变更通常保留导航条目/外观对象/数字计数身份，但NavRow仍重建inline事件、拖放handler对象和disclosure ReactNode，App也重建多个Sidebar callback。因此默认memo整个Sidebar/行不能直接奏效，忽略callback identity也会引入旧闭包。

`AppearanceGlyph`与`Icon`是纯叶子，props多数为稳定引用/原始值，可先用受控render计数及profile验证复用机会；Icon路径ReactNode已有模块级缓存，不能假设每次重建所有SVG path。memo叶子只能减少该部分执行，不能证明减少NavRow生成或布局成本；尚无测量支持把它列为本轮已实现收益。原生输入滚动测量优先补齐，后续按证据选择改动。
