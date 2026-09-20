# 8 万级链接库热点与优化计划

> 日期：2026-09-16  
> 状态：profile 与方案已沉淀，尚未实施  
> 范围：后台媒体任务影响浏览；移除大型链接文件夹耗时过长  
> 隐私：本文只保留聚合指标和仓库相对路径，不记录真实库名、源文件名或本机路径。

> 2026-09-20 补充：当前实例又暴露了“目录发现长期持有 mutation”与“已取消模型 AI 仍持有后台许可”两条活性链。新的因果图、分阶段算法和工单边界见 [当前实例模型、AI 与 Worker 调度活性分析](2026-09-20-current-instance-model-ai-scheduler-profile.md)。本文关于异常输入与链接移除的结论仍保留，但不能替代新的 P0 活性修复。

## 1. 结论

本轮不是上一阶段“继续压低普通浏览 SQL”的延伸，而是两个相互独立、都能拖垮前台的放大链：

1. **异常模型输入放大链**：仅凭扩展名把二进制 `.obj` 归类为 Wavefront 文本模型，送入 Renderer 的 `OBJLoader`；解析器产生高频、超大 warning，Main 又逐条同步写日志，最终同时压低媒体队列吞吐、放大内存和磁盘写入。
2. **链接移除写放大链**：前台请求持有唯一 mutation 所有权，逐资产执行 `DELETE`；缺失的外键子列索引、级联/FTS/变更序列触发器和逐行事件共同放大成本。批间 `setImmediate` 只让出 JavaScript 事件循环，没有归还 scheduler 所有权，所以前台仍被挡住。

两条链都不能靠提高并发或缩短轮询间隔解决。第一条需要“输入分类 + 日志熔断 + 模型 lane 隔离”，第二条需要“索引完整性 + 集合式清理 + 两阶段逻辑解绑”。

## 2. 证据边界

### 2.1 已测事实

本轮对当前实例的应用日志、进程资源、SQLite 查询与运行中 operation 做了只读采样：

- 当前库约 11.3 万个有效资产，其中约 8.4 万来自目标链接文件夹；扩展名为 `.obj` 的资产只有几十个。
- 一次约 66 秒的异常窗口产生约 42 万条 Renderer warning，速率约 6,300 条/秒；绝大多数消息含 NUL 或明显二进制特征。
- 当次会话日志约 293 MiB，其中 Renderer warning 约占 99.8%。
- warning 风暴前媒体任务可达到每秒数十项；风暴期间降至约每秒 1 项并出现近一分钟几乎无进度。该会话随后仍能继续完成数千个缩略图和调色板任务，说明队列不是永久死锁。
- 纯目录浏览 SQL 不是这次主要热点：大目录计数是几十毫秒量级，首 100 项是一毫秒量级；当前实现对超大目录已有避免全量索引的保护。
- 移除 operation 连续运行超过 299 秒，期间 scheduler 仍排有交互、维护和次级请求；Worker 只有中低 CPU，占用并非算力饱和。
- 链接资产从约 8.4 万下降到约 6.9 万仍用了数分钟；短窗口约 100 rows/s，全程均值更低。WAL 有增长，但没有出现“完全不工作”的证据。
- 当前 `removeLinkedFolder` 先收集全部 asset id，再按小批次逐行执行 `DELETE FROM assets WHERE asset_id = ?`。
- 当前 schema 扫描确认若干外键子列没有可用左前缀索引，规模最大的包括 `revisions.parent_revision_id` 与 `jobs.revision_id`。其余缺口必须由自动 invariant 给出，不能长期依赖本文的静态清单。

### 2.2 强推断

- `.obj` 文件中的二进制内容与 `OBJLoader` warning 模板一致；扩展名分类、文本读取、解析和诊断转发的代码链也完整闭合，因此“非 Wavefront 二进制文件被误送入 OBJLoader”是高置信根因。
- warning 洪泛与后台吞吐骤降在时间线上高度重合；逐条 IPC/序列化与同步 `appendFileSync` 构成明确放大器。它不一定是唯一耗时，但已足以成为 P0 防护项。
- 移除路径的低 CPU、持续写入和逐行删除形态，与外键检查/触发器/FTS 写放大一致；缺索引是可证实热点，但不会自动消除 scheduler 独占和逐行事件成本。

### 2.3 尚未证明

- 日志没有稳定的 `windowId` 与模型 asset 关联，不能把每一条 warning 精确归因到某一个真实文件。
- 当次没有完整、同 scope 的“点击到内容变化、可见图全解码” span，因此不能用这组数据替代正式导航 A/B。
- 进程内存快照曾达到数 GiB，但目前不能把全部内存都归因给模型解析；需要增加按 lane、任务和离屏 renderer 生命周期的指标。

## 3. 方向一：异常媒体分类与后台任务隔离

### 3.1 当前放大链

```text
扩展名是 .obj
    ↓
LibraryService.detectMediaType → model
    ↓
模型 artifact 入队并交给离屏 Renderer
    ↓
fetchText 读取二进制样内容 → OBJLoader.parse
    ↓
Three.js 高频 warning，消息可能携带大段原始内容
    ↓
renderer-diagnostics 逐条转发
    ↓
AppLogger appendFileSync 逐条落盘
    ↓
IPC、主线程、磁盘、内存同时放大；普通媒体任务吞吐坍塌
```

关键实现接缝：

- `src/shared/media-formats.ts`：扩展名注册表；
- `src/worker/library-service.ts`：`detectMediaType`、artifact 入队、失败与重试收敛；
- `src/renderer/3d-viewer/loader-registry.ts`：文本读取和 `OBJLoader`；
- `src/main/renderer-diagnostics.ts` / `src/main/index.ts`：Renderer console 转发；
- `src/main/app-logger.ts`：同步日志写入；
- `src/main/offscreen-thumbnail-renderer.ts`：模型任务、窗口和 GPU 生命周期。

### 3.2 算法方案

#### A. 有界内容分类

扩展名只能决定“候选解析器”，不能直接决定“确认的媒体类型”。模型候选进入队列前读取固定上限的头部并产生可缓存的分类结果：

- 二进制格式校验魔数和基本结构；
- OBJ 检查 NUL/控制字符比例、可解码文本比例以及 Wavefront 关键行的可信度；
- 只读有限字节，不为分类加载整个大文件；
- 合法但稀疏、带大量注释或不同换行的 OBJ 不能误杀；
- 结果携带 `classifierVersion`、稳定失败码与证据摘要并持久化；
- 确定性失败不重试，文件仍作为普通资产存在，源文件不动。

分类必须位于导入、链接刷新、reconciliation 与 artifact enqueue 的共享入口。只在 `OBJLoader` 前加一次判断会让其他入队路径继续制造重复 job。

#### B. 日志熔断与安全摘要

诊断链必须在第三方库失控时保持有界：

- 对 `source + message template + error code` 建指纹；时间窗内保留首条，后续只累计 `suppressedCount`；
- 限制单条 payload 和每分钟总字节；NUL、长 token、二进制样文本只保留长度、分类和不可逆摘要；
- AppLogger 使用有界队列批写，队列满时先丢弃重复 warning；fatal/进程死亡显式 flush；
- 记录抑制数、截断字节、队列高水位和写入耗时，避免“没有日志”等同于“没有问题”。

#### C. 模型 lane 与失败预算

即使分类正确，合法但病态的模型仍可能很慢，因此模型缩略图需要独立资源域：

- 模型 lane 有独立且保守的并发上限，不能耗尽普通图片/视频许可；
- 读取、解析、GPU 渲染和回传分别有大小与时间预算；
- 永久输入失败、暂时 GPU/窗口失败、退出中止使用不同 error code；
- 只有暂时失败可按上限和退避重试；
- 离屏 renderer 达到任务数、内存水位或 context 异常后回收重建；
- 重启后根据持久化结果收敛，不能重新制造无限失败队列。

### 3.3 验收预算

- 二进制 `.obj` fixture 进入 `OBJLoader` 的次数为 0；日志中原始二进制内容为 0。
- warning 压测达到每秒数千条时，日志增长小于 1 MiB/分钟，应用保持可交互。
- 病态模型持续存在时，普通媒体队列吞吐不低于无病态模型对照的 80%。
- 背景任务运行时，文件夹首屏 p95 仍以 500 ms 产品目标验收；不能只看 Worker rows/s。
- 不出现连续 10 秒以上无进度、无界内存增长或跨重启无限重试。

## 4. 方向二：链接文件夹两阶段移除

### 4.1 当前放大链

```text
Renderer 发起 linked-folder.remove
    ↓
Worker 持有 mutation 所有权
    ↓
一次性读出全部 asset id
    ↓
小批次内逐行 DELETE assets
    ├─ 外键检查与级联
    ├─ FTS / trigger / change sequence
    └─ 逐行事件和缓存失效
    ↓
setImmediate 仅让出事件循环，没有归还 scheduler 所有权
    ↓
前台请求排队、Main 超时、晚到响应被丢弃、侧栏不收敛
```

关键实现接缝：

- `src/worker/library-service.ts`：`removeLinkedFolder`、schema migrations、FTS 与变更序列；
- `src/worker/interactive-scheduler.ts`：后台批次真正归还与重新准入；
- `src/worker/index.ts`：命令和 operation 生命周期；
- `src/main/worker-client.ts` / `src/main/index.ts`：超时、late response 与事件；
- `src/preload/index.ts`、`src/shared/protocol/*`、Renderer 文件夹控制器：accepted、进度和最终收敛。

### 4.2 算法方案

#### A. 外键索引 invariant

先消除数据库层面的乘法项：

- migration 为缺少可用左前缀索引的外键子列补索引；
- 测试遍历 `foreign_key_list`、`index_list` 与 `index_info`，自动判定覆盖；
- 例外必须显式白名单并写清原因；
- 用 `EXPLAIN QUERY PLAN` 和等规模 fixture 做迁移前后 A/B；
- 首次建索引的时间、WAL/磁盘占用和开库反馈也进入验收。

索引是必要条件，不是完整修复。它不能解决前台长请求、逐行 JS/SQLite 调用和逐行事件广播。

#### B. 两阶段状态机

移除应拆成用户可见的逻辑提交与可恢复的物理清理：

```text
linked → removing（短事务，停止 watcher / 禁止新 job / UI 隐藏）
       → cleaning（持久化 operation，后台分批清理）
       → removed（最终一致，广播完成）
       ↘ failed（保留可诊断、可重试状态）
```

- 确认后立即返回 `accepted + operationId`，Renderer 不等待全部资产删除；
- operation 必须持久化，Worker 崩溃或应用退出后能续作；
- 逻辑提交前可取消且零变化；提交后不能简单停止在半删状态，若要撤销应显式 relink/rebuild；
- 当前浏览范围、侧栏和任务面板从 operation 状态恢复，不依赖一次 promise 最终 resolve；
- 源目录零修改，失败不能留下无入口的幽灵链接。

#### C. 集合式、自适应清理

- 用临时表、批量 `IN` 或 keyset 范围游标代替逐资产 prepare/run；
- 在语义允许时先集合式删除派生/子表，再删除 `assets`，但不能关闭外键约束逃避正确性；
- 批大小按最近事务时长自适应，目标是短事务而不是固定“500 条”；
- FTS、change sequence、缓存失效和 Renderer 事件按批或范围合并；
- 每批提交后真正释放 scheduler admission，前台请求到来时先让路，再重新申请后台许可；
- 分阶段记录选取 ID、子表、assets、FTS、commit、checkpoint、yield 的耗时和 rows/s。

### 4.3 验收预算

- 用户确认后 500 ms 内从侧栏移除目标并恢复交互；物理清理继续运行。
- 2 万与 8 万 fixture 上，总清理吞吐相对当前逐行路径至少提升一个数量级。
- 后台清理期间文件夹首屏 p95 以 500 ms 产品目标验收，不出现数十秒 scheduler stall。
- kill Worker / 退出应用后重启，operation 能继续并最终一致。
- `foreign_key_check`、FTS 查询、任务/派生数据、侧栏状态全部收敛；源文件零改动。

## 5. 工单分解与依赖

### 5.1 异常媒体链

| 工单 | 交付边界 | 依赖 |
| --- | --- | --- |
| `Serpent-2da2c8` P0 | 内容分类、持久化失败与既有资产渐进回填 | 无 |
| `Serpent-18a000` P0 | Renderer 日志熔断、脱敏、异步批写与指标 | 无 |
| `Serpent-032dfc` P0 | 模型全链取消、HDRI fail-open、阶段 watchdog 与 renderer 回收 | 无；2026-09-20 活性事故已提升优先级 |

原计划建议先完成分类与日志保险丝再做模型 lane。2026-09-20 的永久 pending 证据改变了顺序：分类与日志保护继续有效，但模型取消/回收已经是独立 P0，不再等待内容分类工单。

### 5.2 链接移除链

| 工单 | 交付边界 | 依赖 |
| --- | --- | --- |
| `Serpent-b3354f` P0 | 外键子列索引与 schema invariant | 无 |
| `Serpent-2cbc13` P1 | 集合式清理、触发器/事件合并与 scheduler yield | `Serpent-b3354f` |
| `Serpent-49e0c4` P1 | 两阶段逻辑解绑、持久化 operation 与恢复 | 无；最终集成需前两项 |
| `Serpent-a437fb` P1 | 用户结果总验收：大型链接文件夹移除性能 | 上述三项 |
| `Serpent-c5f1d7` P1 | 完成后侧栏自动收敛与 late-response 兜底 | `Serpent-49e0c4` |
| `Serpent-e8efb0` P1 | 两阶段语义下的取消/撤销行为 | `Serpent-49e0c4` |

建议顺序：索引 migration 与两阶段协议可分别推进；集合式清理在索引 invariant 之后做 A/B；最后用既有三个用户问题工单做端到端验收，不新增重复总单。

## 6. Profile 与 A/B 方法

每个实现都必须保留同一 fixture、同一队列构成和同一浏览 scope 的 before/after。至少记录：

1. 点击到可见卡片集合变化；
2. 可见图片全部解码；
3. interactive scheduler wait p50/p95/max；
4. 各媒体 lane 的 queued/running/completed/failed 与 rows/s；
5. Renderer/Main/Worker CPU、内存和日志 bytes/s；
6. SQLite 各删除阶段、事务、WAL/checkpoint 耗时；
7. 失败码、重试次数、被抑制 warning 数；
8. 操作中断后重启的最终一致性。

禁止用不同缓存状态、不同任务类型或不同 scope 的两次运行直接比较；禁止把“CPU 更低”单独解释成优化成功。成功必须同时满足前台延迟、后台吞吐、资源上界和正确性。

## 7. 四列验收追踪

| 需求条目 | 计划实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 二进制 `.obj` 不进入解析器 | shared classifier + `library-service` 入队接缝 | worker 分类矩阵；Renderer loader spy；重启不重试 | 真实 Electron 后台队列运行中浏览；当前未执行 |
| 日志洪泛有界且不泄露原始内容 | `renderer-diagnostics`、`app-logger` | warning 压测、payload 脱敏、flush/退出 | 观察日志增长、交互与进程资源；当前未执行 |
| 模型任务不拖垮普通媒体 | scheduler/model artifact lane、offscreen renderer | lane 公平性、超时/重试/回收 | 8 万级混合队列 A/B；当前未执行 |
| 外键删除不反复全表扫描 | schema migration 与 invariant | schema invariant、query plan、availability | 首次迁移耗时与磁盘观察；当前未执行 |
| 移除 500 ms 内反馈并可恢复 | protocol、Worker operation、Renderer controller | 状态机、kill/restart、重复请求、late event | 真实 Electron 操作；当前未执行 |
| 物理清理数量级提速且不阻塞 | 集合式清理、批级合并、scheduler yield | 2 万/8 万 fixture、FK/FTS 对账 | 运行中切换文件夹与资源预览；当前未执行 |

本文是后续实现与审查的规格基线，不构成任何一项已完成或已验收的声明。
