# Issue #75：超大资源库加载与预览故障诊断（2026-10-31）

后续实施方案见[大库导航与 OIIO 路径修复方案](../implementation/2026-10-31-large-library-navigation-and-oiio-design.md)，包含历史失败恢复、持久化目录投影、读路径替换和验收边界。

证据来源：[Issue #75](https://github.com/dolag233/Serpent/issues/75) 的截图与[所附会话日志](https://github.com/user-attachments/files/34010369/serpent-20261027T165412.log)、当前 `dolag_dev` 源码，以及本机使用仓库内置 `oiiotool` 对虚构临时图片做的隔离复现。本文不记录日志里的真实资源库名、目录名、文件名或绝对路径。此轮只做诊断，没有修改产品代码，也没有用真实用户库做性能复测。

## 结论及证据边界

| 现象 | 可确认的证据 | 结论 |
| --- | --- | --- |
| 开库后操作等待很久 | Worker 启动到 `recent-library.restored` 约 1.67 秒；随后一次 scheduler stall 显示两个媒体查询排队约 54 秒，同时有一项开库对账运行约 68 秒、两项导航摘要各运行约 54–56 秒 | **确认存在开库后的 Worker 响应延迟**；1.67 秒只代表库恢复事件，不能当作首屏绘制或全部加载完成时间 |
| 大量非直出图片预览失败 | 日志中 522 条 `worker.media-job.failed`，其中 515 条为 `OIIO_COLOR_TRANSFORM_FAILED`；对应错误均为 OIIO 将文件名当作匹配模式但找不到文件，涉及 513 个不同源路径，全部在祖先目录中含字面 `#` | **已确认预览失败的直接根因**：OIIO 参数未关闭序列通配符，错误分类又将输入解析失败误报成颜色变换失败；这不是 515 次独立的 OCIO 配置故障 |
| 预览失败持续出现 | 515 条错误从会话开始后约 4 分钟持续到日志结束，09:45 和 09:46 的失败数分别为 248 和 190；另有 12 条媒体资源不足事件 | 批量重试或重新发现造成大量无效工作，但日志缺少单任务 CPU/IO 耗时，**不能量化它对整体卡顿的占比** |
| 截图里部分 JPG 也没有画面 | 截图中有缺少预览的 JPG；日志记录了 169 次 source request，但没有对应的完成和浏览器图片解码时长 | 不能把 JPG 空白归因于 OIIO 的 `#` 故障；需独立追踪 `serpent://source` 查询、响应和 `naturalWidth` |

日志覆盖约 70 分钟，只出现一次包含上述并发快照的 `worker.scheduler.stall`。没有完整的开库关键路径耗时、逐阶段导航耗时或首屏绘制时刻，故不能声称整段 70 分钟都在“开库”。截图显示约 14.9 万资产，只说明取图时导航数据已显示。

## 已复现的确定性故障：`#` 路径

`generateOiiOThumbnail` 在 `src/worker/library-service.ts` 约 29210–29325 行直接将源路径传给 `oiiotool`，未在路径参数前设置 `--wildcardoff`。OIIO 官方文档规定 `#` 可作序列匹配通配符，并提供 `--wildcardoff` 禁用随后参数的扩展：[oiiotool 文档](https://openimageio.readthedocs.io/en/latest/oiiotool.html)。隔离复现用内置 OIIO 生成 4×4 BMP，并将其放在名字含 `#` 的虚构临时目录：正常调用返回码 1，错误文字与 Issue 日志一致；在输入路径前增加 `--wildcardoff` 后返回码 0、PNG 输出存在。临时目录已清理。

随后用真实 `LibraryService` 管线和虚构链接目录下的 4×4 TGA 再复现：OIIO 直接调用返回码仍为 1，关闭通配符后为 0；`generateThumbnail` 实际抛出 `MEDIA_PROCESSING_FAILED`，诊断错误码为 `OIIO_COLOR_TRANSFORM_FAILED`，错误正文仍是 `No filenames found matching pattern`。这证明该错误穿过完整的导入、资产定位和缩略图路径，不只是独立命令行行为。诊断测试 2/2 通过；临时测试源文件在记录结果后移除，不作为永久回归测试。

非 RAW 分支把所有非零退出码都标为 `OIIO_COLOR_TRANSFORM_FAILED`，因此输入路径展开失败进入错误工件和媒体任务失败统计，掩盖了真正原因。应在所有接收用户或用户可控临时路径的 OIIO 调用点审计该参数，包括缩略图、查看器图、`--info` 探针、FBX 贴图转换；不要只补日志中当前图片格式。成功修复后应精准重试因这类错误失败的工件，避免重跑整个大库。

## 导航摘要的放大机制及待证实瓶颈

开库与切库的渲染器流程会以 `blockingLibraryLoad: true` 请求首次导航摘要，并在 `src/renderer/App.tsx` 约 4753、4792、4872、5150、6396 行等待其返回后提交内容或撤掉加载状态。因此摘要的尾延迟可直接变成用户看到的等待；普通浏览走延后补侧栏流程。

`getLibraryNavigationSummaryAsync`（`src/worker/library-service.ts` 约 16564）在缓存命中前依次读取计数、托管文件夹、链接文件夹、标签和合集。每段之间的 `navigationCheckpoint()` 只让事件循环运行下一轮；函数仍持有 scheduler 中的请求。缓存仅在摘要建完后写入；同一时刻相同 key 的请求没有 single-flight 合并，故两个并发冷请求可能重复做整轮工作。

其中 `listLinkedFolders`（约 18231）为每个链接根读取所有链接资产相对路径，按路径层级聚合计数，还调用 `collectLinkedDirectoryPrefixesFromDisk`（约 18193）用同步 `readdirSync` 递归遍历真实目录，以显示空文件夹。即使返回给 UI 的子文件夹数很少，它仍可能扫描大量文件夹；在慢盘或网络盘上，同步遍历会阻塞 Worker 的事件循环。代码显示这是结构性的规模风险，**现有日志没有证明本次 54–56 秒具体消耗在此阶段**。SQL 计数、锁竞争、对账阶段或盘延迟也需计时区分。

针对该环节又做了一次隔离 Worker 测试：新建空的链接根后，`listLinkedFolders` 耗时约 2 ms；在同一根下建立 4,100 个空目录且不增加资产，耗时约 551 ms。首次单个 `getLibraryNavigationSummaryAsync` 耗时约 562 ms，其中几乎全部可由链接目录枚举解释。两个相同选项的并发冷摘要耗时约 1,076 ms，`listLinkedFolders` 被调用两次；测试定时器观察到最长约 975 ms 的事件循环间隙。测试命令为 `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/issue-75-diagnostic.test.ts --reporter verbose --silent false`，结果 2/2 通过。诊断测试是本次临时文件，记录结果后移除；其源文件不作为持续回归测试。测试在 Windows 本地磁盘使用虚构临时库，运行后删除临时库；它证明同步目录枚举与重复扫描能阻塞本地 Worker，**不等同于复现 Issue 环境中的 54 秒绝对耗时**。

Scheduler 将 `library.navigation-summary` 列为可与 maintenance 并发的轻量状态读，最多允许三项（`src/worker/interactive-scheduler.ts` 约 132、715–772）。这与其全量聚合和同步磁盘遍历的实际代价不符。本次 stall 快照同时出现对账和两项摘要；排队的媒体查询实际等了约 54 秒。把摘要简单调高优先级不能解决同一 Worker 的同步阻塞和重复计算。

## 修复顺序

1. **先修正确性**：在路径参数前统一禁用 OIIO 通配符；区分打开输入失败、颜色变换失败和资源不足；针对历史 `#` 失败任务提供一次性重试/失效。用含 `#` 的虚构目录验证 TGA/BMP 等预览真实解码（图片 `complete && naturalWidth > 0`），并验证 OIIO 错误不再误分类。
2. **测出导航摘要分段耗时**：给首次摘要的计数、托管目录、链接资产路径查询/聚合、真实目录遍历、标签/合集及最终序列化加低开销耗时指标；同时记录开库对账阶段、scheduler 等待、事件循环延迟、source request 与首个可见卡片成功解码。现有 `SERPENT_REFRESH_STAGE_LOG=1` 可提供部分对账阶段信息，但这份会话日志未开启，且不能替代摘要内部计时。
3. **重构链接目录读模型**：目录结构与计数由链接扫描/文件监视增量维护并写入可查询的目录索引；同步递归磁盘遍历不应发生在开库的导航请求内。空目录必须在索引中保留，离线链接根也应显示最后已知结构。若索引迁移范围过大，可先用后台分片构建加缓存作为过渡，但要在真实规模下验证首屏与一致性。
4. **去重与调度**：对相同库、浏览变更序列和显示选项的导航摘要做 single-flight；失效时只刷新受影响的部分。摘要成本降为有界读之前，不应把它按轻量状态读并发放行。核对维护任务的让出点与可见媒体解析之间的公平性，保证文件夹切换不会继承开库对账的长等待。
5. **复测产品目标**：补约 15 万链接资产、深目录、空目录、慢目录枚举和含 `#` 路径的隔离 fixture，记录库身份/阶段反馈、结构加载、首个浏览页、首个可见预览、切文件夹、媒体查询等待的 p50/p95。现有 2 万资产混合库性能基线主要覆盖托管资产，不能证明此场景。真人截图里的 JPG 空白另用 source 响应和浏览器解码证据关闭。

这两类缺陷应分别验收：修好 OIIO 不自动证明 54 秒 Worker 等待消失；优化导航也不自动恢复已经失败的预览。打包/发布应以对应回归和真实应用验收为准，不能从这份诊断推定通过。
