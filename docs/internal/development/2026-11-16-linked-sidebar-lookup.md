# 展开链接目录树的重复查找

工单 `Serpent-e2e778`，整体性能目标继续，未提交推送。

## 根因与范围

`NavigationSidebar.renderDirectoryEntries` 对每个展开的linked行调用一次 `linkedFolders.find`。当前真实照片源有1,045个目录行；同一目录列表每次重建会重复扫描完整数组。分页补取摘要通过App的 `setAssets` 触发父组件重渲染，Sidebar及行组件没有memo，因而这项计算不只发生在首次打开时。目录闭合后代已经过滤，不是本次问题。

在既有Sidebar中按 `linkedFolders` 数组引用useMemo建立folderId索引；按原顺序首次出现才插入，保留旧find的first-match语义。数组替换后重建，行操作继续捕获当前summary。没有改选择、离线显隐、展开、编辑、拖放或主题样式。它消除了一个按目录数量平方增长的查找点，**不等于整个Sidebar已变成线性，也不等于整体滚动已经流畅**。

## 测试与审查

`npx vitest run tests/unit/navigation-sidebar.test.ts`：**44 passed / 7.88秒**。新增测试验证替换数组后的label、离线状态、hover路径、relink与context操作；48项虚构目录的folderId getter访问量满足线性上界，可区分旧逐行find的三角扫描，不使用易波动的时间阈值。相关Renderer/测试文件定向lint零错误零警告。

`npm run typecheck`仍只有其他CLIP轨道4项既有错误，本增量未出现新类型错误；extension检查因前一段失败未执行。按改动层级没有跑Worker、资源库可用性或20k Worker门禁。

单一独立Luna完成Standards/Spec审查，未发现具体产品阻断。保留覆盖限制：替换summary后没有专门dispatch链接子目录的copy/native-import drop；该回调仍在每次render从当前Map取得lf，但不能把静态核读当成该路径实际执行。见[审查记录](../reviews/2026-11-16-linked-sidebar-lookup-review.md)。

## 当前构建的真实回归

首轮用 `node scripts/run-e2e.mjs tests/e2e/real-linked-navigation-perf.test.ts --reporter=line` 重建，之后复用同一构建直接调用Playwright。两个真实源分别28,930/15,465资产。所有运行隐藏隔离、串行，运行期间没有其他测试/类型检查/源树枚举竞争，原始素材只读。当前4个Renderer JS连续内容SHA-256：`91f4a75cc727611c056a1924bbb9a1c75f42230355838ee1c4f6b7696ef37afd`。

此次显式设 `SERPENT_REAL_NAV_WAIT_NAVIGATION=1`，目录出现后再测，源A挂载1个linked目录行、源B挂载1,045行。早期默认旅程没有此强制前置条件，故下表是当前真实基线，**不能直接算成Map带来的提速比例**。

| 当前构建 | A | B |
| --- | --- | --- |
| 保留旧CPU profiler的旅程结果 | 1 passed / 29.8秒 | 1 passed / 24.7秒 |
| 该滚动段p95 / max ms | 19.9 / 27.1 | 49.1 / 72.8 |
| 关闭profiler的普通旅程结果 | 1 passed / 27.9秒 | 1 passed / 24.0秒 |
| 普通四跳首图 ms | 374 / 235 / 233 / 287 | 444 / 310 / 379 / 285 |
| 普通四跳九成解码 ms | 864 / 664 / 560 / 772 | 816 / 687 / 563 / 679 |
| 普通四秒滚动p95 / max ms | 19.3 / 22.6 | 46.3 / 61.3 |
| 普通滚动结束真实图片解码 | 25 / 25 | 30 / 30 |
| 普通创建可见（工具墙钟）ms | 60 | 121 |

普通旅程设 `SERPENT_REAL_NAV_PROFILE_SCROLL=0`，日志明确 `hasCpuProfiler=false`、scriptSamples=null，没有把未测样本填零。四跳均检查实际位置容差和九成解码，两个普通滚动窗long task均为0，但B的46.3ms p95仍明显不达理想流畅度；不能用无long task宣称无卡顿。源A/B媒体和目录结构不同，不能用它们的差值单独归因目录树。

## 渲染边界候选尚未落地

同一未含Map的已记录构建、源B保持导航可见，临时加 `contain: layout style` 的四窗实验 **1 passed / 32.4秒**。导航client尺寸、内部滚动extent及canvas宽高均不变，各窗30/30图片解码；p95依次30.8→27.7→30.0→29.1ms。收益只有约1–3ms，未将它作为产品CSS改动。保留完整导航语义的屏幕外工作量控制仍待设计与验证，不能把整栏隐藏作为产品方案。

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 展开linked行避免重复完整数组扫描 | `src/renderer/NavigationSidebar.tsx:1323` / `:2229` | `tests/unit/navigation-sidebar.test.ts:1440` | 当前构建源B1,045目录行隐藏Windows Electron，远跳、图片解码与创建通过；前台未执行 |
| 保留first-match及当前summary交互语义 | `src/renderer/NavigationSidebar.tsx:1323` | 当前summary：`tests/unit/navigation-sidebar.test.ts:1354`；重复ID仅静态核读，无独立夹具 | 两真实源普通旅程各1 passed；copy/import替换交错、packaged/macOS未验证 |

`NAV-LOOKUP-035`待人类验收，新建output/catalog在拥有的进程退出后已清理。前台按用户要求未执行，原用户实例同负载未验证。接下来继续解决屏幕外目录工作量和在线后台任务等待，不关闭整体目标。

收尾核对：新增诊断夹具中4处盘符假例已全部改成相对虚构路径，涉及未提交文件，不需要重写历史，也未写入真实隐私数据。8个本轮诊断/开发/审查文件及选定产品、测试、状态清单的新增行进行路径/已知隐私词增量扫描，最终0项；不将该范围扫描冒充提交前全仓门禁。最终诊断8项再次通过、定向lint通过，`git diff --check`通过；最终typecheck仍仅4项其他CLIP错误。测试新建目录检查无本轮残留，未触碰旧的归属不明或曾被拒绝清理目标。
