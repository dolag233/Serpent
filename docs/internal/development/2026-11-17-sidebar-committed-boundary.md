# 侧栏事件提交边界与真实切库观测

关联 `Serpent-6f7d47`、整体性能 `Serpent-3kfe`。当前是局部工作量治理，不是整体流畅、稳定60fps或用户验收结论。

## 问题与最终处理

画布尺寸、缩略图与可见成员更新会使App更新。NavigationSidebar有大量逐次创建的回调；直接给Sidebar加memo仍会因函数props引用变化而进入整棵目录树。忽略回调的自定义比较器会保留旧状态，异步drop可能指向错误库，因此没有采用。

新增独立 `navigation-sidebar-boundary.tsx`：内部使用默认React.memo完整比较Sidebar全部props；数据引用、数值、选区、编辑状态等原样传入。函数props的转发器按函数key集合和库scope复用，仅在事件实际调用时读取最新已提交的处理函数。一个layout effect在提交后发布当前props，清理时释放。render中不读写ref，也不把Suspense未提交候选写进共享状态。App仅替换组件入口，没有把控制器内联进巨型文件。

scope使用React state持有的对象身份，库ID变化时条件式更新同组件state，在子树进入新库前重试。初版只比较ID会在A→B→A后复活第一次A的迟到事件，开发中已修为对象比较，并有直接与真实Sidebar drop测试。最终自查又将token从useMemo移到state，避免让可丢弃的性能缓存决定同库动作的语义寿命；useMemo仅复用转发器。最终57项重跑通过，独立审查增量复核无新阻断。旧scope动作返回无副作用的结果：native drop resolver为空数组Promise，拖动ID getter为null，internal-drag getter为false，其余void。已有Worker/view-session写入检查仍保留。

边界是“已提交跨库替换后不让旧动作触达新库”。不宣称在picker或transition开始、旧library prop尚未替换时就废弃所有动作；直接同ID无中间ID变化的重新初始化不属于这个新scope的已验证保证。已有folder edit自己的view-session generation guard保留。这些限制在独立审查中列出，没有把全局生命周期安全归给该组件。

另把托管目录、链接目录、合集三处相同展开按钮复用为 `NavTreeDisclosure`。它默认比较ID、展开状态、label、onToggle全部props；折叠回调只随当前偏好变化，合集折叠Set按持久数组复用。class、ARIA、type、stopPropagation和图标尺寸均沿既有实现，无新样式、tooltip、颜色或拖放分支。它减少重复子树工作，不声称单独带来稳定帧率收益。

## Renderer直接测试与独立审查

命令：`npx vitest run tests/unit/navigation-sidebar-boundary.test.tsx tests/unit/navigation-sidebar.test.ts tests/unit/nav-tree-disclosure.test.tsx tests/unit/real-library-lifecycle-paint-probe.test.ts tests/unit/appearance-glyph.test.tsx`，**5文件57passed /2.23秒**。

- Boundary六项：仅换函数不重渲染inner但旧wrapper调用最新已提交函数；data变化正常更新；A→B→A旧动作和getter安全失效；optional回调增删；Suspense候选不提前发布；放弃一个挂起的B库切换后已提交A仍可用。
- 实际Sidebar两项：真实目录按钮用替换后的处理函数；native File drop解析未完成时切库再返回，解析结果不会调用旧或新回收站操作。不是只向mock传一个函数来证明完整交互。
- Disclosure两项：相同props父更新不重调子Icon；仅回调替换及ID/label/expanded变化继续生效，点击不冒泡。临时撤掉memo时稳定RED（预期1次却2次），恢复GREEN；该反事实编译产物与最终产物区分记录。
- Probe单项：旧库图片不能计数，DOM/load合并、清理监听与RAF；发现只用匹配ID子集会虚高覆盖后先RED，再以实际viewport全部图片为分母GREEN。

十个直接相关源/测试文件ESLint零错误；App有一条原有AI job useCallback依赖警告，未扩大修改。`npm run typecheck`仍只有其他CLIP轨道既有四项Database错误，本轮不改该开发。单一独立Luna同时核对Standards与Spec，[审查记录](../reviews/2026-11-17-sidebar-committed-boundary-review.md)无确定阻断；审查者没有独立执行命令，不把root执行记录改写成独立复测。

## 真实素材实验：工作量与帧率分开

只读授权源A28,930项、B15,465项，写入仅在隔离catalog/profile，隐藏Windows Electron。A源树无子目录，B有1,044目录；不把两源视作相同导航负载。下列主体实验的中间Renderer连续内容SHA-256为 `cc7ba7a89954a7334e55aaa17a87da6d5e351473211238312a0a0f6b91f30b23`；最后token改为state后重新构建并单列验证，不把这个中间hash冒充最终源码。Worker始终为 `f1d3c083aa5b80e420d78db855960d975033e0fde758fb6bf80a19d63c76081e`，后端未改。

普通B前置观测1passed/29.6秒，原生四秒滚动P95/max36.7/45.2ms、25/25图片解码。只抽Disclosure后，三个普通B旅程均passed，P95为31.7/34.2/33.8ms；去memo反事实控制1passed/30.9秒、33.8ms，说明不能把首个较快点当其稳定独立收益。控制构建hash `a62b18f976f63c3c5963d2b5fad7fe78c7531a0b8dd924da731259f39f5183cb`，结束恢复source但明确仍为控制构建，之后重新构建最终版本，不用它冒充当前源码证据。

接完整Boundary后，普通B两旅程 **1passed/31.0秒、1passed/31.0秒**，P95/max34.1/44.7、39.5/54.7ms，均0 long task且末页25/25解码。目录创建首次670ms、再次105ms，四跳九成961/630/707/1293及1006/710/793/1476ms；这些波动不能写成稳定提速或已达到500ms。没有因为另一次快点而消除慢点。

最终同一“原生滚动四秒+一次自有目录UI创建”Precise Coverage窗口 **1passed/30.7秒**：Sidebar从此前同窗口49次降至**4次**，Glyph2、Icon13,017、行构造23；旧全表构造被tree-shake而未匹配，不写0。证明目录树隔离确实命中，仍不能从函数调用数推导FPS。仪器会停用优化，该窗口38.8ms不与普通数据做A/B。

当前构建A **1passed/37.1秒**，P95/max22.4/51ms、一个52ms long task，原窗口23/25图片；原来两张PNG/JPG首次immediate报告后27–33ms开始、241/258ms结算，额外一秒同ID25/25实际解码。额外等待不算普通指标；不是永久卡住，也不表示所有预览问题已结束。

## 重要的测试环境界限

本轮追加只读采集真实运行配置，A实测 `hardwareAccelerationEnabled=false`、`offscreen=true`、`backgroundThrottling=false`、GPU composition=`disabled_software`。源码Main在默认E2E中禁用硬件加速，性能helper另开offscreen。此前隐藏基准仍是真实Electron、真实素材与原生CDP wheel，但不是用户前台的原生GPU渲染帧率；没有用它们宣称前台60fps或确定GPU瓶颈。

Electron官方说明[offscreen模式](https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering)的软件输出和GPU共享位图属于不同路径；[BrowserWindow配置](https://www.electronjs.org/docs/latest/api/browser-window)也分别控制offscreen和background throttling。当前仅记录该事实，**未改Main启动、GPU选项或普通用户配置**。下一步需要在不抢前台的前提下建立带实际渲染模式证据的原生窗口/GPU测量，不能通过换测试模式把分数变好当作产品优化。

## 当前构建切库与预先观测

新增probe在菜单动作前arm，以同一Renderer performance.now时钟记录：目标库名身份、目标资产挂载、自然尺寸解码、九成解码和自动化动作结束。MutationObserver/load/error最多合并一条pending RAF，非每帧轮询；停止时清理。仅内存保存目标ID/名字，结果匿名。覆盖率用viewport全部图片作分母；任何非目标已知ID图片都令覆盖率未知，不借旧库卡片通过。它测DOM/decode在RAF中的状态，不是compositor已呈现像素。

当前构建48小时自有备份过期分支A/B **1passed/22.9秒、1passed/17.0秒**，两者最终打开库数1、返回图片24/24和25/25。A首次身份505.3ms、首卡753.2、首解码782.9、九成809.2、自动化动作结束1027.5；B身份273.9、首卡/首图/九成均517.0、自动化结束1109.4。同一B动作在图片已解码后约592ms才结束自动化，证明旧post-action时间不可直接归因画面空白。不能据此反推早先没有预先观测的2269ms也必然相同。

A staging退出仍2149ms，ACK/2秒强杀未观察；B到空库身份1106.2ms而对应open roundtrip82ms，菜单动作前置延迟仍需拆分。不把这些未解释问题从整体目标删掉。库恢复/备份仍遵守现有安全边界，完整细节见[生命周期测量](2026-11-17-real-library-lifecycle-measurement.md)。

## 四列追溯与验收范围

### 最终state token构建

scope收敛到state后的最终Renderer hash为 `84ccba797c96716eec3d901503a50603cf42c45102261ce495e4ec9f7c2bc4db`，Worker未变。重新构建后真实A/B普通旅程 **1passed/36.3秒、1passed/30.2秒**；A P95/max23.3/46.3ms，B32.0/41.0ms，均无long task、滚动末页25/25实际解码，创建可见84/153ms。四跳九成A738/603/587/928ms、B845/643/633/871ms。两者运行时均明确为软件offscreen模式；这些最后快点不会覆盖中间34.1/39.5ms或52ms长任务数据，也不能据单次全图完成关闭先前末尾缺图调查。最终57项直接测试再次通过（2.11秒），小范围ESLint零错误；全仓类型仍只有四项CLIP错误。

### 最后生命周期失败：撤回验收，保持调查

最终state构建的B生命周期一次在首卡visible断言失败（界面没有 `.workspace-canvas .asset-card`）。该次旧外层reporter没有匹配phase日志前缀，测试owner又已按纪律清理fixture，因此缺少能判定失败处于初次导入、重开还是返回阶段的日志；不能凭相同locator推断具体阶段。`NAV-BOUNDARY-043`立即撤回待验收，不以之前通过覆盖这次失败。

已修正外层phase输出过滤，并在harness异常清理前记录匿名phase、目标身份布尔值、卡片/slot数量、确认窗是否存在、白名单生命周期/Worker阶段；不追加主动库查询或输出raw日志/路径/文件名。相同产品构建的后续B **1passed/16.7秒**，阶段全链完整、九成RAF567.9ms、返回25/25，但这只是疑似竞态尚未重现，不能作为关闭依据。接下来用相同构建流程交替比较原入口与候选入口，区分新边界与既有旅程的影响，再决定是否接入。当前不是可提交/验收完成状态。

后续交替四轮为候选失败/原入口通过/候选通过/原入口通过；新增异常记录定位首次失败在已切空库、返回原库途中，库身份和卡片均空。据此发现原 App 的旧 close 事件排在重新打开同 ID 后仍按 ID 清界面的竞态，独立控制器复用 view generation 处理，旧算法四项稳定 RED 后修复。含新控制器的候选/原入口/候选/原入口四轮真实 B 全部通过，返回25/25实际解码，九成RAF507.9/514.6/498.2/524.8ms。这里不是旧 close 算法的四轮 A/B，不宣称侧栏单独提速，也不以四轮全绿替代受控复现或 transport 顺序证明。最后控制构建与恢复后的候选源码仍需区分；最终当前构建证据另记。详见[关闭事件所有权增量](2026-11-17-library-closed-view-ownership.md)。

| 需求 | 实现位置 | 自动化 | 平台/人工证据 |
| --- | --- | --- | --- |
| 画布更新不反复执行无关目录树 | `src/renderer/navigation-sidebar-boundary.tsx`、App入口 | boundary数据/函数测试、最终Precise49→4 | 真实B普通帧无稳定收益结论；前台未执行 |
| 当前回调有效，旧库迟到drop不串库 | 同module的commit ref/scope、既有Sidebar handlers | 六项边界与实际Sidebar两项，57项总通过 | 两源真实菜单切换与创建/自然图片解码通过；OS物理拖放未验证 |
| 复用三个展开控件且ARIA/点击不变 | `src/renderer/nav-tree-disclosure.tsx`、Sidebar三处调用 | 两项、mutation RED/GREEN、原折叠测试 | 真实目录创建与浏览通过；视觉/辅助技术前台未执行 |
| 不把动作结束当首屏像素时间 | `tests/e2e/real-library-lifecycle-paint-probe.ts` | 直接MO/load/fence测试、两源预先probe实际命中 | 517ms解码早于1109ms动作结束；非compositor证明 |

`NAV-BOUNDARY-043`曾因最后生命周期失败撤回；后续完成上文所有权修复的稳定旧算法RED/新算法GREEN、四轮实际切库与候选源码重新构建两源旅程，现恢复待人类验收，仍未标用户通过。新清单`LIBRARY-CLOSE-VIEW-044`单列切库功能。最终候选Renderer hash为 `7ea5b4bc9780aa7628b89b0c1002465d46ee6c285daaf3d1d327c045249b2ec6`，当前A/B普通旅程37.0/30.3秒passed，P95 24.1/31.8ms、末页25/25；完整记录在关闭事件增量文档。相关八文件67项通过；最终类型复测仅四项其他CLIP错误，不写全仓绿。只改Renderer及测试，无Main/Preload/Worker/protocol/schema/library-service变更；按分层原则不跑库可用性、20k Worker、全量与发布门禁。前台按用户要求不操作，packaged/macOS、原实例同负载、原生GPU和整体性能仍未收口。未提交推送。
