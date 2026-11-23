# 查看器返回与显式重排的所有权

工单 `Serpent-48191b`，由真实大库性能回归发现。整体性能目标继续，不提交推送；当前没有用户验收结论。

## 复现与根因

隐藏隔离真实图像库中，平铺/瀑布流底部查看返回后，立即将卡片调至最大档，等待 `is-reflow-restoring` 消失超时60秒。起初 `data-preview-scroll-hold=1`，后续hold已结束，class仍保留。测试新建进程及目录在退出后清理。

调用链：App的 `resizeAssetCards` 先加重排class，再调用 `scheduleAnchorRestore`。调度器遇到1.5秒的preview hold直接return，既不安排frame也不终结callback。hold的timer只释放自身标记，故caller的重排状态永久滞留，虚拟几何补偿也一直让行。该scheduler文件本轮此前未改；定向复现实际 **11 passed / 1 failed**，held调用的终结次数0而预期1，独立于新的viewport hook。旧安装包同场景未跑，不声称已完成历史版本对照。

还有同类取消缺口：打开查看器或进入preview/restoring状态会手工cancel RAF并清ref，却没有移除scheduler注册的用户输入监听，也不会终结重排guard。修复应统一这些状态的终结与所有权转交，不能只在超时后删class。

## 方案

- 每次新的anchor调度尝试都有终态：无anchor或被hold拒绝也回调当前尝试的收尾；被动resize仍不抢viewer滚动所有权。
- 扩展既有 `cancelScheduledAnchorRestore`，区分静默替换和通知终结。新调度替换旧任务时不通知旧callback，防止旧owner清新anchor；明确终结时，取消RAF/输入监听并通知当前callback恰一次。
- 显式用户缩放/面板重排可以接管已关闭查看器的返回保护。先废弃旧generation、cancel旧view/focus restore、清hold，然后同步清restore UI状态，再捕获新的anchor。仍打开的viewer不被浏览重排接管。普通width observer继续遵守hold。
- App对相关card/width恢复取消统一调用既有调度API，不再只cancel RAF。所有权转交纯逻辑抽独立模块，App只接线。

Luna负责调度器/纯中断helper和直接单测，主agent负责App接线与串行真实回归，完成后由同一名独立Luna复核；模型选择沿用已授权设置。

## 测试边界

首次viewer的图片断言也曾超时，未取到匿名细节，不能靠后一次通过把它关闭。只读审计确认GIF和序列可由canvas播放，旧probe却统一要求still-image DOM。当前probe限定非序列JPEG/PNG，typedAPI只查询可见候选，避免全库加载；动画/序列的decoder验收不因此标通过。实际重排class失败是另一条已稳定定位的产品路径。

最终真实旅程需要证明两布局底部实际像素解码、查看返回位置、新用户重排完成、缩小后**没有测试强制滚动**也能自然显示正确页。无特殊旧包、packaged、macOS或前台证据；用户已要求不操作前台。

## 当前状态

实施完成，相关5文件43项单测通过。命令为 `npx vitest run tests/unit/canvas-reflow-restore.test.ts tests/unit/preview-return-interruption.test.ts tests/unit/browse-view-restore-scheduler.test.ts tests/unit/viewport-window-hook.test.tsx tests/unit/workspace-scroll-position.test.ts`。首次合并运行有一项测试夹具未安装可控RAF，修正夹具后43项通过；不把它作为产品竞态修复。定向lint本轮代码零错误，App仍有一条无关既有依赖警告；全仓typecheck仍被其他CLIP轨道4项错误阻断。

当前源码由 `node scripts/run-e2e.mjs tests/e2e/real-linked-navigation-perf.test.ts --reporter=line` 重建，开启 `SERPENT_REAL_NAV_PROBE_VIEWPORT_LIFECYCLE=1`，隐藏隔离Windows Electron。28,930项真实资产的probe全部断言完成并输出结果：平铺/瀑布流都从底部打开非序列JPEG/PNG，验证查看器实际解码，返回后仍在底部附近，可见图片分别25/25和4/4解码。随后最大档缩至最小档，重排终结、scrollTop合法，且没有测试强制滚回底部，20/20可见图片自然解码。两布局流程工具墙钟3,574/456ms，缩放段909ms；它们包含多个动作和等待，**不是单次查看器返回延迟**。本轮终端输出曾截断，保留的是probe末端断言与匿名结果，不补写未保留的runner总耗时。

同一名独立Luna完成Standards/Spec静态复核，未发现具体阻断；终结次数、替换/reentrant回调、监听清理、generation失效顺序及打开中viewer不被接管均检查。主agent核对上述当前构建probe结果；无用户验收结论。

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| hold拒绝与显式取消必有终态、旧owner不清新owner | `src/renderer/canvas-reflow-restore.ts:188` / `:349` | `tests/unit/canvas-reflow-restore.test.ts:94` / `:156` / `:178` / `:203` | 隐藏Windows Electron当前构建真实底部返回/缩放断言完成；前台未执行 |
| 显式用户重排接管关闭后的preview恢复，保留打开中viewer | `src/renderer/preview-return-interruption.ts:20` / `src/renderer/App.tsx:2609` / `:4101` | `tests/unit/preview-return-interruption.test.ts:42` / `:76`；`tests/e2e/real-viewport-lifecycle-probe.ts:32` | 两布局实际图片解码及自然底部位置验证；动画/序列、packaged/macOS未验证 |

本轮新建output/catalog目录已不存在，原始素材未修改。`CANVAS-REFLOW-034`进入待人类验收，工单保留进行中，不提交推送。测试超时不进入性能分位数，不把profile/trace或普通DOM存在当作媒体解码证明；整体性能目标继续。
