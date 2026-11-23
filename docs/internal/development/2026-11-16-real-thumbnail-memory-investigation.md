# 真实后台缩略图完成与进程内存

- 工单：`Serpent-df0ec0`，进行中；新发现 `Serpent-1deebf`。
- 基线：`dolag_dev` / `ebb7f9be`，包含本轮尚未提交的可见页调度优化。
- 范围：真实链接素材、隔离目录与后台隐藏 Windows Electron；不写原始素材。
- 用户已要求不使用 Computer Use；本轮不进行前台操作，不签署人工验收。

## 问题与测量边界

历史会话中 Renderer 内存随后台完成数增长是相关性，不能直接归因于 IPC 或图片缓存。先区分 Renderer、Library Worker、Main、GPU，再区分 JavaScript 堆、Blink/embedder 堆、外部 backing storage 与进程私有内存。

只读统计的两个授权素材源含 44,395 个唯一普通文件（按文件系统身份去重，未做内容去重）。其中至少 11,824 个 native 图像确定不满足原图直出：6,315 个超过 2 MiB，5,509 个小文件的头尺寸超过直出阈值。190 个尺寸未知的文件单列，不计入该下限。素材数足以支持 5,000 项候选，但不等于 5,000 个实际生成成功或完成事件。

## 设计

1. 使用正常 linked 导入和后台任务泵。不调用强制单项生成入口，不注入合成完成事件。
2. 仅统计 `asset.thumbnail.batch-ready.ready` 中带 artifact 的不同资产；尺寸就绪、原图直出、失败、重复完成均不凑数。去重集合保留在测试宿主，不放入 Renderer。
3. 探针只留固定直方图与累积计数，不保留历史 URL、帧数组或 DOM 节点。每次采样清空帧统计。
4. 在里程碑和停止后台任务后的空闲段采样；正常窗口中不强制 GC。最后才允许堆快照，并把快照后的数值单列为受诊断扰动的样本。
5. 原始堆快照可能含素材内容与路径，只存本次测试的临时目录。输出仅包含类型、固定白名单构造器、最大浅层分配与非 weak 根路径，不输出任意堆字符串。根路径不是 dominator retained size。
6. 临时库、日志、快照与测试输出在各自所有者的 finally 中清理；源目录始终只读。空间预检 10 GiB。

Electron 的 `MemoryInfo` 各字段单位为 KiB，包括名为 `privateBytes` 的 Windows 字段；CDP `Runtime.getHeapUsage` 字段为 bytes。换算不能混用。依据：[Electron MemoryInfo](https://www.electronjs.org/docs/latest/api/structures/memory-info) 与本地安装的 CDP 类型定义。堆快照用于检查对象与保留路径，参考 [Chrome DevTools heap snapshots](https://developer.chrome.com/docs/devtools/memory-problems/heap-snapshots/)。

## 当前证据

- 匿名堆摘要单测：`npx vitest run tests/unit/heap-snapshot-summary.test.ts`，1 文件 / 3 passed。覆盖 metadata 字段定位、排除 weak-only 根路径、私有字符串不进入输出、非法图计数拒绝。
- 真实自然耗尽运行 1 passed，超过 5,000 项最低目标；下面按实际 10,059 项报告。3D、长时浏览与长期平台仍未验证，不关闭 P0。
- 当前只新增测量代码，未改变产品缓存或 GC 策略。

### 小样本揭示暂停边界缺口

隐藏 Windows Electron 小样本使用第一个源，实际链接 28,930 项；导入 11,298 ms。开始测量前实际完成 7 项，达到里程碑时 103 项。Renderer 私有内存 271.67 → 270.85 MiB，JS used 36.64 → 37.79 MiB；小样本不能证明 5,000 项平台。

调用未传 `jobIds` 的 `pauseMediaJobs` 返回暂停 515 项，5 秒后已有 562 项 queued、2 项 running、515 项 paused；唯一离屏 ready 已增加到 284。测试在 `idle-samples` 明确失败，未取得堆快照。不是重跑通过的 flaky：服务只转换当前 jobs 状态，自动补队仍可产生新工作。已保留 `SERPENT_REAL_MEMORY_PAUSE_AT_TARGET=1` 复现模式，未把它改成通过。隔离库和测试输出均已清理。

5,000 项内存测量改为独立的自然耗尽模式：先达到唯一资产完成数下限，再等待 queued/running 同时为 0 持续 10 秒，随后检查 15/45/90 秒空闲样本。新模式没有修复暂停功能，也不构成暂停验收。

按来源分别补核：第一个源 >2 MiB native 1,214 项，第二个源 5,101 项（不含 RAW）。正式 5,000 项选择第二个源。避免把两源合计的候选下限错误地当成单源保证。

### 正式自然耗尽结果

命令：`node scripts/run-e2e.mjs tests/e2e/real-thumbnail-memory.test.ts --reporter=line`，真实源仅由 `SERPENT_REAL_MEMORY_SOURCE_ROOT` 提供；`SERPENT_REAL_MEMORY_TARGET=5000`、`SERPENT_REAL_MEMORY_TIMEOUT_MS=1200000`、`SERPENT_REAL_MEMORY_IDLE_SECONDS=15,45,90`、`SERPENT_REAL_MEMORY_HEAP=1`、`SERPENT_REAL_MEMORY_PAUSE_AT_TARGET=0`。运行前 wrapper 创建独立输出目录，结束后 finally 清理。

- 当前源码新构建、Windows 隐藏 offscreen Electron，1 passed / exit 0；从导入开始的测量 elapsed 为 19 分 0.645 秒（包含自然耗尽、空闲样本和快照，不含构建/启动）。这不是已安装旧实例的升级后对照。
- 链接 15,465 个真实资产，导入 5,793 ms；10,059 个不同资产产生离屏 ready artifact，4,350 个批事件，单批最大 6 项，无重复资产或 artifact pair 凑数。
- 最终全部媒体任务计数：queued 0、running 0、succeeded 28,144、failed 82、cancelled 5,370。82 是所有媒体类别的失败总数，本轮未按种类和错误码归因；不能写成 82 个缩略图失败，也不能写全素材兼容通过。原图直出/取消不计入 10,059。
- 前后可见页均 16/16 张图片 `complete` 且非零尺寸，覆盖率 100%。本轮固定视口，没有测量远跳首图/九成/全部解码延迟，也没有滚动对照；不能用这次结果声称导航提速。
- 正常窗口未调用强制 GC。帧直方图 p95 上界约 17 ms；这是固定视口观察，不是滚动性能达标证明。

| 阶段（实际离屏完成数） | Renderer 私有 MiB | JS used MiB | Worker 私有 MiB | Main 私有 MiB |
| --- | ---: | ---: | ---: | ---: |
| 导入与首屏预热后（16） | 264.50 | 67.31 | 286.44 | 236.13 |
| 启动早期（112） | 390.17 | 78.09 | 253.70 | 218.75 |
| 1,025 | 270.50 | 40.18 | 333.49 | 172.45 |
| 2,522 | 255.43 | 40.08 | 309.57 | 211.03 |
| 5,002 | 256.19 | 40.61 | 312.65 | 211.94 |
| 自然耗尽后 15 秒（10,059） | 267.72 | 45.43 | 355.07 | 213.93 |
| 自然耗尽后 45 秒（10,059） | 271.98 | 46.66 | 356.86 | 209.24 |
| 自然耗尽后 90 秒（10,059） | 281.07 | 40.90 | 357.87 | 155.18 |

1,025 项以后 DOM nodes 为 13,939，backing storage 为 2.89 MiB；正常 idle 三次完成数都为 10,059。结果没有复现历史多 GiB 增长，但 idle 私有内存仍缓慢上升，不能写成已经证明平台或长期稳定。一次正常运行也不能替代 3D/FBX、不同导航/悬停历史、失败资产累积和长时 soak。

最终堆快照 145,575,457 bytes，1,449,015 nodes / 7,523,352 edges；匿名根路径摘要已实际解析。浅层大小合计中 native 约 59.35 MiB，object 约 10.58 MiB，array 约 8.57 MiB；这不是独占 retained size，也不是完整进程/GPU 分解，不能据此给某个缓存或具体原图归因。原始快照随后清理。

**诊断扰动单列**：快照后 Renderer 私有内存 349.36 MiB，JS 40.72 MiB，观察到约 2.6 秒帧间隔；这些数值不混入正常运行结论。

### 仪器收敛与独立复核

- 两文件单测：`npx vitest run tests/unit/heap-snapshot-summary.test.ts tests/unit/heap-snapshot-writer.test.ts`，6 passed；六个新增测量/单测文件定向 ESLint 0 errors / 0 warnings。
- 单一 Luna 同时核对 Standards 与测量规格，确认离屏计数、单位、隔离、匿名摘要边界；指出暂停支路可能漏掉 queued/两次轮询间的短任务，以及旧的快照上限只约束 JSON 分析。
- 收敛后：两个模式 idle 都要求 queued/running 为 0 且完成数不变；暂停支路检查新 queued，并给旧 fanout 尾部留出沉降时间。新增 writer 以 UTF-8 字节限制原始文件为 256 MiB，超出后不继续写盘、不解析部分 JSON；仍需等待 CDP 快照结束，这不是 Renderer 快照内存上限。
- 这些是正式运行后的诊断护栏修订，未再次运行 19 分钟全数据。已采集的数据本身满足强化检查：三次 idle count 一致、最终队列空、实际快照低于写入预算。新增 writer 的预算/UTF-8/无效预算单测 3 passed；不冒充第二次 Electron 运行。
- 同一独立 reviewer 增量复核无新阻断。暂停支路的 300 ms 沉降窗口仍可能把窗口内短暂新工作纳入 baseline，因此只作有界复现，不能作为完整暂停语义验证；后续产品修复需可控时序与持久任务对账。
- 本次所有新建临时库、原始快照和输出目录清理成功；目录核查 0 个本轮 memory 目录，CIM 核查无 Electron/Serpent 残留。没有触碰前轮被拒绝清理的路径。
- `git diff --check` 通过；新增 8 文件及本轮新增记录的 15 个文本块做了路径/凭据/本机身份增量扫描，0 命中。这不是全仓历史脱敏门禁，也没有运行不存在的 `privacy:scan` 脚本；本轮未提交。
- 本轮只改测量层，未重跑无关 Worker、库可用性或 20k 套件。前一产品增量的证据单独保留。

## 静态候选与归因限制

- `use-asset-card-hover-preview.ts` 的 resolution Map 随历史 hover 保留条目，切库只 fence 请求，没有清 Map；保留 URL 与描述对象，不直接持有媒体 DOM 或解码对象。同一资产 ID 的 proxy fallback 标记也未按库清理，是独立生命周期风险。
- `source-path-cache.ts` 保留每个 source revision 的路径与 mime，无容量上限；切库/变更会清理。它属于 Main，不能解释 Renderer 的占用。
- `App.tsx` 的 thumbnail failure Map 在旧失败资产离开当前页后可能继续保留原因与 ID；没有解码 buffer。
- `AssetPreviewModal.tsx` 在目标模型预加载期间仍挂载 `ModelViewerSurface`。当前与目标各有一套 scene/context，晋升后复用目标、卸载时 dispose。未发现连续导航积累多套 surface 的源码证据；短时重叠的真实内存量未测。
- 完成事件批次、补丁队列与 512 项缓存都有边界。上述候选只能证明具体生命周期或容量缺口，不能把它们直接写成历史多 GiB 内存的根因。

本轮最终类型检查 `npx tsc --noEmit --pretty false` 仍因另一路 CLIP 开发的 4 项既有错误失败（Worker namespace/unknown 与对应单测）；新增测量文件没有类型诊断。没有修改该开发轨道，也没有写全仓检查通过。

## 暂停修复的后续设计边界

`pauseMediaJobs` 只修改当前行，`automaticMediaAdmissionAllowed` 只查 open/closing；主/次队列、reconciliation、retry timer、补队和维护入口都要纳入统一策略。不能只在某一个 pump 加 session Set；还需区分 omit = 全部、nonempty IDs = 指定任务，公开协议拒绝 empty IDs。Service 当前对空数组的状态更新与 abort 范围不一致，不能把它当成对外兼容行为扩大操作。

尚未批准/实施的存储候选是新增持久库级暂停位与任务准入来源；没有合适的通用现成设置表可直接借用。后续必须一次设计事务边界、关闭重开/重启、指定恢复/重试、无任务时解除暂停和真正用户显式查看路径。可见窗口报告本身仍是自动调度，不能随意作为绕过“全部暂停”的 foreground 来源。这些是待收敛方案，不是本轮已交付规格。

## 四列追溯

| 需求 | 实现 | 自动化 | 人工/平台证据 |
| --- | --- | --- | --- |
| 真实离屏 artifact 成功计数 | `tests/e2e/real-thumbnail-memory.test.ts:281` | 自然耗尽 1 passed，10,059 项；后续只强化诊断护栏 | Windows 隐藏；前台未执行 |
| 有界探针、正确内存单位 | `tests/e2e/thumbnail-memory-probe.ts:50`；`tests/e2e/heap-snapshot-writer.ts:4` | 真实样本单位与进程已核对；writer 3 passed | packaged/macOS 未执行 |
| 匿名保留路径摘要 | `tests/e2e/heap-snapshot-summary.ts:27` | 摘要 3 passed；实际 145.6 MB 图已解析 | shortest non-weak path，不是 dominator |
| 5,000 项后内存平台、当前页解码 | `tests/e2e/real-thumbnail-memory.test.ts:402` | 固定页前后16/16解码、idle15/45/90数据；长期平台尚未证明 | 本机隐藏 Windows 单次；长期/导航历史未验证 |
| 全部暂停后无新工作 | `tests/e2e/real-thumbnail-memory.test.ts:427` 为复现入口 | 首次 pilot 失败；`Serpent-1deebf` 尚未修复 | 未进入待人类验收 |
| 3D/FBX 相邻预热与场景 mount 对照 | 本轮未实现 | 未执行 | 未验证 |
