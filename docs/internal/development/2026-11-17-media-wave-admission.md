# 可见预览不再等待整波最慢任务

关联整体性能目标 `Serpent-3kfe` 与迟就绪调查 `Serpent-fe5da4`。本轮是局部调度改进，不代表整体性能、长期内存或用户当前库已验收。

## 原因与方案

设计与原始匿名时间线见[实施说明](../implementation/2026-11-17-media-wave-admission.md)。同一成员集合仅调整阅读优先级时，sorted-set key 保留了旧 CASE 参数，是独立的排序错误；改成有序 key、同长度 SQL 复用后受控排序回归通过，但真实 ARW 迟就绪仍存在。

后续真实场景证明五张 ARW 约 0.64 秒已经在可见 immediate 集合，约 0.66 秒已入队，两秒时仍未被领取；实际生成仅数十毫秒。旧波约 25 个任务中 23 个很快结束，两个尾项持续约 0.84 / 1.41 秒。已退出的 worker 没有被新的可见意图唤醒，下一批要等整个 Promise.all 收尾。25 是当次场景预算，并非默认容量。

现在复用现有可变 scope 和原生准入，以可唤醒 group 维护仍在运行的 worker。新可见意图在下一事件循环合并，复用空槽；普通后台初始仍为 2，交互上限仍为 4，每次剩余领取预算取 max 而非逐报告累加，单次补到最多 100。旧任务保留原 lane 和生命周期；失败必须等所有在途任务收尾才释放 owner。暂停、显式 owner、失效 controller 和已结束 callback 不接受自动唤醒。

另一个资源问题是 OIIO 先取得内存再等待单槽，三个约 112 MiB 的请求会预占约 336 MiB，实际只有一个运行，阻塞能容纳的 64 MiB 其他 decoder。现复用 FFmpeg 已使用的 keyed admission，原子取得 OIIO 单槽及字节。共享 384 MiB 预算、OIIO 单进程上限与错误分类保持不变。

没有增加解码上限、修改原文件、推迟预取直至停止滚动，也没有放宽两秒解码断言。

## 真实 Windows Electron 对照

经授权只读链接两个真实源，在新建可写 catalog、隔离 userData、隐藏窗口中运行。A 为 28,930 项设计素材，B 为 15,465 项照片。代码构建后才测试，四个跳点固定为 5%、55%、85%、25%；必须检查可见图片 complete 且 naturalWidth 非零。网络服务仍受控等待 5 秒，因此该条件与此前失败旅程一致。

| 场景 | 修改前 | 修改后第一轮 B | 最终构建 A | 最终构建 B |
| --- | --- | --- | --- | --- |
| 四跳九成解码，毫秒 | B 的 25% 跳点两秒未达标 | 935 / 599 / 656 / 803 | 789 / 550 / 570 / 806 | 890 / 623 / 617 / 995 |
| B 最后跳点同为 28 张图片 | 两秒 23/28，随后约 2.16–2.55 秒才补齐 | 两秒 28/28 | 不适用 | 两秒 28/28 |
| 完整旅程 | B 带连接等待的连续失败，未关闭为 flaky | 1 passed / 29.0 秒 | 1 passed / 34.9 秒 | 1 passed / 28.9 秒 |
| 普通创建可见，毫秒 | 先前连接分支修复后已降至百毫秒量级 | 100 | 41 | 95 |
| 连接仍等待时创建，毫秒 | 更早旧分支约 5 秒；属于前一增量 | 121 | 61 | 147 |
| 四秒原生浏览器 wheel 帧间隔 P95 / max，毫秒 | 另有约 35 毫秒 P95，不是严格同轮基线 | 36.3 / 44.4 | 21.6 / 43.2 | 37.1 / 44.8 |

组合调度改动后的同机先后对照不能把收益分别全归给 pool 或 OIIO；两项受控回归各证明其机制。B 的最后一跳两轮均是 28 张，避免拿较少可见集合的一次通过覆盖旧失败。三次旅程末次 wheel 后图片分别 25/25、25/25、25/25；未发现 Renderer 长任务，但帧间隔仍未达到稳定 60 fps，不称整体滚动已解决。

命令入口：`node scripts/run-e2e.mjs tests/e2e/real-linked-navigation-perf.test.ts --reporter=line`；随后同构建通过 Playwright CLI 串行运行第二源。启用 `SERPENT_REAL_NAV_WAIT_NAVIGATION`、`SERPENT_REAL_NAV_NATIVE_SCROLL`、`SERPENT_REAL_NAV_PROBE_AI_CONTENTION`、`SERPENT_REAL_NAV_ASSERT_AI_NONBLOCKING`、`SERPENT_REAL_NAV_TRACE_STAGES`，关闭 CPU profiler。真实路径只存在进程环境，不写入证据文件。每个新 catalog 与输出由 owner 在进程结束后清理，未重试旧拒绝目录。

## 自动化与限制

- OIIO 回归先稳定 RED：短任务只能在首个 OIIO 放行后运行。原子准入后与 pool 单测合跑 2 文件 / 6 passed；断言最终预算与 keyed active 归零、OIIO 峰值 1。
- Pool 单测覆盖空槽、并发上限、promise 结算边界唤醒、关闭后拒绝和失败后等待所有在途任务结算。
- Service 受控回归保持一个慢写 gate，新可见第三项必须在放行旧慢项前 ready 且 DB succeeded；回调结束后清除、旧 callback 返回 false。首轮在已接入 API 后执行 GREEN，不冒称先 RED。随后仅把实际 `pool.wake` 临时替换为成功返回，保留 callback 与 budget，稳定得到第三图十秒内仍未 ready 的 RED；父进程 finally 核对无并发编辑后恢复原文，再跑完整吞吐与相关回归 GREEN。该 mutation 证明仅更新 scope/budget 不足，不伪称在原始产品上先写用例。
- 直接相关 pool、内存预算、并发、OIIO、主次调度和暂停三套 Worker 合跑：7 文件 / 34 passed，11.38 秒。
- 最终新实现的完整库可用性：9 文件 / 240 passed、1 skipped，43.95 秒。
- 定向 ESLint 通过；TypeScript 仍只有其他 CLIP 轨道既有四处 Database 类型错误。新 OIIO fake stderr 曾误写 Buffer，已改 string 后重跑类型，未引入新的类型错误。
- 恢复后 `node scripts/run-vitest-with-electron.mjs run tests/worker/thumbnail-throughput.test.ts tests/worker/oiio-admission-fairness.test.ts tests/unit/wakeable-worker-pool.test.ts tests/unit/late-preview-queue-probe.test.ts --disableConsoleIntercept`：4 文件 / 21 passed，9.16 秒。该命令包括吞吐完整 11 项、pool 5 项、OIIO 1 项、匿名诊断 4 项。
- OIIO 跨库 single-flight 与全部 OIIO/RAW 格式派发定向：2 passed / 83 skipped，5.14 秒；未跑无关的整份音视频套件。
- 当前实现重新生成标准 20,000 混合媒体夹具：1 passed / 71.38 秒；`scripts/run-large-library-performance.mjs`：3 passed / 13.67 秒。API 基线 startup 12.1 ms、folder 0.5 ms、search 19.3 ms、layout 118 ms、初次导航 61.9 ms；reconciliation 2738.3 ms，事件循环 lag P95/max 0.9/80.9 ms，viewer resolve P95/max 2.4/4.8 ms。远端缓存 snapshot 4232.3 ms、cached open 519.7 ms，remote/cached browse P95 13.6/12.6 ms。均属 Service/生成数据，不是用户原实例 UI；未测删除。隔离根确认测试结束并检查无 reparse point 后清理。
- 最终真实 Electron 的 Worker SHA-256：`f1d3c083aa5b80e420d78db855960d975033e0fde758fb6bf80a19d63c76081e`。mutation 已恢复，后续只改测试/文档，不用旧构建证明新产品代码。
- 单一独立 Luna 完成 [Standards / Spec 双轴审查](../reviews/2026-11-17-media-wave-admission-review.md)，未发现确定阻断。审查者只读、未自己运行命令，不将主 agent 的执行记录写成独立复测。非阻断测试缺口：index 层合并次数、旧 controller 拒绝和关闭清理未另建直接确定性用例，当前由身份/许可检查、pool/Service 控制用例及真实旅程补证。
- 新增八个直接相关文件首轮定向隐私扫描零命中；最终含审查、状态、QA、两条工单评论共十二块再次扫描零命中。未要求提交，未执行全仓提交级隐私门禁，不称全仓通过。

前台 Computer Use 按用户要求未执行；packaged、macOS、原实例长期内存和真实源的全量后台排空未验证。用户尚未确认本轮，不关闭总目标或工单。

## 四列追溯

| 需求 | 实现 | 自动化 | 平台 / 人工证据 |
| --- | --- | --- | --- |
| 同成员重排即时采用新 rank | `library-service.ts:34618` ordered claim key 与参数替换 | `thumbnail-throughput.test.ts:290`，已先 RED 后 GREEN | 排序单项不冒充整体性能改善 |
| 空槽处理新可见任务、旧任务仍可收尾 | `wakeable-worker-pool.ts:14`、Service `library-service.ts:35605`、`index.ts:974` | `wakeable-worker-pool.test.ts:17` 起 5 项、`thumbnail-throughput.test.ts:400`、已有暂停/主次调度回归 | 当前构建三次真实旅程通过；前台未执行 |
| 等待 OIIO 不提前保留内存 | `library-service.ts:8034` keyed native budget | `oiio-admission-fairness.test.ts:26` RED/GREEN，原生预算单测 | 两真实源解码通过，不证明所有格式和平台 |
| 可见阶段诊断不泄露身份 | `App.tsx:3278` E2E-only band 事件、jump/late/perf helpers | `late-preview-queue-probe.test.ts:39` 起四项，真实采样关联 | 只输出匿名 ordinal 与相对时间，不保存真实路径和文件名 |
