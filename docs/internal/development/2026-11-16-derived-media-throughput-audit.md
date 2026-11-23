# 派生媒体吞吐只读审计

整体 `Serpent-3kfe` 的后续调查，Luna 只读审计，主 agent 整理。不新增性能通过结论，不修改产品或原始素材。现阶段优先量在线排队等待，而不是只量 backlog 全部排空后的处理速度。

本审计的初始测量已补两组真实隐藏Windows Electron在线观察，照片源明确读到色卡排队3→93项、primary持续处理，而观察窗没有色卡领取/完成记录。下文“目前没有新测试”均是测量前的阶段记录，末节保留当时没有产品改动的事实。后续公平调度已在独立增量实施：同目标窗口两源palette从0到75/74，相关回归与4次真实Electron通过；详细限制、清理拒绝及用户要求的停止范围见[当前开发记录](2026-11-16-media-primary-secondary-fairness.md)。整体性能目标未收口，当前按要求暂停。

## 可用真实素材

在没有 Electron/性能测试运行时，各遍历一次已授权源，只读目录项和文件长度，不解析媒体头。两树 reparse/unreadable 均为零；不记录真实名字、路径或 ID。

| 类别 | 源 A 个数 | 源 A 总字节 | 源 B 个数 | 源 B 总字节 |
| --- | ---: | ---: | ---: | ---: |
| 普通图片 | 28,708 | 14,895,095,130 | 12,749 | 41,740,164,773 |
| 视频 | 216 | 7,865,094,612 | 2 | 721,446,154 |
| RAW | 0 | 0 | 2,700 | 85,193,988,608 |
| 音频 | 0 | 0 | 0 | 0 |
| 其他/辅助 | 6 | 503,796,789 | 14 | 140,959,258 |

A 普通图片大小 p50/p95 为 138,662/1,892,743 字节，B 为 1,506,874/11,599,872 字节。A 视频为 214 个 MP4、2 个 FLV；B 为两个较大的 MP4，RAW 全部为 ARW。不能凭这些来源宣布无样本的音频 proxy 已验证。B 滚动比 A 慢还可能受到真实媒体大小/格式分布影响，不能只归因布局。

## 代码事实与待测推断

1. palette 在 primary 成功路径入队，优先级低；常规 secondary 由 primary wave 收尾后启动，首次还有 1 秒延后。持续 primary backlog 可能拉长 palette 的排队等待，但这是保护可见预览的现有策略，尚未证明当前总耗时中其占比。显式 playback proxy 有 urgent secondary 路径，不能将 palette 的常规尾部等待泛化给所有 proxy。
2. 静态缩略图处理会先建 Sharp probe 读 metadata，再建输出 pipeline；缺尺寸时还有专用 header read。存在多 pipeline/open 的代码事实，不等于多次完整解码；缓存、格式与源盘会影响成本，不能先按重复整文件读取算收益。
3. interactive/visible-media 优先、native semaphore、非可见解码并发 2、claim 前 yield 已存在。连续交互会压低 secondary 进展；评价策略必须同时量交互延迟与派生完成率。

主位置：`library-service.ts` 的 image generation / palette enqueue / queue worker cap，`worker/index.ts` 的 primary 收尾/secondary pump 与交互 idle gate，`handlers/media-generation.ts` 的 urgent explicit proxy。历史单 job 加 50ms gap 已调整，不能重复记为现存原因。

## 可复用基准与缺口

`palette-benchmark.test.ts` 已用真实样本、生产 Service 队列对比原图/缩略图输入及 wave/gap。其阶段先 drain primary，再量 palette，不能反映在线排队；Service 模拟也不等于实际 Worker scheduler。`media-task-performance.test.ts` 可量 RSS/lag/mixed decode，`real-media-queue-pause.test.ts` 已证明暂停/恢复语义，不能拿暂停后的安静 UI 当 busy 交互证据。

下一次测量应在同一隔离 catalog/profile，按 asset+revision 在内存关联 thumbnail 完成、palette/proxy 排队、领取、实际完成的时间；输出只保留匿名 p50/p95/max、unique 成功数、类型和吞吐。确认 secondary 真正在运行时测同一目录/Inspector 动作，再等自然 idle 重复，分别记录命令队列和实际图片解码。不存在的媒体类别单列未执行；任何调度改动先保留现状基线，再验证自动暂停边界与真实 busy 交互。

目前没有新吞吐测试结果，没有实施新的 fairness/并发改动，也未提交推送。

## 在线等待的短测量方案

补充只读核对：缩略图成功后尝试以priority -10排自动palette；primary满额wave可以继续立即推进、background还可补下一批，普通secondary常规在primary让出后启动，首轮约1秒延迟且交互idle窗口通常2秒。secondary有波次数量和共享native decode上限。这些路径使「primary连续有工作时palette被持续推迟」成为可证伪候选，尚无在线时间分布证明。

复用 `real-media-queue-pause.test.ts` 的真实链接源、事件订阅、100个真实缩略图完成目标和暂停收尾，但将订阅提前到导入前。短观察中只在内存关联缩略图batch-ready、palette derived-ready及现有job-start/job-finish，按同资产revision汇总主缩略图完成到palette开始/完成的等待、成功量及primary仍活跃证据；达到目标后暂停退出，不再跑长时间自然drain。若现日志无法证明波次连续性，再考虑仅在诊断开关下补关联字段，不能先扩协议。

必须区分三类：全库暂停是用户意图，palette不进队/不执行不构成饥饿；普通可见预览仍属automatic；urgent proxy只有explicit grant才能绕过idle，且只领取explicit任务。代理另用真实视频的自然fallback路径测，没有实际触发就记未观测。先排空primary的palette基准、内存耗尽旅程及暂停后空闲都不能代替这个测量。

若实测确认等待问题，候选是在无可见请求且用户交互已空闲时，在primary waves之间给予有界secondary配额，保留native并发上限并对照可见图片延迟。不能只提高priority或增加并发。该阶段目前仍是方案，没有实现或测试结论。

## 在线观察的实际结果

新增 `tests/e2e/real-online-derivatives.test.ts`。主agent核对后补充launch失败时禁止未确认进程退出即清理的保护；Luna修正快照类型、异步导入状态容器及有界退出。测试复用生产typed API、真实链接导入与普通All Assets浏览，在导入前订阅，最多观察30秒或100个唯一已验证图片artifact。就绪事件必须与公开资产摘要的artifact/current revision对应；停止窗冻结后才暂停收尾，不把暂停后的安静状态当作在线吞吐。没有调用retry、urgent、显式派生请求或直接读SQLite。

执行：当前产品构建，串行 `node node_modules/playwright/cli.js test tests/e2e/real-online-derivatives.test.ts --reporter=line`，通过运行环境传只读源，隐藏并隔离profile/catalog，无并行lint/tsc。产品构建与普通目录行测量一致，详细日志开关会增加诊断成本，因此不是无instrumentation的最终吞吐基准。

| 观察 | 图像源A | 照片/RAW源B |
| --- | ---: | ---: |
| 导入资产数 | 28,930 | 15,465 |
| 在线窗（含链接导入），ms | 21,013 | 12,805 |
| 唯一图片artifact核实数 | 101 | 100 |
| primary start / generated / finish日志数 | 198 / 102 / 197 | 102 / 100 / 100 |
| palette start / finish / ready记录数 | 0 / 0 / 0 | 0 / 0 / 0 |
| 未截断队列快照数 | 8 | 6 |
| 首→末快照primary queued / running | 首版未输出 | 46 / 3 → 456 / 3 |
| 首→末快照palette queued / running | 首版未输出 | 3 / 0 → 93 / 0 |
| palette queued非零快照数 / 最大观察值 | 首版未输出 | 6 / 93 |
| Playwright结果 | 1 passed / 25.6秒 | 1 passed / 17.5秒 |

A完成102个primary生成，其中1个非图片事件不计入图片目标；101来自就绪batch超出100目标，不重复计数。primary完成日志包含取消或其他终态，不能用finish总数冒充成功吞吐。B补充了队列类型计数；A没有的列保持未输出，不从B倒推。两次日志均无缺失或截断、无事件转发丢弃、当前revision查找无缺失；各快照queuePaused均false，但没有公开逐任务admission origin字段。窗口内0次palette开始，不能计算非空等待分位数，也不能把空分布写成0ms。

测量轮询使用 `asset.list`、`media.list-jobs`，代码核对两者均属于 `NON_PREEMPTIVE_MEDIA_COMMANDS`，且不命中 `noteInteractiveMediaRequest` 的显式记录分支。因此它们不会直接续期2秒idle窗或主动中断自动媒体；它们仍占有少量Worker读取时间，不能声称完全无扰动。普通UI可见媒体请求与primary连续wave仍需进一步区分贡献。

B证明短在线窗确有已排队palette未被领取，支持继续审查primary与secondary交接及idle窗；不证明无限饥饿，不把含导入的12,805ms当作每个palette的等待时间。源内没有音频，测试也没有自然触发proxy，音频/视频代理吞吐仍未验证。下一实现候选仍是可见需求优先、交互idle后在primary波次之间给予有界secondary配额；先建立稳定自动化复现，保留全库暂停/精确显式请求/共享解码上限，再做同构建前后对照，不直接提高并发。

测试文件定向ESLint通过；此前完整typecheck本文件0项诊断，但命令因其他CLIP轨道4项错误退出1，后续新增计数字段只跑定向lint，不扩大为全仓类型通过。两次拥有的应用均正常退出，catalog/profile/output均边界/reparse检查后清理；此前其他失败旅程被拒绝删除的两个目标未重试。原始素材未改名、移动或删除。该阶段只有诊断测试和文档，没有新增用户可验收产品功能，不关闭工单、不提交推送。
