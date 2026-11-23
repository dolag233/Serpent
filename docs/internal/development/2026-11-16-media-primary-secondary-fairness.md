# 主预览与派生媒体的在线调度

工单 `Serpent-c1371a`，关联 `Serpent-3kfe` / `Serpent-e73d04`。实现基线为当前维护者工作分支的累积性能工作树，不提交推送。此前真实在线观察见[吞吐审计](2026-11-16-derived-media-throughput-audit.md#在线观察的实际结果)：照片源在100个唯一图片预览完成时，色卡排队从3升至93，6份完整快照均未运行，日志也没有色卡领取/完成；不能将短窗解释为无限饥饿。

## 原因与范围

`scheduleThumbnailQueue` 的满额波次在 `continueImmediately` 分支直接排下一波并返回。普通secondary启动主要在整条primary泵的末尾，因此持续primary backlog会延后该入口。独立secondary已有idle、协作取消、精确urgent许可与native信号量，不应再建一条绕过这些约束的处理器。

Renderer有可见资产与邻带的key，但report effect依赖layout对象，并在重建时先清空key。摘要页合并或尺寸更新因此可能在相同bands上重报；纯thumbnail.ready本身不直接触发该依赖。清空行为同时用于资产变更后重新激活Worker，不能简单删掉而破坏同资产新revision/重试。此项是已识别的相关放大因素，后续需以显式catalog/rearm边界区分真实变更与layout identity变化；本轮先验证primary持续工作下的独立secondary启动，不删除idle或可见抢占。任务列表与资产读取轮询不会直接续期idle。

## 本轮方案

1. 非空primary波完成、且库级automatic准入仍允许时，独立唤醒既有secondary泵；primary仍持有自己的继续/重试/精确对账闭包。不能等整库primary全部排空才给予派生任务入口。精确对账同样可以共享后台处理机会；explicit primary完成也仅在未全库暂停时允许普通wake，不扩大暂停期间的grant。
2. 存在活动或已排队primary时，普通secondary每次最多领取1项；主队列结束后恢复既有批量和短yield，避免把排空阶段退回旧的单项50ms吞吐上限。共享native上限及urgent explicit路径不扩张；urgent所有者期间到达的普通wake保留至其结束，恢复仍重新检查automatic准入。
3. 普通secondary领取前检查真正的可见波及pending visible；可见波没有结束，即使2秒idle已到也不能领取。按controller身份追踪可见波，完整成功/失败/取消路径都释放；对账复用的精确asset scope不冒充前台可见波。
4. 可见完成边界会重新唤醒，被门禁挡住的secondary不用高频轮询。全库暂停、close、资源冷却和urgent精确grant仍由原入口/控制器约束，取消与重新打开不能保留旧可见标记。

## 验证安排与未完成项

先用真实LibraryService与可控Promise构造稳定RED：首波实际产生palette，下一波primary挂起时palette必须实际ready；随后检查可见波超过idle窗仍禁止普通secondary领取。结构回归可用隔离合成图片，性能与解码证据仍用已授权真实源。Worker定向回归覆盖primary交接、pause/resume与新gate；本轮不改schema、协议、开库/迁移/关闭实现，不据调度改动扩大资源库可用性门禁。大型库基线、当前构建隐藏真实Electron在线观察及远跳对照另列实际命令和结果。

当前产品已落地，旧实现已获得6秒有界palette等待RED；最初编号fixture触发序列折叠的setup错误不算RED，修正后使用独立字母名。初次改后Worker集成测试的功能断言通过，但同步删除临时根EPERM导致整体失败；该失败保留，不当作Electron E2E失败。改为异步closeAllAsync及异步rm后，扩展为10个queued主任务的最终回归 **1 passed，测试7.82秒、完整命令约11.6秒**。覆盖满波primary挂起时真实palette、visible波跨2秒idle保护、暂停及精确显式恢复、全部恢复与urgent交接；最终无需额外wake，10个palette任务均实际succeeded。已有3个直接相关Worker文件 **13 passed / 13.94秒**。本轮4次真实Electron旅程结果见下文。

产品index、新Worker测试、online诊断文件定向lint通过；最后一次 `npm run typecheck`仍只有其他CLIP轨道4项错误，未新增本范围类型错误，后续extension检查未执行。没有改Service/schema、协议或资源库生命周期实现，因此按最小测试原则没有重跑availability和Service层20k基线；两真实源的调度与解码旅程分别为15,465/28,930资产，不冒充规定的20k受控分布基线。独立审查最终结论另见审查记录，UI/人工验收仍未执行。

前台按用户要求不执行，packaged/macOS/OS物理输入及未自然触发的proxy仍未验证。4个早期失败Worker fixture和此前2个失败Electron catalog的精确删除先后被自动审批拒绝（只返回blocked by policy），全部保留，不改属性或绕路重试；已向用户单独报告，不声称全部新产物清理。最终成功Worker与4次成功Electron旅程自己的新产物已清理。文档不记录真实路径或随机目录名。

### 小波次的固定成本风险

只读核对发现 `processThumbnailQueue` 每次未暂停调用都先执行PNG历史修复候选SELECT与隐藏序列任务UPDATE，甚至先于空kind/abort返回。前者以thumbnail/status/mime/generator过滤，而现有artifact索引以revision开头，0命中时可能反复扫描历史artifact；后者使用library/status索引后仍逐候选检查sequence membership。columnsFor/hasTable已有缓存，不能误记为每波重复PRAGMA。

上述是索引形状和调用频率的风险，不是耗时归因；旧palette基准的约8ms每调用混合开销也不能直接归给这两条SQL。竞争期budget1只用于primary仍活跃时，排空阶段恢复既有batch。真实改后必须核对primary进度与可见延迟，若固定扫描占比明显，再在独立增量测量0命中/legacy命中/大队列成本并把修复移至显式维护或明确dirty边界，不直接新增一个宽change-sequence缓存掩盖失效问题。

### 已发现的可见报告重激活边界

进一步只读核对表明，`library.changed` 对普通job/artifact写入也可发出；Worker当前无条件清可见去重键/资产集合和立即完成订阅。因此不能把该事件本身当作窄catalog mutation，也不能仅删除Renderer的layout重建rearm。`browse.session.open`已有 `catalogSequence`（`getBrowseChangeSequence`，jobs/artifacts不推进），但Renderer分页注册尚未保留；现有content-load、page generation和sessionId都会因静默刷新而更新，均不能直接用来表示用户导航。

下一增量需一起对齐Worker清理和Renderer重报：保留窄catalogSequence，组合规范化scope/sort/search身份、明确browse-intent generation与bands；实际同ID新revision/restore必须rearm，纯summary/artifact/dimension identity补齐不能重报。离开再回同一scope需要显式intent边界；若手动retry不推进catalogSequence，使用明确admission rearm，不借宽library changeSequence。应抽独立hook/controller测试，禁止继续把整段内联扩入App。此处是方案，尚未实施，不把本次独立secondary启动描述成这条链已修复。

## 当前构建真实对照

第一轮用 `node scripts/run-e2e.mjs tests/e2e/real-online-derivatives.test.ts --reporter=line` 重建当前产品，随后同构建直接Playwright运行另一源及两组native导航。全部隐藏Windows Electron、隔离profile/catalog、真实源只读，串行执行，没有并跑lint/tsc/其他测试。最终产品只改Worker index；没有修改原始媒体或增加native并发。

| 在线观察（含导入） | A改前 → 改后 | B改前 → 改后 |
| --- | ---: | ---: |
| 唯一图片预览artifact核实数 | 101 → 101 | 100 → 100 |
| 窗口ms | 21,013 → 21,822 | 12,805 → 13,633 |
| palette开始 / ready | 0 / 0 → 76 / 75 | 0 / 0 → 74 / 74 |
| 改后palette开始时primary仍活动 | 76 | 73 |
| 改后palette开始时观察到primary queued | 76 | 74 |
| 末快照palette queued | 改前未输出 → 61 | 93 → 26 |
| 当前构建结果 | 1 passed / 26.0秒 | 1 passed / 18.4秒 |

两次改后日志完整，事件无丢弃，revision匹配没有当前资产查找缺失。B全部74项可关联primary生成，等待p50/p95为2,075/2,345ms，成功job耗时11.6/36.1ms。A只有59/76项可关联primary生成，等待6,076/6,856ms；另16项没有对应generation日志（source-direct可以不生成primary artifact），1项缺该primary任务的revision关联，不把59项分位数泛化给所有任务。A有1个palette在窗口结束时尚未完成，保留76开始与75完成差值。

该结果证明在线派生任务已实际前进。两源完成相同图片目标的窗口分别增加809/828ms，且都含导入与系统缓存差异；不能把它们写成primary总吞吐提高，也不能凭单轮保证所有交互不变慢。短窗不证明全库派生排空率，proxy和音频仍未自然触发。

### 远跳与浏览器滚轮

同构建 `node node_modules/playwright/cli.js test tests/e2e/real-linked-navigation-perf.test.ts --reporter=line`，通过环境开启native scroll、等待导航、关闭CPU profiler。B **1 passed / 24.2秒**，A **1 passed / 31.4秒**；四跳实际位置及九成图片真实解码均通过。浏览器80次mouseWheel均实际移动1,600px，B/A分别4,164/4,039ms；末页30/30、24/25图片解码。不是前台OS物理鼠标/触控板测试。

| 本轮指标 | A | B |
| --- | --- | --- |
| 四跳首图ms | 381 / 240 / 233 / 411 | 370 / 281 / 252 / 248 |
| 四跳九成图片ms | 1,202 / 691 / 598 / 1,016 | 632 / 704 / 567 / 651 |
| 连续滚动frame p95 / max ms | 20.8 / 27.3 | 35.1 / 42.5 |
| 创建目录可见ms | 102 | 112 |

B上一轮相同native旅程frame p95为38.6ms、九成图片1,041/676/587/1,094ms；当前单轮数值更低，但未做多轮同构建开关对照，不作归因提速。A没有有效旧native基线；其第四跳有52ms long task、frame max72.3ms，且有1,202ms慢点，不能忽略或以滚动阶段零long task宣称整体流畅。

两次online和两次native旅程的自有应用均正常退出，新增catalog/profile/output都已清理。新增Worker核心测试在改为异步close与异步rm后首先完整 **exit0 / 7.37秒**，最终visible/urgent扩展回归为 **exit0 / 测试7.82秒**。先前被自动审批拒绝的6个目标仍保留，不扩大扫描或重试范围。

构建核对：当前 `src/worker/index.ts` SHA-256为 `3b34e91292ca6fa73087b754600149d08c849403a7ab96e29d7c51a7f6e1228a`，当前 `.vite/build/library_worker.js`为 `efdd93680dedefc12f800ea7381785d740bd9bbbdb0f18a3eb1cf9bba1cb71a3`；后续只有测试/文档收尾，没有另改产品代码。

### 四列追溯

| 需求增量 | 实现位置 | 自动化证据 | 人工/平台证据 |
| --- | --- | --- | --- |
| 主队列不断续波时派生仍前进 | `src/worker/index.ts:1259` | `tests/worker/media-fairness-scheduler.test.ts:273`；真实online两源0→75/74 palette ready | 当前构建隐藏Windows Electron；原实例同负载、前台、packaged/macOS未验证 |
| 竞争期单任务领取，排空后恢复批量 | `src/worker/index.ts:2190` | 新Worker测试`:278`及最后全部10项完成 | Worker真实Sharp/SQLite；不是长期吞吐基准 |
| 可见波跨idle保护与controller清理 | `src/worker/index.ts:1114` / `:1255` / `:2077` | 新Worker测试`:283`至`:312`，可控visible波超过2秒，普通secondary调用无增长且palette queued | 强制挂起的Worker路径；浏览器前台人工未执行 |
| pause与urgent期间保留普通wake | `src/worker/index.ts:2008` / `:2052` / `:2187` | 新Worker测试`:315`至`:355`，暂停/partial explicit/full resume/urgent hold后不额外wake，10项succeeded；既有13项通过 | grant竞态为Worker控制，未自然触发真实视频proxy，不能据此声称proxy吞吐通过 |
| 卡片和远跳继续真实解码 | 既有Renderer/协议路径，本轮未改 | 同构建native浏览A/B各1 passed；四跳及末页覆盖见上表 | 隐藏Windows Electron的CDP事件；OS物理鼠标/触控板未验证 |

## 本轮停止范围

用户要求当前优化收尾后停止。本轮只完成这条主预览/派生调度改动、其测试与审查/记录；上述reporter与固定SQL成本候选留作后续，不再实施。完整性能目标未达到，保留人工、平台及其他链路缺口，不关闭整体工单、不提交推送。
