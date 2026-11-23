# 平铺几何增量重用与滚动工作量

关联 `Serpent-47cc35` 与整体性能 `Serpent-3kfe`。本轮继续定位真实持续滚动，不能把上一轮可见队列修复等同于整体流畅。本记录随验证更新；当前不是人类验收结论。

## 真实证据与诊断纪律

继续只读链接经授权真实源，隔离 catalog/userData、隐藏 Windows Electron，不操作用户前台。修改前 Renderer 四个 JS 连续内容 SHA-256 为 `8f43f73e5e649f2680d94f44437a8b1197b79a725f0fb5461b795ab4d987b1b8`；本轮纯函数提取/缓存源代码尚未构建时，诊断仍明确使用该旧构建，不将源码状态冒充当前构建。

- B 共 15,465 项。四次远跳之后，静止两秒 rAF 119 个样本，P95/max 18.1/18.9 ms，节点/src 变化均零。紧接四秒 80 个 CDP mouseWheel，滚动 1600 px，P95/max 38.5/49.4 ms，末页 25/25 图片实际解码；无新分页、无 long task。它排除本环境只支持约 30 fps 的解释，不单独证明某个代码根因。此旅程 1 passed / 31.7 秒。
- 单独滚动 trace + CPU 旅程 1 passed / 33.5 秒。4,208.5 ms trace 完整 22,090,887 字节、79,319 事件，无丢失/截断/无效事件；UpdateLayoutTree 232 次 / 361.42 ms，Layout 55 次 / 36.87 ms，PrePaint 509 次 / 47.13 ms。滚动范围与九成以上实际解码仍校验。带仪器帧 P95 43.9 ms 不能与普通 37 ms 当 A/B。
- CPU detail 复核旅程 1 passed / 29.1 秒，3,825 个有效样本、区间总和 4,377,104 微秒，所有 invalid/truncation 计数为零。行构造函数 self 41 样本 / 46,302 微秒采样区间，虚拟平铺组件 inclusive 145 样本 / 162,939 微秒。计时明确是采样区间，不能说成真实 CPU 执行时间或唯一帧瓶颈。
- 初版 inclusive 按递归层重复累加，同函数位置出现 6,297 次却只有 3,796 总样本。已用递归 fixture 先 RED（5 大于 3）再按 sample/functionKey 去重 GREEN；丢弃初版 inclusive 归因，保留更正记录。最终纯 helper 6 项通过。
- Precise Coverage 不依赖 minified 函数名，以源码固定字面量/结构在内存识别，调用总数与 URL/源码分离。首轮 B：AppearanceGlyph 46,244、Icon 59,844、NavigationSidebar 44、全表 buildJustifiedGeometry 26 次；行级同形 fallback 导致 ambiguous，不猜计数。新 fixture 先复现歧义 RED，再增加 entryAt/itemsPerRow/reduce/Math.round 结构约束 GREEN；最终 helper 7 项通过。旧构建实际复核 COMPLETE：Glyph 45,193、Icon 59,496、Sidebar 43、行构造 80,418、全表构造 26。该工具停用 JS 优化，首轮实际输入耗时 5.05 秒、16 个 long task；这些帧耗时不是产品回归，也不能拿作无仪器基准。

这证明了几何重复路径及 Sidebar 大量重复调用的存在，但没有证明叶子 memo 会带来多大帧收益。本轮优先修正已确认的整表几何失效；Sidebar 事件隔离仍是后续候选，避免忽略回调造成旧闭包或异步拖放目标错投。

## 当前构建的阶段对照

先只构建几何缓存，Renderer hash `d998e475ac4d773ed3c96b9448d77ba98237be2c1a2bd376414b7b781086478f`：普通 A/B 各 1 passed / 34.7、28.9 秒；B 再次同构建 1 passed / 28.7 秒。B 两轮原生滚动 P95/max 为 31.9/44.7、33.1/47.0 ms，旧同路线最近 37.1 ms（额外静止对照为 38.5 ms，不作严格同条件中位数）。两轮末页 25/25 实际解码，创建可见 101/99 ms，四跳九成824/608/630/868与1007/536/644/906 ms。A P95 21.7 ms、末页23/25（92%），不能说全图都完成；A走未改的chunked路径。

同缓存构建 Precise 1 passed / 31.0 秒：行构造从 80,418 到 **24 次**，Glyph/Icon/Sidebar仍为44,142/58,044/42次。旧全表构造函数被 tree-shake，分类未匹配，不当作0。这是按变化行重用的直接工作量证据，仍不代表37ms全部由行构造解释。

随后给 Icon 和 AppearanceGlyph 加默认 React.memo，无自定义比较器，不修改任何颜色/样式/默认值。Glyph 的子 Icon mock 计数证明相同 props 的父层更新被跳过；3 项直接单测覆盖真实 SVG path/name/size/color，以及 appearance/fallback/emoji/badge 的新值继续生效。所有现有调用是 JSX，未发现把 Icon 当普通函数直接调用的代码；外观 producer 按新对象更新，无原地改 appearance 的当前路径。

含纯叶 memo 的最终普通 A/B 1 passed / 35.1、30.4 秒，A P95/max22.8/49.7 ms、末页23/25，B34.4/45.5ms、末页25/25；B四跳1052/734/695/1069ms。没有据这些数字证明 memo 额外改善帧率。最终 Precise 的行构造24、Sidebar42，Glyph/Icon未匹配：V8可能不返回本窗口未调用的函数，**不能把未匹配写为0**。

为校准 inactive 叶子识别，尝试在取 coverage 前用裸 API 创建一个隔离目录并等待 Sidebar 出现。该轮在10秒可见前置条件失败，未形成叶子调用数证据；裸 API 没有走 App 的 receipt 投影/目录定位流程，不能由本失败推断真实UI创建也慢，也不判定裸API广播行为已完整核实。测试已改用原有真实 UI 创建步骤，再计4秒滚动加一次创建的保守调用总数，明确与纯滚动不同。失败新产物由 owner 退出后清理，未重试旧拒绝目录。

更正后的校准旅程 **1 passed / 30.6 秒**：四秒原生 wheel 加一次真实 UI 创建的整个 coverage 窗口，Glyph 共 **2 次**、Icon **4 次**、行构造28次、Sidebar55次。窗口含额外操作，不能与旧纯滚动45,193/59,496做相同工作量的精确比例，但它给出了包含滚动在内的保守上界，证明叶子调用已不再随每次 Sidebar render 扩张。旧全表构造仍未匹配，不记0。该轮末页25/25解码。没有把插桩P95 51.7ms当普通帧数据。

### 最终选择：缓存 + 目录外观子树复用

没有依据调用计数继续扩大 memo。全局 Icon memo 的两个普通 B 观测为34.4/34.1ms，比仅缓存31.9/33.1ms没有额外帧收益，因此撤回通用 Icon memo；`Icons.tsx`已与本轮开始原文一致，不留下这个产品改动。保留 AppearanceGlyph 的默认 memo，直接隔离稳定目录外观子树。相应 glyph 计数单测在临时撤掉 memo 时稳定 RED（应2次却4次），恢复后 GREEN；颜色/尺寸/emoji等语义仍通过。首轮 mutation 暴露测试未设 act 环境警告，现两份 DOM 单测均设置并还原 `IS_REACT_ACT_ENVIRONMENT`，不压制警告。

最终 Renderer hash：`f8803433c348fc394506b7ba0f1377ce0b217cb522849ae7c4c353c829448aa3`。当前源码重新构建后，B 两轮普通原生滚动 P95/max **31.3/39.2、32.5/38.9ms**，均无 long task、末页25/25图片解码；完整旅程1 passed / 29.6、30.2秒。四跳九成为957/635/639/901及933/632/632/915ms，普通创建可见131/97ms。旧最近普通B为37.1ms，同机先后小样本支持局部改善，未证明所有负载稳定收益或额外 memo 的独立贡献。

最终 A 当前构建旅程1 passed /35.9秒，P95/max23.5/55.7ms，1个55ms long task、末页23/25（92%），四跳806/678/610/1079ms；不掩盖较早阶段21.7ms的波动，也不以B的改善宣布A更快。A的两张末页未解码仍待进一步归因，不能归为本轮已修复。

最终当前构建的真实 B 两视图旅程1 passed /16.9秒：平铺底部20/20解码、预览实际解码且自然返回近底25/25；瀑布流16/16、返回20/20；最大到最小卡片自然恢复仍近底，33/33解码且scrollTop合法。整个功能序列5850ms、缩放阶段1409ms，含自动化成本，不冒称各动作达到500ms性能预算。前台按用户要求未操作。

最终当前构建校准 Precise **1 passed /30.1秒**：滚动加一次隔离目录 UI 创建，Glyph2、Icon14,535、行构造26、Sidebar49。与 memo-all 实验 Icon4 次区分明确：最终通用Icon恢复，叶子数字更大但普通帧对照更好，不能把调用数越少当作最终产品目标。纯滚动计数窗口与含创建窗口不同，因此只用作保守工作量证据，不作精准比例。两次最终 B、A、生命周期与校准所有新产物均由 owner 结算/退出后清理；根目录核查仅保留旧已知拒绝项，未重试它们。

## 原因与完整处理边界

App 在每个 RAF 批次合并尺寸事件，`patchVirtualLayoutGeometry` 为变化 slot 替换 Map value、保留其余 value identity。虚拟平铺以 geometryEntries 的 Map 引用为 useMemo 依赖，因此任何一个真实尺寸批次都重新计算全表的所有行，创建 entries/ratios/widths 多组数组。B 在 20,000 materialization 阈值内，五列约 3,093 行；完整构造 26 次意味着每次仍走全表循环，不能用“已经 RAF 合并”推定局部计算。

现将既有行几何算法提取为独立纯模块，旧 export 路径保留。配置（总数、列数、取整后的可用宽度/目标高度、caption resolver 身份）相同时，逐 index 比较前后 Map value，只有含变化 entry 的行重算；其他行复用 widths/height/caption。随后线性计算 offsets，偏移变化只新建 wrapper，禁止改旧行。缺 entry 仍是原有 placeholder，最后不足一行和不拉伸规则沿原算法。配置变化完整重算；不修改样式、分辨率接受范围、overscan、选择或媒体准入。

复杂度仍有 O(total) 的轻量 Map 比较与 O(rows) 的前缀累加，不宣称 O(changed)；节省的是所有未变行的比例、caption、整宽分配和数组分配。只保留当前 snapshot，不引用 previous 链。超过阈值的 chunked 模型继续原路径；它的已知行与 block 重建仍是未解决候选，不称所有大库布局已经增量化。

初版 hook 用 layout effect 发布 ref，却在 render 内读取其值，触发仓库 `react-hooks/refs` 门禁。已改为 React 自己持有不可变 snapshot state：输入改变时条件式调整同一组件 state，React 在子树渲染前重试；不在 render 读写共享 ref。官方[useState 前次渲染状态模式](https://react.dev/reference/react/useState#storing-information-from-previous-renders)与[refs 约束](https://react.dev/reference/react/useRef)支持此边界。条件为派生 snapshot identity 改变，同 Map/config 直接返回旧对象，避免循环；Suspense 实测证明未提交候选不会污染随后提交。该模式会额外重试当前组件，不冒称消除所有 render。

## 直接测试

Luna 先写纯缓存用例，stub 保持原全量构造，8 项中 5 RED：单项、同 row 多项、mediaType、移除 entry 预期 caption resolver 仅 2 次却为 7 次；旧 widths 引用也未复用。实现后 8 passed，完整几何与旧算法逐字段一致。Root 新增真实 React/Suspense hook 两项：候选 render 挂起后，最终更新只算自身变化行；切出 dense 时释放 snapshot，切回完整重建。

命令 `npx vitest run tests/unit/justified-row-geometry.test.ts tests/unit/use-justified-geometry-snapshot.test.tsx tests/unit/virtual-browse-canvas.test.ts tests/unit/viewport-window-hook.test.tsx tests/unit/cpu-profile-work-summary.test.ts tests/unit/render-function-call-probe.test.ts tests/unit/canvas-layout-work-probe.test.ts`：7 文件 / 52 passed。定向 ESLint 清理了六个测试未用参数；诊断 helper 的 range-null 类型已补显式 guard。全仓 TypeScript 最终仍只有其他 CLIP 轨道既有四项 Database 错误。

最终源码再加 `appearance-glyph.test.tsx`、`icon.test.tsx`：**9文件 /55 passed**，6.83秒；当前环境happy-dom建立耗时比首轮长，断言本身238ms，不据单测墙钟当性能提升。最终13个直接相关源/测试文件定向ESLint通过；TypeScript仍仅上述四个既有CLIP错误。源/测试 `git diff --check` 通过。独立 [Standards / Spec 审查](../reviews/2026-11-17-incremental-justified-geometry-review.md)无确定阻断，审查者没有运行命令，不把主agent执行记录当独立复测。

新/直接相关代码、测试、开发/审查记录及状态、QA、最新工单评论共18块定向隐私扫描零命中；不是提交级全仓门禁。最终根目录与工作区原生进程核查未发现本轮新测试残留或仍在运行的匹配进程；已知旧拒绝项保持不动。

只改 Renderer 纯几何、外观图标子树与测试，没有修改 Worker、协议、资源库或媒体管线；本轮不跑 Worker、库可用性、20k Worker 或发布门禁。上面的最终旅程均在当前源码重建后执行，较早阶段只作对照。前台 Computer Use 按用户要求不执行，packaged/macOS、原实例长期内存与全部目标未验证。新增 `CANVAS-GEOMETRY-042` 待人类验收；工单保持进行中，未提交推送。

## 四列追溯

| 需求 | 实现 | 自动化 | 平台/人工证据 |
| --- | --- | --- | --- |
| 仅重算尺寸变化所在行且旧几何不可变 | `src/renderer/browse/justified-row-geometry.ts:28`、`virtual-browse-canvas.tsx:989` | `tests/unit/justified-row-geometry.test.ts:55` 8项，RED/GREEN与全量oracle | 当前构建B31.3/32.5ms、实际解码；chunked未改，不称全规模已解决 |
| 未提交渲染不推进缓存，切布局可释放 | `src/renderer/browse/use-justified-geometry-snapshot.ts:10` | `tests/unit/use-justified-geometry-snapshot.test.tsx:56` / `:76` | 当前构建两模式底部预览/返回/缩放通过；前台未执行 |
| 稳定目录外观子树复用，属性仍更新 | `src/renderer/AppearanceGlyph.tsx:17` | `tests/unit/appearance-glyph.test.tsx:53` / `:73`，mutation RED→GREEN；SVG语义 `icon.test.tsx:28` | 当前构建校准窗口Glyph2次；用户尚未确认视觉/外观编辑 |
| 不拿采样/Precise Coverage 当普通帧耗时 | `tests/e2e/cpu-profile-work-summary.ts`、`render-function-call-probe.ts`、opt-in harness | `cpu-profile-work-summary.test.ts:5` 6项；`render-function-call-probe.test.ts:124` 7项 | 实际missing/ambiguous与校准失败都保留；最终构建与独立审查已记录，非独立复测 |

## 未完成的整体范围

31–33ms P95仍不等于稳定60fps，A仍出现55ms长任务和两张未解码。Sidebar/NavRow仍有数十次重渲染，已知数据计算和事件边界仍待隔离；不能忽略callback identity或把异步drop转发到新库。视口补页已经优先复用published layout index，不应把fallback逐卡DOM扫描描述成所有虚拟滚动的现状。其他浏览器样式、原生绘制、>20k chunked几何、库生命周期/删除与长期资源占用仍需后续真实证据，不由本增量关闭。

## 后续：滚动末尾两张缺图的实际时序

没有凭一次重跑全图完成关闭缺图调查。新增仅在 `SERPENT_REAL_NAV_PROBE_PARTIAL_DECODE=1` 且普通观测末尾覆盖率不足 100% 时运行的诊断：保留原普通窗口结果，记录尚缺图片的匿名序号、扩展名、首次 immediate 上报、任务阶段；额外一秒后核对原来两张资产的同一 ID 是否仍挂载且实际解码。ID 仅在进程内关联，不写入输出。额外等待不计入普通滚动指标，不修改 90% 原测试阈值。

当前源码重新构建后的 A 旅程 **1 passed /35.5秒**：四跳九成解码769/575/659/824ms；原生四秒滚动 P95/max22.2/48.6ms、零 long task，原窗口仍23/25。两张PNG/JPG首次immediate上报相对最后远跳为6006ms，任务6032/6038ms开始、6040ms取得lease，6257/6281ms完成生成、6261/6284ms结算。即这两张在持续滚动末尾才首次被上报到即时优先级集合，上报到开始约26–32ms，处理约222/252ms；不是从最后远跳起一直排队六秒。诊断的DOM读取与后续数据库查询不是一个原子快照，查询期间二者已ready；额外一秒后同一资产均挂载并 `complete && naturalWidth > 0 && naturalHeight > 0`，视口25/25。

因此本次两张尾图不支持“任务永久卡住”或“OIIO准入阻塞”的归因，不据此改抢占规则，也不证明所有缺图都已解决。另一次直接CLI旅程全图完成只作不同观测，不当作竞态关闭证据。直接ESLint通过；`npx vitest run tests/unit/late-preview-queue-probe.test.ts` **1文件/4passed**，本次新增诊断没有产品层改动。新产物由测试owner退出后清理。
