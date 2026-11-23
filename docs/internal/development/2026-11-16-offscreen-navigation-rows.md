# 屏幕外普通目录行的渲染

工单 `Serpent-7582e4`。本增量落实浏览器按需渲染普通目录行，整体性能目标仍在进行，未提交推送。

## 证据与设计

照片源有1,045个目录行、约9,576个导航DOM节点。先前同实例预热四窗原型p95为31.4→23.5→31.3→24.0ms，保留导航结构、焦点顺序与固定几何，提示屏幕外内容存在可减的浏览器工作量。

只给普通 `NavRow` 的wrapper增加 `nav-item-row`，使用 `content-visibility:auto`，intrinsic block size引用既有 `--shell-control-height`。实际按钮固定28px，disclosure22px，不新增尺寸或颜色fallback。焦点所在行与带插入线标记的行改为visible；inline编辑与合集递归外壳不套用。这样保留DOM及现有事件/Tab顺序，并让溢出行框的焦点及插入线正常绘制。依据与限制见[CSS Containment](https://www.w3.org/TR/css-contain-2/)及[前轮诊断记录](2026-11-16-canvas-layout-measurement.md)。

实现范围为 `NavigationSidebar.tsx` 的class与 `styles.css` 的三条规则。没有引入虚拟列表组件、持久设置或新的Worker能力。

## 功能回归与检查

`npx vitest run tests/unit/navigation-sidebar.test.ts`：**44 passed / 9.09秒**。相关Renderer及E2E helper定向eslint通过。新增helper首轮lint发现一项无用初始赋值，修正后通过；主agent在执行前也修正了一个page.evaluate引用Node闭包的问题，不把这些测试代码修正描述成产品故障。

`node scripts/run-e2e.mjs tests/e2e/real-linked-navigation-perf.test.ts --reporter=line` 重建当前源码，开启 `SERPENT_REAL_NAV_PROBE_SIDEBAR_RENDERING=1`，照片源真实15,465资产的隐藏Windows Electron **1 passed / 19.0秒**，其中交互probe6,113ms：

- 1,045个linked行保留DOM；1,015个屏外auto行中，检查内部button确认961行内容处于跳过状态。检查row自身box不能证明跳过，此处用的是内部button。
- 从顶部focus倒数第二行自然进入视口，主画布位置/尺寸与导航extent保持；实际Tab到相邻行、Shift+Tab返回，中段/末段scrollIntoView位置合法。焦点行computed content-visibility为visible。
- 仅在隔离catalog中创建两个托管测试目录；F2改名取消和提交、改名后导航正常，editor及外层均visible。
- 用UI选择自定义排序，通过浏览器dragstart/dragover事件及实际React处理链激活before/after插入线；目标均visible，线高2px，越界位置保留，导航extent不变；dragleave/dragend清理完成。未执行drop、系统文件拖入或修改任何linked源，不能称作OS原生拖放完整验收。
- 最后回全部资产，25/25可见图片真实解码。

独立Luna核对实际class/CSS落点及Standards/Spec，未发现静态阻断。该审查结束时真实交互probe尚待运行，上述结果由主agent随后核对，不倒写为审查者已执行。前台按用户要求未执行，辅助技术、packaged/macOS及原用户实例同负载未验证。

## 普通负载与交叉对照

当前构建4个Renderer JS连续内容SHA-256为 `1f86c5667fe03c9198be41c55e20afc770a0670473ad3fecb185f9c726dbd1bf`。普通旅程保留轻量Renderer观察器，设 `SERPENT_REAL_NAV_PROFILE_SCROLL=0`，显式等待目录加载。媒体使用真实源；四秒连续滚动仍由程序化scrollTop推进，不等同于前台滚轮/触控板手势，不能扩大平台证据。

首轮当前构建两真实源各通过：A **1 passed / 32.9秒**，B **1 passed / 26.2秒**。相对上一轮跨构建基线，A滚动p95由19.3到20.8ms、B由46.3到50.1ms，首图/九成解码也有更慢点。它未证明稳定改善，因此没有用预热数据替代普通负载结论。结束A为23/25图片解码（92%），B为25/25，均超过旅程九成要求。

为隔离该规则本身，在**同一构建**对B做可见/auto/auto/可见四轮，每轮使用新隔离catalog，保持导入、目录前置、四跳及四秒滚动协议相同。`SERPENT_REAL_NAV_COMPARE_ROW_POLICY=1` 开启仅测试控制；可见对照用owned临时style覆盖该属性，并在观测前校验computed policy；JSHandle在finally释放，不改变产品设置。四轮均无CPU profiler/trace，串行执行，没有并跑其他测试/编译。

| 轮次 | policy | 滚动p95 / max ms | 创建可见 ms | 结果 |
| --- | --- | --- | --- | --- |
| 1 | visible | 54.3 / 65.6 | 143 | 1 passed / 26.0秒 |
| 2 | auto | 42.7 / 48.3 | 156 | 1 passed / 24.8秒 |
| 3 | auto | 50.0 / 63.5 | 152 | 1 passed / 25.6秒 |
| 4 | visible | 57.1 / 66.7 | 145 | 1 passed / 25.1秒 |

两组p95中位数55.7→46.35ms，下降16.8%；每组只有2轮，不是稳定总体分布。四跳九成解码的8个观测中位数745→701ms，但auto也出现943ms的慢点，不保证所有远跳提速。创建可见没有改善；四轮滚动均无long task，仍有明显帧间隔。每轮远跳实际位置与九成解码断言通过，结束解码为28/30、29/30、30/30、29/30；不写成全部图片已完成。

这支持保留本次局部规则，但不足以完成整体性能目标。接下来还需核实原生输入滚动，以及摘要/尺寸更新时的React重复工作和在线派生媒体等待；库生命周期、删除与原实例同负载仍未收口。

## 可追溯与清理

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 只跳过普通定高行内容，保留目录DOM和尺寸 | `src/renderer/NavigationSidebar.tsx:191` / `src/renderer/styles.css:2486` | `tests/e2e/real-sidebar-render-probe.ts:153` | 当前构建隐藏Windows Electron，961行实际跳过；前台/辅助技术未验证 |
| 焦点、跨屏键盘和定位保持正确 | `src/renderer/styles.css:2491` | `tests/e2e/real-sidebar-render-probe.ts:124` / `:209` | 实际Tab/Shift+Tab与自然focus/scrollIntoView通过；非OS辅助技术测试 |
| 编辑及插入线无containment裁切 | `src/renderer/NavigationSidebar.tsx:191` / `src/renderer/styles.css:2492` | `tests/e2e/real-sidebar-render-probe.ts:276` / `:351` | 隔离托管目录F2及浏览器拖放事件通过；原生OS drop未执行 |
| 可见图片继续解码 | 既有画布路径 | `tests/e2e/real-sidebar-render-probe.ts:88`及普通真实旅程 | 交互末页25/25，其余每轮九成以上；不证明所有资源均可解码 |

新建output/catalog在拥有的进程退出后清理，原始素材未改动。`NAV-RENDER-036`待用户确认，工单保留进行中。

收尾检查：`git diff --check`通过，相关新文件和产品/清单新增行的路径及已知隐私词增量扫描0项；不是提交前全仓扫描。最近一次 `npm run typecheck`仍只有其他CLIP轨道4项错误，extension检查未执行；本次Renderer范围没有新增类型错误。原生输入helper及其后续接线属于下一步未验证开发，不据此补写当前平台通过。

## 原生输入诊断的失败记录

追加执行同一真实导航旅程，设 `SERPENT_REAL_NAV_NATIVE_SCROLL=1`。首版使用 `Input.synthesizeScrollGesture`：B未获得滚动结果，在600秒测试上限失败；包装器墙钟602,689ms。随后自动启动的A也未获得结果，主agent核对本轮独有output、CLI的创建时间与父子关系后，仅停止该轮拥有的CLI及其两个子进程，包装器墙钟486,779ms，结果为worker意外退出。停止前检查没有Electron/Serpent进程，也没有本轮CLI的Electron子进程；没有退出点证据，不能把这次测试阻塞认定为产品崩溃，更不能推断真实鼠标滚动失效。

两次失败均无可用原生滚动测量值，不能计入上表或写成通过。为避免再次等到整套旅程超时，后续helper改用80个、每50ms一个的 `Input.dispatchMouseEvent` mouseWheel事件，并给整个输入阶段设置15秒截止；不回落到JS滚动。替代方案尚待真实Electron执行，不据单元测试签署平台结论。

包装器已清理本轮新建output，但失败旅程的两个隔离测试catalog未完成finally清理。确认进程退出、目录归属及无reparse后，自动审批仍在派发前拒绝删除，唯一原因是“blocked by policy”。删除未执行，两个测试catalog保留；禁止更换工具或路径写法绕过本次拒绝。它们与只读媒体源分离，未删除或修改原始素材。本记录不包含真实路径、名称或临时目录标识。

### 替代输入的实际结果

后续helper将首次几何读取、全部派发及末次位置读取一起纳入15秒截止，并阻止超时后继续发送迟到事件。`npx vitest run tests/unit/native-canvas-scroll.test.ts` **6 passed**，包含首/末evaluate和CDP请求挂起；helper与单测两文件定向ESLint通过。

复用本节相同当前产品构建，`node node_modules/playwright/cli.js test tests/e2e/real-linked-navigation-perf.test.ts --reporter=line`，B开启 `SERPENT_REAL_NAV_NATIVE_SCROLL=1`、等待目录、关闭CPU profiler，**1 passed / 26.2秒**。真实15,465资产、1,045目录行；80个浏览器mouseWheel事件用时4,101ms，实际滚动1,600px，起止范围合法；帧p95/max为38.6/57.4ms，末页29/30张图片解码。四跳九成图片解码为1,041/676/587/1,094ms，创建可见184ms。仍有慢点，不能把单轮或不同输入方式的数值算作新的对照提速。

本次确认的是隐藏Windows Electron中的CDP浏览器滚轮事件，未操作前台、OS鼠标或触控板；不替代物理输入/辅助技术验收。新一轮自有catalog/output正常清理；前述两个被拒绝的目标仍保留且未重试删除。旧版失败记录不撤回，整体性能目标继续。
