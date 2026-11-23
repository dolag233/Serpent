# 尺寸探测跟随当前多窗口视口

本轮 `Serpent-00a35e`。基线为前一轮 header 共享、Renderer 完成投影收敛后的当前工作区，整体性能工单 `Serpent-3kfe` 继续进行。前一轮记录见 [冷可见页尺寸](2026-11-16-cold-visible-image-dimensions.md)。本轮不更改原图直出阈值、解码并发、媒体管线或 Renderer 版本化帧队列。

## 当前证据与待验证问题

独立尺寸队列 `index.ts` 以 Set 追加 ID，每批先取最多16项，再 await service 整批完成。service 两个消费者读取剩余候选时没有视口相关性检查。新窗口只追加在旧未领取集合后，确实存在过期读取结构；尚不能把它称作已测明的全部跳转延迟根因。

Luna 只读分析确认可复用 `ViewportPriorityOverlay.immediateAssetIds`：它合并所有 consumer 的 focused / visible。当前 handler 只传该请求自己的 visible IDs，且 legacy 相同可见集合的早退前没有更新尺寸任务；新 focused band 仍可能需要探测。不能按单个报告 generation 取消其他窗口仍需要的资产，也不能取消共享底层 read。

## 真实快速跳转基线

为既有真实源隐藏 Electron 旅程增加 opt-in `SERPENT_REAL_NAV_BURST_JUMPS=1`。在原四跳和连续滚动/文件夹创建测量之后，再依次远跳 12%、31%、62%、43%、73%、92%、17%、67%，每次 await 页面调用后间隔100ms。实际末次跳转偏移也记录，不能把通信和渲染耗时当成固定700ms。

运行：设置 `SERPENT_REAL_NAV_SOURCE_ROOT`、`SERPENT_E2E_HIDE_WINDOW=1`、`SERPENT_REAL_NAV_TRACE_STAGES=1`、`SERPENT_REAL_NAV_BURST_JUMPS=1`，`node scripts/run-e2e.mjs tests/e2e/real-linked-navigation-perf.test.ts`。输出位于本次专用新临时根，生命周期结束 finally 清理，不触碰此前清理被策略拒绝的目标。

当前未优化 FIFO 版本 **1 passed，32.6s**，28,930项真实素材只读链接，隔离 catalog / userData：

| 指标 | 基线 |
| --- | --- |
| 八跳开始至末跳 | 1229ms |
| 末跳首图 / 九成显示 | 374 / 791ms |
| 观测总时长 | 4275ms |
| 末页真实解码 | 30/30，100% |
| 实际末位置 | 0.670240，距目标小于0.01 |
| header读取 | 175次，p50 25.11ms、p95 60.34ms、累计5144.30ms |
| header准入等待 | p50 11.77ms、p95 47.95ms |
| metadata文件写 / 数据库写 | 182次，各累计102.34 / 236.36ms |
| 浏览请求 / 结果 / 页面 | 各8次 |
| burst帧间隔p95 / max | 29.9 / 52.7ms |

这些读取涵盖中间短暂可见的页、primary与独立尺寸两条消费者；175减去末页30不能直接解释为过期I/O数量。下一步用确定性 gate 证明准入时已经不相关的旧项仍被领取，再实现替换与动态检查并重跑真实对照。没有为了制造卡顿关闭缓存或加人造慢盘；门控只用于小范围调度正确性测试。

## 方案边界

保留每库单一 drain，把未领取集合替换为所有 consumer 当前 immediate union；已交给 service 的候选领取前与读完后检查动态 wanted predicate。旧候选可以跳过，但已开始的共享I/O不被另一个调用者取消。沿用单次drain两消费者、每库三读取、全局四读取；关闭 / 重开沿原 controller 与 OpenLibrary 身份收口。不得另起并行drain抢占旧任务留下的名额。

最初拟验证：两个consumer更换其中一个后仍服务另一个；focused变化但visible不变；旧在途完成变过期时不落库/发布、旧未领取不读；相关性在读完前恢复时正常完成；同修订单飞、取消及关闭重开不回归。最终结果见下文，不将自动化或独立审查写成人类验收通过。

## 确定性复现与实现进度

先执行红测 `node scripts/run-vitest-with-electron.mjs run tests/worker/visible-image-dimension-probes.test.ts --disableConsoleIntercept -t "does not persist or publish a header result after its candidate is no longer wanted"`，**1 failed / 13 skipped**。测试通过局部类型断言传入拟新增的第五个相关性参数，旧函数运行时忽略它。先断言读头正好开始一次，保持 gate；把 wanted 改为false后释放。旧实现返回一个尺寸结果、发布一次并写入一个 metadata 工件；要求为0/0/0。它证明新要求在旧实现中缺失，不依赖慢盘抖动；不冒充已经触发桌面用户手势的同一时序。夹具由现有afterEach清理。

随后在 service 领取每个候选前及共享read await后增加动态相关性检查。底层单飞、全局/每库 admission 不传调用者取消信号；已领取的读取可能还在共享semaphore中等待，不宣称能单独取消该read。handler 在accepted overlay后、legacy早退前更新所有consumer的immediate union。Worker入口改为单个可替换待领取集合的coordinator，库关闭仍停止旧实例；纯coordinator与Worker/handler测试分别由Luna实现，主agent负责接线与service。

## 最终验证

| 命令 | 结果 |
| --- | --- |
| `npx vitest run tests/unit/visible-dimension-probe-coordinator.test.ts` | 8 passed；替换未领取集合、动态wanted、共同成员、单drain、stop/join、失败继续、同步拒绝/onIdle重入及batch参数。 |
| `node scripts/run-vitest-with-electron.mjs run tests/worker/visible-image-dimension-probes.test.ts tests/unit/visible-window-handler.test.ts --disableConsoleIntercept` | 2 files / 21 passed，含原13项；旧候选不读/不发布、另一consumer保留共享读、相关性恢复、多consumer union、focus-only及stale report。 |
| `npm run test:library-availability` | 9 files / 238 passed / 1 skipped，109.19s；Electron ABI / FTS5 probe OK。 |
| 临时目录、20,000项mixed、seed20261116；Electron wrapper依次执行fixture-generator与large-library-performance | 生成1 passed（67.67s），基线3 passed（13.63s）；专用fixture finally已清理。 |
| 本轮四个产品文件及五个测试文件定向ESLint | 零错误、零警告。 |
| `npm run typecheck` | 仍有其他文档格式开发四项既有错误，本轮文件无新增错误；不能声明全仓绿。 |
| 当前源码重新构建，真实源隐藏Electron，启用burst与既有重复通知探针 | 1 passed，36.2s；所有跳点目标位置及真实解码覆盖断言通过，末页30/30图片解码。隔离库和本次专用新输出finally清理。 |

20k Worker基线：startup10.6ms、全部浏览11.8ms、文件夹0.5ms、合集5.2ms、递归合集41.7ms、递归布局87.8ms、搜索15.9ms、layout109.8ms、Inspector0.4ms；完整对账2895.8ms，viewer resolve p50/p95/max为1.8/3.5/6.5ms，109样本，事件循环间隙p95/max为1.6/91.1ms。远端metadata snapshot4569.5ms、cached open579.2ms。deleteRefresh仍为null、未覆盖；Worker数字不代表完整UI或删除刷新已达标。

### 真实快速跳转前后

两版都是同源、全新隔离库、相同八个跳点，每版一次，串行执行且没有并行压测；首轮为修改前、次轮为当前源码。场景参数相同，但每次重建库和渐进尺寸补齐不保证完全相同的末页成员；不能把一次差值当作稳定提速倍数。

| 指标 | FIFO基线 | 当前相关性调度 |
| --- | --- | --- |
| 八跳至末跳实际偏移 | 1229ms | 1169ms |
| 末页首图 | 374ms | 238ms |
| 末页九成显示 | 791ms | 682ms |
| header read次数 | 175 | 119 |
| header read累计 | 5144.30ms | 4041.78ms |
| header admission p50 / p95 | 11.77 / 47.95ms | 0.09 / 24.24ms |
| header admission累计 | 2553.13ms | 435.50ms |
| metadata写入次数 | 182 | 117 |
| burst帧p95 / max | 29.9 / 52.7ms | 27.1 / 59.2ms |
| 末页实际位置 / 解码 | 0.670240 / 30/30 | 0.670202 / 30/30 |

本场景header读取约少32%、metadata写入约少36%；确定性单测独立证明过期候选没有被领取，而不是凭175减30猜测。单次末页首图和九成等待下降，帧最大值反而增加；不宣称整体帧率稳定提升。普通四跳九成显示1108/623/487/807→723/717/549/829ms，仍有三处更慢，不能据此宣称所有跳转都加速。当前连续滚动四秒新增35个地址、帧p95 18.9ms，创建可见110ms；重复通知探针仍为十次0请求、真变化1请求。

### 审查与保留项

单一Luna独立双轴审查没有发现本范围可证实的正确性阻断或规格偏差。active ID仍可被update放回pending，这是有意保留“曾跳过后重新需要”的语义；成功metadata会在下一轮查询过滤，未知尺寸/失败文件可能随报告重试，尚未量化为性能回归。只丢弃本调用者不再需要的结果，不撤销其他consumer的共享I/O。

用户不要求Computer Use，前台未执行；packaged/macOS、升级后的原库同负载未执行。新自动化产物已在各自生命周期清理；前轮已被自动策略拒绝的目标未触碰。`Serpent-3kfe`整体目标未完成，本工单等待用户体验验收，不提交或推送。

本轮新增文件与tracked新增行隐私扫描无命中；`git diff --check`通过。最后只读核查本次真实catalog、mixed fixture与burst输出的专用临时根数量均为零。新增验收项`PREVIEW-LATEST-028`为待人类验收，没有关闭工单。

## 四列可追溯

| 需求 | 实现位置 | 自动化测试 | 平台 / 人工证据 |
| --- | --- | --- | --- |
| 未领取集合跟随当前多consumer需求，焦点变化也更新 | `src/worker/handlers/visible-window.ts:104`；`src/worker/visible-dimension-probe-coordinator.ts:38` | `tests/unit/visible-window-handler.test.ts:101`、`:177`；`tests/unit/visible-dimension-probe-coordinator.test.ts:17` | 真实源8连跳前后各1 passed；前台未执行。 |
| claim前/读后过期项不读或不落库/发布，其他consumer共享读仍继续 | `src/worker/library-service.ts:26224`、`:26229` | `tests/worker/visible-image-dimension-probes.test.ts:607`、`:639`、`:661`、`:755` | Electron Worker确定gate，21项通过；真实慢盘取消时间未覆盖。 |
| 单drain、关闭与重开隔离 | `src/worker/visible-dimension-probe-coordinator.ts:52`、`:70`；`src/worker/index.ts:1640`、`:1676` | `tests/unit/visible-dimension-probe-coordinator.test.ts:74`、`:192`、`:211`；`tests/worker/visible-image-dimension-probes.test.ts:785`及2/3/4回归 | 库可用性238 passed/1 skipped；packaged/macOS未执行。 |
