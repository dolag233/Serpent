# AI 连接探测等待与目录操作

## 原因与修改范围

原实例日志中，87 条 scheduler stall 的 active 包含 `ai.test-connection`。队列分析已有 `runExternal` / `runWithoutAdmission` 边界，但连接测试仍直接等待供应商响应，最多 15 秒内一直占有后台许可。导航摘要、历史状态和文件夹 mutation 需要等待该 owner 结束；仅提高浏览请求优先级不能解决这种许可占用。

`src/worker/handlers/ai.ts` 的连接测试改为复用现有 `hooks.runWithoutAdmission(request.requestId, work)`。网络等待期间释放许可，成功或错误 continuation 继续前重新取得许可。未修改 lane、并发上限、15 秒超时、错误类别、凭据解析或持久化；该探测没有资源库内容提交。五种 adapter 分支均经过直接回归。

这是 `Serpent-db9f4f` 的一个小范围增量，不代表该 P0 的永久 pending provider、取消收敛、模型 gate 与全部吞吐规格完成。直接 `asset.analyze` 的无 controls 路径仍需另查 revision / 生命周期提交保护，不能直接给它套一个释放许可来允许过时写入。

## 受控复现与真实媒体验证

`tests/unit/ai-test-connection-scheduler.test.ts` 用真实 scheduler + handler、受控 deferred 网络，先在旧实现稳定 RED：history 状态仍在队列。修复后状态立即得到许可，网络完成时另一个 mutation 持有许可则探测结果仍等待重新入场。失败类别与脱敏诊断、全部 adapter 分支也通过。

真实隐藏 Windows Electron 使用全新隔离 catalog，分别链接两个经授权只读源：A 共 28,930 项，B 共 15,465 项。假 provider 仅在动态环回 HTTP 端口延迟响应 5 秒，使用测试 key；不读取或保存真实 profile/凭据，也不上传真实文件。公开 bridge 发起测试，同时读取导航/历史，并用界面创建托管目录，测量 Enter 到目录标签可见。

| 真实源 | 旧实现：创建可见 | 修改后：创建可见 | 导航旧→新 | 历史旧→新 | 修改后是否早于网络响应 |
| --- | --- | --- | --- | --- | --- |
| A | 5,154 ms | 57 ms | 5,037.6→3.5 ms | 5,038.0→4.1 ms | 创建、两类状态均是 |
| B | 4,834 ms | 656 ms | 5,061.1→34.5 ms | 5,061.6→34.7 ms | 创建、两类状态均是 |

旧实现两轮完整旅程各 1 passed（35.1 / 29.5 秒）；修改后 A 完整旅程 1 passed（33.3 秒）。B 的连接测试非阻塞断言通过，但三次带连接探测的完整旅程都在后续 25% 跳点未达两秒内九成解码而失败，不能把 B 整套写为通过，也不能把 656 ms 称为满足 500 ms 创建目标。第三次 B 的创建 134 ms、导航 19.1 ms、历史 24.1 ms，同样早于网络响应；不取较好一次覆盖较慢样本。

B 的第二次是增加阶段诊断后的复现：2,040 ms 时 23/28 图片已解码，缺的 5 张为 ARW、尚未挂载 img；至 2,551 ms 为 28/28。browse result/page 57.9 ms 已返回；最后五张 preview 请求约 2,166 ms 才发出，headers 26–27 ms，约 2,225 ms 完成 decode。此时旧阶段探针漏记了 batch-ready，不能以单件 ready 的末次 732 ms 推断五张早已就绪。

主 agent 补记批次后第三次复现：2,036 ms 仍 23/28；只在失败窗口后用公开 `listAssets(assetIds)` 读取缺图状态，耗时 13.5 ms，五张中一张 artifact ready、四张无 artifact。包含批次的最后 ready 2,092.4 ms、bind 2,109.7 ms、decode 2,160.9 ms，约一帧即绑定；这轮证据应优先追查生成与可见优先级，不能说 Renderer 收到 ready 后还拖一秒。无连接等待的另一次完整旅程 1 passed / 24.5 秒，末跳可见图片为 23 张而非失败场景的 28 张，不能把不同集合的一次通过当作修复。已建立 `Serpent-fe5da4`，失败断言继续保留。

以上是同机先后测量及有限复现。它证明受控网络等待不再阻塞目录操作，不证明所有滚动、媒体吞吐、原实例长时间内存或整个资源库性能已解决。

## 本轮命令与结果

- `npx vitest run tests/unit/ai-test-connection-scheduler.test.ts tests/unit/ai-handler.test.ts tests/unit/interactive-scheduler-admission-yield.test.ts`：3 文件 / 18 passed，根 agent 重跑同样通过。
- `npx eslint src/worker/handlers/ai.ts tests/unit/ai-test-connection-scheduler.test.ts tests/e2e/ai-probe-contention-probe.ts tests/e2e/real-linked-navigation-perf.test.ts`：新增诊断后最终 exit 0。
- `npx tsc --noEmit --pretty false`：初次发现新测试误给非泛型 `deferred()` 传入 7 处 `<void>`，已更正并重跑相关单测；最终只剩其他 CLIP 轨道四处 Database 类型错误，不改该轨道，不称全仓类型通过。
- Electron 旧实现：设置 `SERPENT_REAL_NAV_PROBE_AI_CONTENTION=1`、`SERPENT_REAL_NAV_WAIT_NAVIGATION=1`、`SERPENT_REAL_NAV_NATIVE_SCROLL=1`、`SERPENT_REAL_NAV_PROFILE_SCROLL=0`，运行 `real-linked-navigation-perf.test.ts`，两源串行。
- 修改后首个源使用 `node scripts/run-e2e.mjs tests/e2e/real-linked-navigation-perf.test.ts --reporter=line` 当前源码构建，增加 `SERPENT_REAL_NAV_ASSERT_AI_NONBLOCKING=1`。第二源复用该构建执行 Playwright；额外诊断增加 `SERPENT_REAL_NAV_TRACE_STAGES=1`，没有为重试改产品或放宽断言。

只修改 AI handler，不涉及库生命周期、schema、协议或 library-service；未重复运行库可用性、全量 Worker/Renderer、20k 或发布门禁。滚动探针另行记录，不混入本增量通过项。

## Standards / Spec 自查与追溯

这是既有 hook 的局部分支修正，按分级审查规则由主 agent 自查，不额外启动审查集群。

| 需求 | 实现位置 | 自动化 | 平台与人工证据 |
| --- | --- | --- | --- |
| 外部连接等待归还后台许可 | `src/worker/handlers/ai.ts:562` | `tests/unit/ai-test-connection-scheduler.test.ts:102`；真实 HTTP 延迟 helper | 当前构建隐藏 Windows Electron，A 完整通过；B 探测断言通过、后续 ARW 解码失败 |
| 结果/错误 continuation 遵守重新入场 | 同一既有 scheduler hook | 受控 mutation barrier、auth 错误与 adapter 用例；既有 admission-yield 测试 | 非阻塞创建实测；长期取消/永久 pending 未补证 |
| 不使用真实凭据、不改源媒体 | `tests/e2e/ai-probe-contention-probe.ts` | draft fake key + 本地 HTTP，链接只读源与隔离可写 catalog | 未操作真实库、未前台 Computer Use，packaged/macOS 未执行 |

`AI-CONNECTION-040` 待用户确认；P0 工单保持进行中。新建隔离 catalog/output 均由其 owner 在确认测试进程退出后清理，未重试此前被拒绝的旧目录。未提交推送。

当前验证 Worker SHA-256 为 `94e35b2711cb8900026266523ab080ee69d654da5c89e422af1c0c0a2d6bc43f`，与修改前的 FBX 增量构建区别明确。测试层后续诊断复用它，没有反复改产品换取通过。最终七个直接相关代码/测试文件 ESLint 零错误；类型只剩上述四项其他 CLIP 错误。九个本轮文件与状态/QA/工单新增块共十三块定向隐私扫描零命中；不是提交级全仓扫描。
