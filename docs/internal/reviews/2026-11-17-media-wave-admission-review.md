# Media wave admission 独立审查

审查范围仅包括本轮 `media-wave-admission` 设计、Worker 调度实现和直接相关测试。未改代码，也未独立运行测试、构建或应用。本报告中的自动化与真实旅程结果来自主 agent 的当次记录。

## 结论

**未发现确定的阻断问题。** 当前实现与本轮范围相符：可见窗口可唤醒尚未领取工作的空闲 worker；已领取任务保留原有生命周期；失败关闭后续领取并等待在途 worker 结束；OIIO 的进程槽与原生内存预算在一次准入中取得。

## Standards 审查

- [wakeable-worker-pool.ts](../../../src/worker/wakeable-worker-pool.ts:14) 将 live worker 限制在构造时的上限内。wake revision 覆盖 worker 返回、pool 即将 settle 时到达的唤醒；失败后不再启动新 worker，最终 promise 在仍活动的 worker settle 后才 reject。
- [library-service.ts](../../../src/worker/library-service.ts:35605) 的 wake 回调拒绝已结束、取消、暂停、显式 owner 或资源冷却状态；先同步占用有限剩余预算，再令 pool 扩充。失败回调清零预算并关闭 wake。finally 只移除自己发布的回调，并解绑 abort listener。
- [index.ts](../../../src/worker/index.ts:968) 按库保存可变 claim scope，并用单个 `setImmediate` 合并当前队列上的可见更新。回调验证 scope、controller 身份及自动准入状态。结算路径取消未执行的 Immediate，并按对象身份清理 scope/controller，避免旧 owner 清掉新 owner 的状态。
- 同长度但顺序变化的 asset ID 列表会刷新 `CASE` 参数而复用 SQL 形状；长度变化才重新 prepare，见 [library-service.ts](../../../src/worker/library-service.ts:34618)。唤醒切到交互 claim 顺序后重建 query；交互 claim 继续保留精确 asset 范围。
- [runOiio](../../../src/worker/library-service.ts:8034) 将 OIIO 单槽和估算内存放进同一个 `mediaNativeMemoryBudget.run` admission。底层预算仅在执行结束或失败后释放；当 OIIO key 已占用但字节容量可用时，等待器可让其他解码器使用可用字节，OIIO 并发仍为 1。
- 直接测试夹具在完成 worker/service 关闭后才清理精确创建的临时根；OIIO 用例以 `finally` 释放 gate 并 `allSettled`。未发现会持久化真实源路径、文件名或库名的新增测试输出。

## Spec 审查

- 排序、空槽唤醒、pool 上限、settlement 竞态和失败后等所有在途任务结算都有直接测试。Service 测试用一个受控慢任务证明新可见任务在旧慢任务仍未完成时可以 ready；将实际 pool wake 暂时断开后稳定 RED，恢复后通过。这比只断言 scope 或回调被更新更能证明行为。
- 已有 pause / explicit scheduler 回归覆盖旧自动 owner 取消后精确授权任务交接，以及显式任务期间全恢复的 owner 替换；新 wake API 对 explicit 和 pause 状态有额外拒绝条件。
- `tests/worker/oiio-admission-fairness.test.ts` 验证 OIIO 峰值为 1、排队的 OIIO 不预留内存，且 64 MiB 的其他预算任务可在首个 OIIO 释放前启动。它证明的是准入机制，不单独证明真实 OIIO 解码耗时。
- 主 agent 报告直接相关 pool、吞吐、OIIO 与诊断测试共 21 项通过；另报告暂停/主次调度、资源库可用性、20k mixed 基线通过，定向 lint 无错误。真实 Electron A/B 旅程报告三次通过，目标跳点 28/28 在两秒内完成；数据仅支持该机器、当前构建与所测来源，不代表其他库、平台或长时间滚动负载。

## 非阻断限制

- 本审查未运行命令，以上通过结果不是审查者独立复核。
- `index.ts` 的最新窗口替换与 `setImmediate` 合并目前主要由端到端旅程补证；未发现一个独立确定性用例直接量测这层合并次数、旧 controller 拒绝和关闭时清理。可在未来维护中补此项窄测试，但现有实现的身份/状态检查与真实旅程证据未显示阻断。
- 前台 Computer Use、packaged、macOS、其他真实库分布及长期滚动均未执行；不据此增写验收结论。
