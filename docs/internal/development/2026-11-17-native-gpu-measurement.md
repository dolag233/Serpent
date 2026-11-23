# 隐藏原生窗口与 GPU 性能测量

关联 `Serpent-21e80c` 与总体性能 `Serpent-3kfe`，当前为测量增量，不是产品提速结论。基线是当前维护者分支累积工作树，未提交推送。

## 原因与计划

此前真实素材旅程明确测得 `hardwareAccelerationEnabled=false`、`offscreen=true`、`gpuCompositing=disabled_software`。CDP wheel 仍真实驱动浏览器滚动，素材也实际解码，但这种软件离屏帧耗时不能直接代表用户原生 GPU 窗口。因此先建立不抢前台的显式测试模式，再以同产品实测热点决定优化。

新增模式只对 `SERPENT_E2E=1` 且 `SERPENT_E2E_RENDERING_MODE=native-gpu` 生效：保留平台正常 GPU 选择，主窗口非 offscreen，关闭 background throttling，仍由现有 hide-window 门禁保持隐藏。普通 E2E 的稳定软件路径、显式 SwiftShader 和 production 行为保持原契约；不调用 show/showInactive/focus。软件 GL 冲突需提前报测试设置错误或由运行时断言明确拒绝，不能静默以软件结果宣称硬件。

真实运行需同时记录硬件加速开关、实际 GPU composition、offscreen、backgroundThrottling、窗口可见性及 document visibility；请求 native-gpu 时校验前五项。隐藏原生窗口仍非用户前台完整 compositor/OS 输入证据，不把 rAF 间隔说成已显示到屏幕的像素 FPS。性能比较必须在相同模式下进行，不用切模式造成的分数变化冒充产品优化。

先复用已有真实远跳/原生 wheel 旅程、隔离 catalog/profile 和有界清理。源 A 28,930 项、B 15,465 项，只读原文件；B 1,045 导航行，先确认该树确实加载。测量完成后按实际瓶颈继续，不将本项替代 proxy/色卡、退出/切库、删除重排及长期内存要求。

## 实施与验证

Luna 负责小型策略 helper、Main 接线和直接单测，主 agent 负责串行真实 Electron 与归因；不并跑性能测试、lint 或类型检查。当前实现与实测尚未完成，不标门禁绿或新增人类验收。没有更改资源库操作、协议/schema/迁移或 Worker，不运行无关后端套件。

### 已落地的测试策略

新增 `src/main/e2e-rendering-policy.ts:19`，Main在`:571`、`:627`、`:2248`复用，只有未打包且E2E显式native-gpu生效；普通默认、offscreen与SwiftShader保持原规则，软件GL冲突明确拒绝。launcher按最终有效环境拒绝前台显示与软件路径，强制hide且禁止showInactive。真实旅程采样还读取windowVisible/documentVisibility，GPU enabled连续三次才开始，不把单次过渡状态当硬件结果。

Luna实际执行 `npx vitest run --config vitest.config.ts tests/unit/e2e-rendering-policy.test.ts`，最终9/9 passed。root审查发现Pick索引键会把部分env入参变必需，已改Partial并由Luna重跑；没有等整体类型错误出现后再隐去。完整类型与lint尚待本轮最终实测结束后运行，不与性能测试并发。

### 原生隐藏窗口的失败与帧时钟校准

首个当前构建A旅程失败；外层最初只保留成功和部分错误前缀，缺少具体阶段，不能从失败推断产品根因。随后仅增强测试的清理前匿名phase/viewport/matcher诊断，同一产品构建再次失败在 `jump-0.05`：两秒25张可见卡片、24图片、0解码，仍有库身份与画布；后续观测到约5.15秒29/29解码，不能写永久饥饿。未把后面的补齐改写为两秒断言通过。

该轮request/page首个577/607ms、首次实际可见约644ms，immediate报告约1581ms、bind约2609ms，后续一组约4603ms；网络headers多为16–79ms，图片任务也实际完成，时序出现近一秒档。由此建立独立空Renderer时钟校准，而非据此修改生产预览逻辑。

`SERPENT_REAL_NAV_PROBE_FRAME_CLOCK=1`进入专用校准分支，不导入媒体，结果标签明确为`empty-renderer-frame-clock`，不是完整真实素材旅程。实际 **1 passed /12.4秒**：hardware=true、offscreen=false、backgroundThrottling=false、GPU composition=enabled、windowVisible=false、documentVisibility=visible；四秒只有3个rAF间隔，P50/P95约1000ms，但50ms timer有80次。绑定native view后再调用setBackgroundThrottling(false)，仍是四秒3间隔/约1000ms、timer80次。这证明当前隐藏原生模式的帧时钟不足以测量500ms交互，不能把documentVisibility=visible等同正常画帧，也不能把这次慢点称用户前台回归。

两次失败及本次校准内外新产物清理都成功。编译Renderer仍为 `7ea5b4bc9780aa7628b89b0c1002465d46ee6c285daaf3d1d327c045249b2ec6`，Worker仍为 `f1d3c083aa5b80e420d78db855960d975033e0fde758fb6bf80a19d63c76081e`，产品图像/调度代码未变。B真实GPU旅程尚未执行，不能以空时钟passed代替它。

### 原始资料与后续实验边界

[Electron窗口文档](https://www.electronjs.org/docs/latest/api/browser-window)区分原生窗口可见性与页面visibility；[offscreen文档](https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering)区分软件输出与GPU bitmap路径。官方历史[Windows隐藏节流问题](https://github.com/electron/electron/issues/31016)已关闭，不能直接宣称当前同因；本机的四秒校准才是本轮证据。

核对[43.1.0实现](https://github.com/electron/electron/blob/v43.1.0/shell/browser/api/electron_api_web_contents.cc)的SetBackgroundThrottling与后续[43.4.1隐藏WebContentsView修复说明](https://releases.electronjs.org/pr/52864)，仅作为隐藏view/compositor边界的线索，没有升级Electron或声称该修复必然解决当前BrowserWindow。下一项是在空界面用[CDP startScreencast](https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-startScreencast)的1像素捕获维持绘制，立即ack且不保留/输出图像，验证捕获态是否恢复正常frame cadence；仍不show/focus。即便有效，捕获会引入仪器开销，需明确模式及控制开销，不能称普通前台FPS。

## 捕获校准的反证与最终测量口径

1像素捕获的空界面四秒校准确实恢复正常rAF：一次582间隔/P957.1ms，另一次677间隔/P956.0ms；第二次stop/off/detach后连续四秒仍680间隔/P956.0ms、窗口隐藏。由此尝试一次性初始化后停止，但实际接入在首帧即stop的1200ms窗口只得到3间隔/P951000ms、末帧距178ms，测试在导入源前失败。该反证推翻了一次性初始化足够的假设；没有保留这个失败flag或用延长解码截止来通过。

最终只在显式 `SERPENT_E2E_NATIVE_CAPTURE_KEEPALIVE=1` 的native-gpu测试中保持1像素、每30帧的稀疏捕获；不记录或输出帧data。正式导入前用1200ms空界面clock同时检查帧间隔数、P95、首帧延迟和末帧年龄，排除1Hz环境。捕获在全部观测后stop/off/等待ack/detach，并核对最终窗口仍隐藏。该模式明确标为 `native-gpu-with-one-pixel-sparse-capture`，不是未经仪器干扰的前台FPS。没有改变生产GPU/RAF、没有添加Chromium帧率开关，也没有升级依赖。

采样器首帧延迟最初直接减rAF提供的帧时间戳，出现过-0.7ms；帧起点可早于回调注册时刻，因此已改用回调内performance.now记录首/末实际运行时刻。相邻帧间隔仍使用rAF timestamp。该修正不把旧负数写成真实负等待。

Luna抽取复用捕获controller，正常参数、首帧、start失败清理、stop失败仍释放、幂等stop、first-frame超时后清理与Nth30参数最终7项通过。主agent加Paint/Layerize/CompositeLayers trace指标并扩展原fragmented JSON断言；初次误将1.25ms事件的histogram P95写为1.25，现按既有半毫秒bucket明确期望1.5而保留max1.25。最终相关policy/capture/trace三文件 **24 passed /234ms**。不是产品RED，不据此修改产品性能预算。

## 真实源与热点证据

两源当轮均使用GPU enabled、offscreen=false、background=false、windowVisible=false；空校准约201–202间隔/1200ms、P956ms。每次应用正常退出及owner输出清理成功。期间检测到维护者重新启动开发实例，按既有授权仅终止核实的工作区实例与Forge祖先进程，重新构建E2E后才继续，未混用可能被开发启动替换的产物。Renderer/Worker内容hash仍是上文两项。

| 旅程 | 实际结果 | 滚动证据 | 图片与限制 |
| --- | --- | --- | --- |
| 当前A普通native稀疏捕获 | passed | P95/max16.4/60.2ms、1次56ms long task；80次wheel实际1600px/4217ms | 四跳九成789/614/624/853ms，末页25/25；捕获19帧/0ack失败，创建141ms |
| 当前B普通同模式 | 1 passed /32.7秒 | P95/max28.0/44.6ms，0long task，80次wheel实际1600px/4050ms | 最后跳九成1042ms、末页25/25；首三跳及捕获精确计数因外层重复输出截断未保留，不填0或借后轮补写 |
| B另一次CPU采样诊断 | 1 passed /31.7秒 | P95/max26.7/44.6ms、0long task，1600px/4080ms | 四跳852/641/631/879ms、末页25/25；捕获17帧/0ack失败，创建82ms；采样器开销不与普通帧做提速A/B |
| B另一次native layout trace | 1 passed /33.0秒 | P95/max20.5/38.5ms、0long task，1600px/4061ms | 四跳887/506/612/1234ms、末页25/25；捕获19帧/0ack失败，创建114ms；不拿最后较快帧覆盖前面慢点 |

CPU profile完整3784样本、无坏引用/截断；其中program2211、idle1018，其余约554为脚本样本。采样间隔之和不是CPU时间，不能说program的约2.54秒全是计算。JS包位置已对照当前hash的实际片段：平铺虚拟画布及其行/slot构造、App卡片render callback在栈中，另有getBoundingClientRect/querySelector；尚无单一JS根因结论。

四秒trace完整24,246,558字节/89,411事件，无data loss/omit：UpdateLayoutTree495次/360.24ms，Layerize537次/407.67ms，Layout61次/34.36ms，Paint2098次/144.12ms，PrePaint842次/42.65ms。事件可能嵌套，不能相加成总CPU；CompositeLayers此版本0观测不证明无合成成本。画布/虚拟grid记录到重复几何读取，但不能用它们存在就认定大部分style强刷由这些读取造成。

## 同源侧栏因果控制与尚需对齐的历史状态

复用既有content-visible/hidden/visible/hidden四窗口，补为同一native wheel而非程序化scroll，无Profiler/trace，canvas client尺寸完全不变。该轮1 passed/38.7秒，DOM11,009节点、Nav9,584节点、1,046目录行，四窗图片均30/30解码，P95分别 **11.6/13.7/10.7/11.9ms**，捕获34帧/0ack失败且窗口隐藏。隐藏侧栏没有改善，不能依据此前软件offscreen的隐藏收益立即做目录树虚拟化。

这条probe在四次远跳前执行，且旧窗口counter包含quarter复位；普通28ms窗口发生在四次远跳后。原函数已在末尾解码等待前读取renderer，先前对这一点的怀疑经源码核对排除，不把末尾解码说成现有混入项。两者历史和计数边界仍不等同，因此追加下述对齐观测。不同几何完成度还可能改变quarter对应资产，未固定同一cohort时不直接推导缓存随历史增长。

### 对齐历史后的控制与收尾

`SERPENT_REAL_NAV_PROBE_STYLE_SENSITIVITY_AFTER_JUMPS=1`、native wheel、稀疏捕获、无CPU/trace，实际 **1 passed /46.8秒**。四跳九成863/545/558/1166ms后，复用原probe的暖路段，在每次起点九成解码后reset，仅计80次wheel。DOM12,293，导航9,584，画布2,488，挂载200卡；四窗口均实际1,600px、30/30解码、canvas尺寸不变。可见/隐藏/可见/隐藏P95 **12.0/13.9/11.5/13.2ms**、max17.5/19.1/15.6/17.1，均0长任务。捕获41帧、ack0、最终仍隐藏，退出后清理成功。仍不支持把侧栏作为该路段首要根因，不据此开展大范围导航虚拟化；暖重复窗口也不能代替首次冷路段。

另一次只关闭stage诊断、保留相同产品和native捕获的普通B旅程 **1 passed /30.5秒**：四跳783/565/571/1169ms，创建62ms，滚动1600px/4036ms，P95/max20.1/31.2ms、0长任务、末页25/25；捕获18帧/ack0、清理确认。单点不证明stage诊断贡献全部差异，也不算产品提速。

最终 `npm run typecheck` 失败，仍仅既有CLIP的四项错误（Worker 111/113、测试31/86），没有隐去全仓失败；本轮变更文件定向ESLint通过。相关24项直接单测结果见上文。所有本轮新建真实旅程内外目录均由owner脚本在子进程终止确认后删除，历史归属/审批受阻目录未碰。

| 需求 | 实现位置 | 自动化证据 | 人工/平台证据 |
| --- | --- | --- | --- |
| 显式测试模式保留GPU、隐藏、非offscreen | `src/main/e2e-rendering-policy.ts`、Main入口、`tests/e2e/perf-bench-helpers.ts` | policy9项及两真实源runtime断言 | 隐藏Windows43.1.0；前台/packaged/macOS未执行 |
| 隐藏帧时钟先校准，仪器必释放 | `tests/e2e/hidden-native-frame-clock.ts`、`hidden-native-surface-capture.ts` | capture7项；真实preflight、ack0、停止/隐藏断言；失败反证保留 | 不是普通前台FPS |
| 根据实际热点再改产品 | `tests/e2e/canvas-layout-work-probe.ts`、style probe及真实旅程 | trace8项；真实trace及两种历史的显示/隐藏控制 | 本项没有新增产品提速，整体目标未完成 |

下一增量 `Serpent-f4622e` 检查固定节拍可见上报对槽/卡片的重复DOM矩形测量，复用已发布的虚拟几何；根因范围、边界回退及真实DOM参考比较见对应方案。不把该候选提前写成性能改善。
