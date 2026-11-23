# 虚拟画布滚动的重复渲染

工单 `Serpent-47cc35`，属于整体性能工作 `Serpent-3kfe` 的一个增量，不能据此关闭整体性能问题。

## 根因与实现

`useCanvasLocalViewport` 原先把精确的滚动坐标放入 React state。即使挂载范围和实际可见卡片没有变化，每个像素的滚动仍会让虚拟画布遍历、重建整片已挂载卡片。两侧各约五屏的 overscan 是既有连续性保障，直接缩小会重新暴露快速滚动白带，不能作为本轮优化手段。

复用现有几何序列和二分窗口查询，生成包含每列挂载区间、可见区间及首尾实际相交状态的键。只有这个键改变才更新渲染状态；锚点 WeakMap 的精确 scrollTop 仍在每次 scroll 回调先更新，不等待 RAF 或停手。几何、卡片大小与容器尺寸变化重新测量；没有提供几何键的旧调用者保留精确坐标更新行为。瀑布流和平铺虚拟画布使用同一机制，未改媒体协议、后台调度、数据库或预加载范围。

首尾相交状态不能省略：窗口查询为了保证存在槽位会在空隙或列表末尾保留一项，这并不等同于该项实际可见。测试按每个像素及反向遍历，对照完整可见集合，验证相同键不会漏掉可见性变化。

## 验证及边界

| 需求条目 | 实现位置 | 自动化测试 | 人工或平台证据 |
| --- | --- | --- | --- |
| 无成员变化不重复渲染 | `src/renderer/viewport-window.ts:45`、`browse/virtual-browse-canvas.tsx:262` | `viewport-window-hook.test.tsx:82`、`:95`：相同 100 次像素滚动，无键至少 100 次渲染，有键为 0 次 | 隐藏 Windows Electron 真实媒体对照；未进行前台视觉验收 |
| 相交成员变化及时更新 | `virtual-browse-canvas.tsx:262`、`:938`、`:1095` | `virtual-browse-canvas.test.ts:38`：不等高列、空隙、首尾、正反向逐像素比较；hook 断言同步跨边界发布 | 四次远距离跳转检查实际图片解码，连续滚动后覆盖率至少九成 |
| 锚点、缩放和返回不退化 | `viewport-window.ts:64` | `viewport-window-hook.test.tsx:105`、`:118`：精确锚点快照、远跳、resize、几何回调更换、折叠后恢复 | 原实例及 packaged/macOS 未验证 |

定向命令：`npx vitest run tests/unit/viewport-window.test.ts tests/unit/virtual-browse-canvas.test.ts tests/unit/viewport-window-hook.test.tsx`，最终 **3 files / 36 passed**。旧调用者对照计数最初写成恰好 100 次，但 React 可能额外执行一次同状态更新的丢弃渲染；断言改为每次坐标变化都发生渲染，并保留最终坐标断言。新路径仍严格为零次。修改文件定向 ESLint 通过。全仓类型检查仍被另一项未提交的文档媒体预览开发的四项类型错误阻断，本增量的文件没有类型错误；不能写全仓通过。

用户明确表示本轮不需要 Computer Use，因此未进行前台操作。Luna 独立 Standards 与 Spec 双轴只读审查未发现有证据支持的正确性阻断，并提醒新键计算仍有分块几何查询成本；必须通过真实 profile 衡量，不能只凭少了 setState 推断端到端提速。

## 真实媒体对照

新增 opt-in `tests/e2e/real-linked-navigation-perf.test.ts`。源目录只通过 `SERPENT_REAL_NAV_SOURCE_ROOT` 指定；隐藏 Electron 使用隔离 userData 和临时资源库，只链接真实源树，不修改其文件。每次测量同样的 28,930 项媒体、窗口尺寸、四个跳点及四秒连续滚动，记录可见图片实际解码、帧间隔和 CDP CPU 样本。测试创建的文件夹位于隔离托管库中。

前期运行与另一个媒体 Worker 基准及类型检查存在重叠，不作为受控性能对比。之后停止这些并行任务，暂时从 HEAD 恢复本轮两个产品文件构建对照，在 finally 中恢复优化源码，再重新构建优化版。未切分支、创建 worktree、重启或终止用户实例。

首轮独占基线命令：`node scripts/run-e2e.mjs tests/e2e/real-linked-navigation-perf.test.ts --output=test-results/real-nav-ab-baseline`（提前设置上述源目录变量及隐藏窗口开关）。1 passed；优化版输出到 `real-nav-ab-optimized`，重新构建后 1 passed。脚本样本 753→394（约少 48%），帧 p95 19.2→18.8ms；四个跳点九成解码为基线 898 / 664 / 657 / 989ms、优化 1149 / 655 / 590 / 1036ms，没有稳定提速。

Luna 补审指出，原测试虽记录了位置和覆盖率，却没有强制断言目标位置和九成解码；单独的 passed 不足以证明这两点。现已逐跳断言实际滚动比例距离目标小于 0.01、当前可见图片解码覆盖率至少 0.9、九成解码时刻非空。另把 Profiler.start 移到 frame probe 重置之前，并清除上一帧时间戳，排除采样器启动暂停。首轮约 130ms 最大帧间隔因此不能全部归为滚动卡顿。

加强断言后的最终 HEAD/优化版分别输出到 `test-results/real-nav-asserted-baseline`、`test-results/real-nav-asserted-optimized`，均重新构建，**各 1 passed**：

| 指标 | HEAD 对照 | 优化版 | 解释 |
| --- | --- | --- | --- |
| 连续滚动脚本 CPU 样本（不含 idle/program） | 663 | 437 | 约减少 34%，是采样工作量而非耗时 |
| 连续滚动帧间隔 p95 | 18.9ms | 18.7ms | 差异小，不能宣称显著帧率提升 |
| 连续滚动最大帧间隔 | 50.8ms | 64.5ms | 仍有偶发长帧，单轮未改善 |
| 四次跳转九成解码 | 1381 / 967 / 597 / 1063ms | 1197 / 743 / 610 / 1040ms | 三处下降、一处上升；结合首轮，不能宣称稳定端到端提速 |
| 实际跳转比例 | 0.04977 / 0.55016 / 0.85026 / 0.24998 | 0.04976 / 0.55016 / 0.85026 / 0.24998 | 均到达目标附近，差值小于 0.0003 |
| 跳转观察结束图片覆盖率 | 全部 100% | 全部 100% | 均为真实 decoded 图片 |
| 连续滚动后图片覆盖率 | 100% | 100% | 无白屏或整批不解码的自动化回归 |
| 创建托管文件夹至侧栏出现 | 263ms | 294ms | 非本次优化目标，不归因于本次改动 |

CPU 样本数是同采样方式下的工作量线索，不等同于毫秒，单次对照也不能证明所有负载的普遍提速。文件系统和图片缓存没有强制冷却，不能把跳转结果视作严格冷盘性能。当前可交付的是减少无效渲染，尚未解决图片等待或尾部卡顿；单一 Luna 审查记录见 `../reviews/2026-11-16-virtual-viewport-render-membership-review.md`。

每次 app 正常退出后 finally 清理自建隔离目录，源树保持只读；已检查本轮临时资源库为零。前六个本轮 `real-nav-*` 测试输出目录仅各含一个 45 字节运行状态文件，按已解析父目录及无链接检查后申请清理，被自动审批拒绝，返回 `blocked by policy`，没有更具体原因。新增两次加强断言的输出另按单一已知文件、固定长度、无链接、非递归空目录删除申请清理，也被同一策略拒绝；未重试前六个目录。现共八个目录、八个 45 字节状态文件尚未清理，已向用户报告，未绕过。先前 RAW 测试输出清理被自动审批拒绝的目录不属于本轮清理范围，未再次尝试删除。

## 有界真实媒体 Worker 观测

Luna 新增 `tests/worker/real-media-navigation-performance.test.ts`，复用既有服务、导入冲突处理及媒体队列。两条只读源目录由环境变量指定；最多 32 项、单文件最多 128 MiB、合计最多 512 MiB，拷入隔离库后才做移动及文件夹操作，任务串行。空间预检在建临时库前完成，finally 关闭服务并清理；清理失败明确报错。不是大型队列或正式 20k 分布基准。

最终独占命令：`node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/real-media-navigation-performance.test.ts --disableConsoleIntercept`（先设置 `SERPENT_REAL_MEDIA_NAV_BENCH=1`、`SERPENT_REAL_MEDIA_NAV_SOURCE_A/B` 和本地临时父目录变量）。**1 passed**，测试体 6.97s。24 项真实样本合计约 164 MiB，包含 ARW、GIF、JPG/JPEG、EXR、PNG、TGA、TIF/TIFF、WebP；仅一张 RAW，另有大尺寸图，未覆盖视频/音频/模型。

- 库打开 10.38ms；冷导航摘要 4.72ms；首屏服务调用 2.28ms；托管建夹 3.76ms、建后摘要 2.68ms、文件夹首屏 2.39ms。均是 24 项隔离 Worker 调用，不是用户界面时延或大型库结果。
- 缩略图 12 jobs / 2902.55ms，约 4.13/s；12 个缩略图产物都经过 Sharp raw 像素解码，含一项 RAW。其余样本不据此宣称有独立缩略图。
- 色卡 24 jobs / 327.88ms，约 73.20/s；24 个产物均为非空数组。Inspector 元数据 p95 2.54ms、技术元数据 p95 2.35ms。导航细分诊断未收到，只有调用总时延。

早期样本预算和色卡路径 usage 错误是测试问题，已修正；另有一次 `IMPORT_APPLY_FAILED` 未定位根因，独占重跑通过不能关闭它，保留 `Serpent-f9be03`。这个小样本观测不提供后端提速结论，也不替代调度竞争复现。最终 Worker 临时目录为零。主 agent 后续加强测试清理：关闭服务抛错也尝试目录清理，同时保留原失败与清理失败两类反馈；这项测试防护经静态审查，不另作产品性能通过证据。

本轮没有运行 Worker 20k 混合媒体基线：产品改动仅在 Renderer，真实 28,930 项旅程也不能冒充该 Worker 标准分布基准。后台媒体吞吐、代理、库生命周期及删除后布局等整体目标仍未完成；旧版实例的导航问题另见 `2026-11-16-current-instance-linked-navigation.md`。
