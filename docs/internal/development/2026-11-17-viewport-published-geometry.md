# 可见窗口上报复用虚拟布局几何

关联 `Serpent-f4622e` 与总体 `Serpent-3kfe`。用户要求当前增量验证收口后停止继续优化；不提交或推送，不把整体目标标为完成。

## 设计和实施

复用既有 `CanvasAssetLayoutIndex` 的发布机制，两种虚拟布局直接导出既有 rectAt 闭包，不建立整库矩形数组。collector 仍遍历挂载候选，按槽索引和资产身份确认发布几何，只保留本次调用的 grid 原点；匹配的内层卡片复用外槽判定。提前排除占位，旧发布、身份不符、交叉或贴近视口边界时回退实际 DOM。

平铺外槽与行使用同一 bodyHeight，内部卡片、preview、caption、间距与 overflow 不变。明确的空间行为修正是空真资产槽及外槽透明尾段拥有行已保留的高度；不能宣称零高空槽的命中范围保持原样。完整方案与验证要求见[设计](../implementation/2026-11-17-viewport-published-geometry.md)。

Luna实施者实际执行 `npx vitest run tests/unit/viewport-priority-report.test.ts tests/unit/virtual-browse-canvas.test.ts tests/unit/virtual-browse-canvas-dom.test.tsx`：**3 files /23 passed**。覆盖真实虚拟索引、严格边缘、空槽、占位替换、offscreen内层重复候选、旧/身份变更/混合发布回退，以及真实React组件原位替换。不是浏览器布局或人工视觉证明。

## 测量工具与对照约束

专用探针 `viewport-report-geometry-probe.ts` 包装原型矩形读取，只输出画布/grid/槽/卡片计数；parity模式同步在可见报告事件中运行旧DOM参考算法并比较顺序/遗漏/额外项，checkpoint独立比较稳定后的当前DOM与最近报告。内部ID最多300项、无文件名/URL/路径输出。计数模式不执行参考DOM循环；正确性分支与普通FPS窗口分开。

探针定向happy-dom **2 passed**、两文件ESLint通过；主agent发现测试用额外参数直接调用DOM方法会违反原生TS签名，改为Reflect.apply保留参数转发测试意图。最后统一门禁及实际旅程结果尚待写入，不提前记绿。

首次启动控制被运行中的开发实例保护拒绝，尚未创建该次测试catalog；按用户既有授权仅结束核实的工作区Electron与Forge祖先进程。不能沿用被开发启动覆盖的编译产物，因此重新构建控制：保存候选三文件，恢复本轮前原内容构建两源，finally恢复候选，再重建候选测试。没有worktree或跨检出依赖；临时控制脚本仅属于本轮，最终须在owner终止确认后清理。

## 真实计数对照（已完成）

同一native GPU稀疏捕获、无CPU/trace/stage/AI阻塞注入，80次20px wheel实际1,600px，当前源码控制与候选各重新构建。两轮A/B共四旅程passed；内外输出均owner终止后清理。矩形计数不运行参考DOM循环。

| 源 | DOMRect总读取：控制→候选 | 槽/内层卡片：控制→候选 | 帧P95/max(ms)：控制→候选 | 末页解码 |
| --- | --- | --- | --- | --- |
| A 28,930项 | 15,423→804 | 10,330/4,800→455/0 | 12.4/40.6→10.9/29.2 | 两次均25/25 |
| B 15,465项 | 20,978→814 | 11,185/9,515→470/15 | 23.3/38.1→19.9/37.5 | 两次均30/30 |

总读取下降94.8%/96.1%，仅证明对应冗余实际消除；两边虽然使用同一探针，旧路径更多读数也带来更多探针开销，所以不能单凭这张表认定无插桩帧率收益。四次远跳九成A874/828/704/947→1045/657/565/833ms、B721/690/668/739→676/602/588/625ms，保留A冷首跳反向慢点；创建80→81、157→135ms。没有全指标一致改善结论。

控制Renderer `7ea5b4bc9780aa7628b89b0c1002465d46ee6c285daaf3d1d327c045249b2ec6`，候选 `98c4582b4c654cd5b9d7f33d174fe22b2142fbf0fcd7a936ba0cf387f4dabae5`；Worker均 `f1d3c083aa5b80e420d78db855960d975033e0fde758fb6bf80a19d63c76081e`。两边均校准非1Hz，窗口隐藏、GPU enabled、offscreen=false，capture frameEvents正数/ack0并显式停止。

## 稳定检查发现的挂载通知缺口（已修复，待人工验收）

独立parity连续两次在四次远跳后回到缓存的平铺顶部失败：参考25项、最后上报25项，却缺25/多25；此前同步报告32次、825个比较项全部一致。说明失败不能简单归为几何数学错误，也不能用重跑通过关闭。

第三次保持产品相同，失败时仅合成一次scroll通知，实际scrollTop前后均0，160ms后同步报告33→34、checkpoint缺/多25→0、同步比较仍无差异。测试继续对原失败断言而保持failed，未用诊断干预冒充通过。三次自有catalog/output退出后清理。可见上报只由scroll与父布局依赖调度，缓存窗口仅子组件换挂载成员时，早先report可能看到旧挂载窗口；新窗口commit后没有后继通知。

当前增量补独立的挂载commit通知，保持WeakMap几何发布纯函数；两种虚拟窗口index/range提交后通知canvas，App与原scroll共同走80ms coalescer，cleanup解绑。无全库ID报告、无永久轮询或原生scroll伪造。禁用两处notify的新组件用例稳定RED（DOM已变化而通知缺失），恢复后相关三文件24GREEN。

独立审查另指出child layout effect与旧App passive listener清理之间的排队边界。App复用已有library view的ID+generation；coalescer在request和tick消费deadline前检查owner，过期帧既不上报也不抢新窗口的80ms预算。临时去掉guard，切库/同ID重开/切走再返回三例全部RED；恢复后通过。未改Main、Worker、协议、schema或资源库生命周期。

## 最终验证与停止点

最终 `npx vitest run tests/unit/viewport-priority-report.test.ts tests/unit/virtual-browse-canvas.test.ts tests/unit/virtual-browse-canvas-dom.test.tsx tests/unit/coalesced-frame.test.ts tests/unit/viewport-report-geometry-probe.test.ts`：**5 files /34 passed /1.53秒**。定向ESLint **0 errors /1旧AI依赖warning**；probe dispose的Playwright泛型新类型错误已修，最后 `npm run typecheck` 仍仅既有CLIP四项（Worker111/113、测试31/86），不写全仓通过。相关tracked文件 `git diff --check` 通过，仅LF/CRLF提示。没有运行无关后端、全量或发布门禁。

通知版 `1336118…` 重建计数两源分别812/808次（原15,423/20,978），P95 12.1/20.8ms、末页25/25与30/30，说明加通知没有恢复测量风暴。后续仅加owner保护，不改变几何算法；该次读数注明属于通知版，不冒充最后hash的独立计数样本。

### 关闭矩形计数的普通对照

`SERPENT_REAL_NAV_REPORT_GEOMETRY=off`，无CPU/trace/stage，保留同一native稀疏捕获。控制恢复原三条执行路径，通用App监听与owner fence两侧共用（旧组件不emit），不称原完整HEAD。控制A/B **32.4/26.6秒passed**，最终候选 **29.5/25.5秒passed**，每轮实际80次wheel/1600px，均0长任务、末页25/25及30/30实际解码。

| 源 | P95/max(ms)：控制→最终候选 | 四跳九成(ms)：控制→最终候选 | 创建可见(ms) |
| --- | --- | --- | --- |
| A | 10.9/33.0→10.5/25.9 | 829/661/541/812→799/637/502/801 | 77→64 |
| B | 21.3/34.5→21.9/35.7 | 719/837/598/563→634/653/571/585 | 150→136 |

**无稳定帧率改善结论**：B帧与末跳反向，空校准P95也由约6.0变7.1ms，不把单次微小差异当因果收益；这是隐藏带捕获模式，不等于普通前台FPS。保留优化的确定成果是消除重复矩形测量并修复上报新鲜度，而非整体性能目标达成。

### 最终两种布局与实际解码

前一通知版parity虽几何比较通过，测试首个decode poll可能读到旧窗口，部分checkpoint出现0decoded；因此该轮不能证明媒体通过。已补提交等待后的第二次poll和最终coverage断言，最终候选重新执行，未开启诊断rearm：A **1 passed /29.6秒**，48次同步报告/1,180比较项全部0差异；B **1 passed /23.3秒**，43次/953项全部0。两源各平铺/瀑布流顶部、中段、底部6个checkpoint全部0遗漏/额外/顺序差异；各点实际解码均≥90%。A依次23/24、30/30、30/30、22/23、25/25、9/9；B依次25/25、20/20、20/20、21/21、21/21、20/20。不能把几何项数与图片项数混同。

最后控制Renderer `16f8db4c8547e74fa8dd609b846a53873a37cbf066bc40a3f2c1155b8fe157e5`；最终候选plain与parity均 `8871687329288078e2bf698733704ffb14aa324dc8e262bc8804c4c9204839f6`，Worker仍为上文同hash。最终两源GPU enabled、offscreen=false、窗口隐藏，capture15/11帧、ack0并停止。每次本轮新建catalog/profile/output均退出确认后清理；自有控制脚本亦已删除。最终工作区Electron为0，仅先前两项已记录的清理受阻catalog保留，未重试或误删。只读源未执行写入/删除操作。

| 需求 | 实现位置 | 自动化证据 | 人工/平台证据 |
| --- | --- | --- | --- |
| 复用有界几何且保留挂载/顺序/边界/旧发布回退 | `viewport-priority-report.ts:24`、`canvas-asset-layout.ts:79` | collector直接用例、两源读取对照、最终91次同步报告/2133项0差异 | 隐藏Windows；普通前台/packaged/macOS未执行 |
| 空真ID槽与已发布布局同高，不改内部卡片 | `browse/virtual-browse-canvas.tsx:69` | DOM空槽/替换、两布局各三位置、每点实际解码≥90% | caption开关/缩放/视觉与选择需人工确认 |
| 缓存窗口commit后重新上报，80ms合并 | `canvas-layout-commit-signal.ts:1`、虚拟组件`:883`/`:1047`、App`:3303` | 同index成员变化mutation RED/GREEN；真实旧窗口三次失败/仅通知干预定位，最终全部checkpoint0 | 不以重跑绿关闭旧失败；最终无诊断干预 |
| 过期库owner不发报、不消费共享deadline | `coalesced-frame.ts:13`、App`:3303` | 三种owner变更mutation三RED→GREEN，默认节拍/取消回归仍过 | 当前并发切库的独立进程E2E未跑，静态绑定与直接测试证据 |

用户要求完成当前增量后停止；本轮到此收口，不开展新性能方向、不提交推送。新清单 `CANVAS-VISIBLE-045` 为待人类验收，不能自签accepted；真实前台按用户要求未操作。总体 `Serpent-3kfe` 的远跳、滚动、真实proxy/色卡吞吐、生命周期、删除重排及长期内存尚未整体达标，按用户要求暂停，后续不自动推进。
