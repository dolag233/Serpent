# Library Worker 意外退出后无法恢复：2026-11-01 调查

## 结论与证据边界

用户报告：一个长时间运行的 Windows 窗口中，搜索持续显示泛化内部错误，网格停留在旧结果。另一次进程观察记录到 Library Worker 在原图处理期间意外退出，退出码为 `0xC0000409`；同一窗口之后没有新的 Worker spawn。没有崩溃转储，**不能据时间相邻认定原图解析器、切库或特定媒体文件是原生崩溃根因**。隔离切库测试未复现该退出。

修复前源码可独立确认恢复链缺失：`src/main/worker-client.ts` 的 `start()` 仅在首次 ready 握手失败时重试；`#onExit` 清空进程和 pending 请求后不再拉起 Worker。`request()` 从此持续拒绝 `Library Worker is unavailable.`。`src/main/index.ts` 仅在应用启动时创建和启动这一客户端，一些调用点仍以 `Boolean(workerClient)` 判断可用性。该错误经过 `toPublicError()` 落入 `INTERNAL_ERROR`；`src/renderer/App.tsx` 的搜索 catch 每次调用 `setError`，自动搜索防抖与其他失败请求可以叠加相同提示。搜索结果在成功返回前不提交，旧网格因此留在画面上。

`Serpent-i78d` 曾以“有界退避重启、重新打开资源库并完成真实 kill/restart 对账”关闭。关闭提交 `12351c34` 只修改工单记录；当前源码和测试不支持这一结论。已因用户报告回归重新打开该 P1 工单。另一个仍开放的 `Serpent-3cff5e` 处理**进程存活却无响应**的超时风暴，是不同故障模式。

## 修复设计

1. 在 Main 建立单一 Worker supervisor，显式区分 `starting`、`ready`、`recovering`、`failed`、`stopping`，只让一次恢复流程执行。Worker 客户端的退出通知须携带进程代次与退出信息；旧进程的迟到退出/响应不能改变新代状态。正常关闭与主动取消不触发恢复。
2. Main 持有“期望打开的资源库”清单，记录成功打开、切换、关闭、导入及 MCP 打开的状态。恢复时先阻断新库请求，按清单重新打开，核对稳定 library ID；库不再存在、迁移失败或 ID 不符时明确向界面报告，不能假装旧会话仍可用。切库与恢复并发时以最新期望状态为准，不盲目重开已关闭的库。
3. 新 Worker ready 只是进程就绪；资源库重新打开、主进程缓存和副作用重建之后才发布服务恢复。重新发送 Worker 启动后才有的配置（缺失链接文件可见性、插件缩略图扩展等），重新连接同步/后台调度；清理源路径、artifact、拖拽和离屏授权等代次相关缓存。持久任务按现有租约/恢复规则继续，不重放已成功的写命令。
4. 对重启采用短暂退避和明确上限，反复在同一媒体上崩溃时停止循环并展示一次持续的“资源库服务已停止”状态及可操作的重新启动/重试入口。请求应得到明确的 Worker 不可用错误，不继续映射成泛化内部错误；自动搜索和后台轮询停止重复弹错。正在恢复时网格须标示旧内容不可交互，恢复后重取当前视图，不能把旧结果当成新搜索结果。
5. 将原生崩溃定位独立推进：记录 `child-process-gone` 的服务类型、原因、退出码和 Worker 最后执行的命令类别/不透明资产 ID；在受控诊断环境抓取转储并符号解析，按解析栈决定是否需要把 sharp 等原生解码移出持有 SQLite 的常驻 Worker。日志和文档不得包含真实资源库路径、文件名或内容。

## 验收设计

- Worker 客户端单测：首次握手失败、运行后意外退出、旧代迟到事件、正常关闭、连续崩溃超过上限；pending 请求只失败一次，恢复期间新请求不进入半就绪 Worker。
- 隔离 userData 的真实 Electron E2E：打开临时库、真实结束 UtilityProcess、观察新 PID、重新打开同一库并完成一次搜索；完整退出应用后核对文件与数据库。另测两个已打开库、切库过程中退出和恢复失败，不能误把旧库 ID 用于新库。
- Renderer 定向测试：同一故障周期只有一个明确状态提示，搜索失败不会静默保留貌似已更新的结果；恢复后当前搜索自动或经用户重试成功。截图检查恢复中、恢复后、无法恢复三种状态。
- 原生崩溃源只有在取得转储和符号或稳定的最小复现之后才能标记“已定位”。杀进程测试仅证明故障恢复，不证明 `0xC0000409` 的触发原因。

## 2026-11-01 真实 Electron 复现

使用当前源码经 `node scripts/run-e2e.mjs tests/e2e/worker-exit-repro.test.ts --reporter=line` 构建并启动隐藏 Electron 窗口。测试以独立临时 userData 创建资源库并导入一张虚构的 1×1 PNG；卡片出现后，从该实例会话日志的 `worker.spawn` 记录取 PID，与 Electron `getAppMetrics()` 中唯一的 `node.mojom.NodeService` Utility PID 核对，再仅结束该 PID。该 Electron 版本的进程指标未把自定义 `Serpent Library Worker` 写进 `serviceName`，故首次寻找自定义服务名的测试在杀进程前失败；校准 PID 后的两次运行均通过。测试每次在 `finally` 关闭实例并清理所属临时目录。

最终运行结果：`1 passed (14.1s)`。结束前 Worker 数量 1；结束约 3 秒后为 0，没有重拉。搜索显示“未能分类的内部错误”；同一窗口再次输入搜索，错误提示条目数由 2 增至 3。另一次 `library.listOpen()` 返回 `INTERNAL_ERROR`，旧图片卡片仍可见。首轮校准后的运行也得到 `1 passed (13.8s)`、0 个新 Worker、相同错误码和旧卡片保留。由此**真实复现了退出后的无恢复、泛化错误、重复提示和旧网格**；人为终止的退出码并非原报告的 `0xC0000409`，不能证明原生崩溃源。

复现脚本是一次性诊断夹具，运行后移除；未把“故障应持续存在”提交为产品回归断言。

## 修复增量与当次证据

`LibraryWorkerClient` 在运行后异常退出时拒绝旧进程的 pending 请求，按代次隔离迟到消息，并以 500/1000/2000 ms 退避重拉 Worker。新进程先重开已知的全部资源库，核对 library ID，再放行请求；60 秒内第三次意外退出后停止自动重拉。启动握手失败仍沿用原有启动重试，不与运行后的恢复流程并发。库重开失败时向 Main 报告该库，Main 清除相关缓存并发送关闭通知；Renderer 给出“检查位置后重新打开”的提示。Main 在放行请求前同步清理代次缓存并重发插件预览扩展和丢失链接文件设置，随后按原有异步机制接续插件激活与 AI 队列。Renderer 以持久提示标示恢复中或停止，旧画布在此期间不可交互，恢复后重取当前视图。Worker 不可用被映射为专用公开错误；搜索在故障期间不叠加泛化错误提示。

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 异常退出后重拉、旧代隔离、请求门控、崩溃上限 | `src/main/worker-client.ts:361`、`:916`、`:953` | `tests/unit/worker-client.test.ts:26`、`:102`、`:140` | 真实 Windows Electron 隐藏窗口杀进程后产生新 PID；可见窗口操作未执行 |
| 重开两座资源库并恢复查询 | `src/main/worker-client.ts:898`、`:916`；`src/main/index.ts:4862` | `tests/e2e/worker-recovery.test.ts:17`，真实结束经 PID 核对的 UtilityProcess，核对两库 ID、搜索负/正结果 | 隐藏窗口 E2E 1/1 通过；真实用户资源库与 packaged 未执行 |
| 专用错误、失败提示与不可交互旧画布 | `src/shared/protocol/errors.ts:7`、`responses.ts:2881`；`src/renderer/App.tsx:5057`、`:15138` | `tests/unit/protocol.test.ts:31`；`tests/e2e/worker-recovery.test.ts:17` 中断言画布 `inert` 与搜索恢复 | 恢复中和停止态的可见界面截图未执行 |

当次命令：`npx vitest run tests/unit/worker-client.test.ts tests/unit/protocol.test.ts tests/unit/library-lifecycle-sync.test.ts tests/unit/renderer-library-lifecycle-sync.test.ts --maxWorkers=1 --reporter=dot`，4 files / 142 tests 通过；追加失败库用例后 `npx vitest run tests/unit/worker-client.test.ts --maxWorkers=1 --reporter=dot`，19 tests 通过；`npm run test:library-availability`，9 files / 236 tests 通过、1 skipped；`node scripts/run-e2e.mjs tests/e2e/worker-recovery.test.ts --reporter=line`，最终 1 passed (13.3s)，隔离 userData、隐藏窗口、双库及画布 `inert` 断言。`npm run typecheck` 通过。测试临时目录在实例关闭后清理。

边界：这次人为结束 UtilityProcess 验证的是恢复链，不能证明或修复原生 `0xC0000409` 崩溃源。恢复失败后的人工重试目前通过完整重启应用；尚无应用内重试入口。切库指令与退出精确交错、两库中一库路径损坏、完整退出后重启对账、恢复中/停止态 Computer Use 截图、packaged 和 macOS 均未验证。故该增量不能标记为完整规格验收。

独立 Luna agent 按 Standards 与 Spec 双轴静态审查，最初指出“旧画布仍可操作”和“缓存/配置在请求放行后才重建”两项 P1；修复后由同一审查 agent 复核，两项均无阻断。仍保留 P2 边界：恢复开始后的切库/关闭指令在门后顺序执行，本轮重开使用恢复开始时的库快照；整座库界面的侧栏和工具栏并未冻结，画布外入口仍可能提交等待恢复的操作。单库重开失败已加提示及 Worker Client 单测，但真实 Electron 故障路径尚未验证。独立审查没有运行测试，测试结果由主 agent 执行记录。人工可见界面、原生崩溃源和完整规格验收仍待补证据。
