# 延迟关闭通知与重新打开界面的所有权

关联 `Serpent-2e903e`、侧栏隔离 `Serpent-6f7d47` 与总体性能 `Serpent-3kfe`。本增量修复切库正确性，不把通过轮次当作整体性能完成。

## 发现与根因

真实照片源的菜单往返旅程曾在返回时没有库身份、卡片和布局 slot。补充异常前匿名观测后，以候选侧栏/原侧栏/候选/原侧栏交替运行，第一轮候选在 `switched-to-control` 后失败，另三轮通过。该对照不能证明侧栏边界是原因，更不能用后三轮通过将失败关闭为 flaky。

App 原有 `library.closed` 处理在事件收件时检查 pending generation，但实际回调进入 transition FIFO 后和 `await closeAssetPreview` 后仅比较 libraryId。收到旧 A 的关闭事件时可能正在 B，事件回调排在重新打开 A 后；执行时新 A 的 ID 又相同，于是清掉新 A 的界面。相同风险还包括同 ID 的新 generation，以及异步预览关闭失败向新会话报告错误。

## 实现

独立 `src/renderer/library-closed-view-ownership.ts` 复用现有 `LibraryViewSession` 和 transition FIFO，App 仅提供原有状态/预览/最近库操作：

- 收件时只接受属于当前库且 view 一致的关闭通知；普通事件继续核对 pending generation，当前 MCP 关闭保留。
- 捕获当前库 ID 与 generation；回调真正执行和预览异步关闭后均重新核对同一 owner。
- 旧会话的预览失败不再写入新会话；当前正常关闭仍清界面、更新最近库并回 idle。

没有改 Main、Preload、Worker、事件协议、数据库、物理关闭、备份或恢复流程。新增控制器没有继续将交互逻辑内联进 App，没有新 UI/CSS。

边界：事件自身不携带 close operation ID 或 generation。本修复证明的是收件后排队/等待跨会话的所有权；若生命周期消息在 transport 层真正延迟到响应返回、同 ID 重开及 pending fence 清理之后，单靠收件时的快照不能识别其旧来源。Main 源码在 close 请求返回前发布通知，但未建立跨消息通道重排的确定性平台证据，不宣称所有 transport 时序均已解决。

## 受控复现与回归

测试使用实际 `createLibraryTransitionLock`、不可变 view session 和 deferred gate，而非仅测试一个布尔比较器。先提取旧算法运行六项，四项稳定 RED、两项通过：B 收到 close(A) 后返回 A、A→B→A、preview await 同 ID 换代及旧 preview 拒绝都会错误作用于新会话。改为 owner 后六项全部通过。

当前回归命令：

```text
npx vitest run tests/unit/library-closed-view-ownership.test.ts tests/unit/library-transition-lock.test.ts tests/unit/library-view-session.test.ts tests/unit/library-lifecycle-sync.test.ts tests/unit/navigation-sidebar-boundary.test.tsx tests/unit/navigation-sidebar.test.ts
```

本轮主 agent 执行 **6 文件 / 64 passed，2.03 秒**。Scoped ESLint 零错误；App 保留原有 AI callback dependencies 警告。独立 Luna 另外实际执行控制器六项且全部通过，不将其等同于独立执行全部 64 项或真实 Electron。

## 真实 Windows Electron 交替回归

只读链接授权照片源 **15,465 项**，所有 catalog/profile/备份年龄控制/测试输出都在当轮所有的隔离目录。每轮正常完整退出、同 profile 冷启动、菜单切空库再返回；只对隔离库既有备份做 48 小时年龄控制。没有操作前台，原文件未写入。

以下四轮**两种侧栏入口均包含新 close 控制器**；control 仅换回原侧栏入口，不是旧 close 算法的性能 A/B。

| 次序 / 侧栏 | 完整旅程 | 返回九成解码 RAF / ms | 返回解码 | staging 完整退出 / ms |
| --- | --- | --- | --- | --- |
| 1 / 候选 | 1 passed / 16.4 秒 | 507.9 | 25/25 | 142 |
| 2 / 原入口 | 1 passed / 17.3 秒 | 514.6 | 25/25 | 2130 |
| 3 / 候选 | 1 passed / 16.0 秒 | 498.2 | 25/25 | 120 |
| 4 / 原入口 | 1 passed / 17.6 秒 | 524.8 | 25/25 | 2120 |

四轮均最后打开库数 1，观察到应用进程退出，内外测试 owner 清理成功。首屏是动作前预置的 DOM/decode-on-RAF 观测，不是 compositor 像素呈现。两轮约 2.1 秒退出慢点未解释，不因另两轮快而关闭。当前普通基准仍是软件 offscreen 渲染，不能等同前台 GPU 帧率。

交替 runner 在结束时恢复候选源码，但最后编译产物属于原侧栏入口。随后已重新构建候选，主 Renderer SHA-256 为 `7ea5b4bc9780aa7628b89b0c1002465d46ee6c285daaf3d1d327c045249b2ec6`，Worker 为 `f1d3c083aa5b80e420d78db855960d975033e0fde758fb6bf80a19d63c76081e`。不拿先前控制构建证明最终源码。

最终候选使用真实 A/B 两源普通旅程，分别 **1 passed / 37.0 秒、1 passed / 30.3 秒**。创建可见88/74ms，四跳九成A803/587/611/930ms、B900/717/697/906ms；四秒原生 CDP wheel 实际位移均1600px，帧P95/max分别24.1/54.3、31.8/38.0ms，0 long task、末页均25/25实际解码。B确实加载1045个导航目录行。两者运行时均再次核实为软件offscreen，不从最后两个快点推导稳定帧率提升。五秒AI等待期间仍可创建和读取状态；B history一次363.8ms，不隐去这一慢点。两源当轮内外输出清理均确认成功。

含新测试的首次完整类型检查另发现两处 deferred `Promise<void>` 不匹配 mock 初始推断的 `Promise<undefined>`，已为 mock 返回类型显式标注 `Promise<void>`。不能把此前只含旧文件的类型结果套用到该失败。修正后直接相关八文件再次 **67 passed / 2.58秒**（原六文件加Disclosure与paint probe），控制器/测试ESLint零错误；完整类型复测结果单列。独立Luna对当前修正行复核并重新运行六项通过，双轴无已确认阻断；其非阻断的当前owner预览拒绝/外围reject/recents契约边界保留，不冒称全部异常路径完成，见[独立审查](../reviews/2026-11-17-library-closed-view-ownership-review.md)。

最终 `npm run typecheck` 结束 exit 1，只剩其他开发轨道四项既有 CLIP Database 错误；新增关闭测试的两项类型错误已消失。未将整体类型门禁写成通过。本轮仅本层单测和对应真实 Electron，无无关后端或全量门禁。

## 四列追溯与待办边界

| 需求 | 实现位置 | 自动化 | 人工/平台证据 |
| --- | --- | --- | --- |
| 已收件的旧关闭不能清掉重新打开的同库 | `src/renderer/library-closed-view-ownership.ts:20`、`:27`、`:36`，`App.tsx:5195` | `tests/unit/library-closed-view-ownership.test.ts:86`、`:108`、`:131`，旧算法四项 RED，新算法六项 GREEN，最终相关67项通过 | 真实照片源四轮返回均实际解码；非穷尽时序证明 |
| 当前普通/MCP 关闭仍生效 | `library-closed-view-ownership.ts:20` pending 检查与当前 owner | `library-closed-view-ownership.test.ts:154`、`:169` | 真实菜单与完整退出通过；MCP 独立进程旅程未执行 |
| 旧预览错误不进入新会话 | `library-closed-view-ownership.ts:40` await 后 owner 检查 | `library-closed-view-ownership.test.ts:186` deferred reject 稳定 RED→GREEN | 真实预览失败交错未单独注入 |

当前只改 Renderer 与对应测试，按最小化原则不运行 Worker、资源库可用性、20k 或发布门禁。前台按用户要求未执行；原实例同负载、packaged/macOS、transport 重排以及整体性能未验证。工单不关闭，未提交推送。

本轮结束前 `git diff --check` exit0；新控制器、测试、开发/审查及侧栏开发记录共5文件的定向身份/绝对路径/凭据扫描0命中，不当作全仓提交级扫描。工作区Electron进程0，本轮测试家族新目录0；此前两个已被拒绝清理的旧目录保持不动、不重试。本轮`LIBRARY-CLOSE-VIEW-044`新增待人类验收，`NAV-BOUNDARY-043`在失败撤回、修复和当前候选真实回归后恢复待人类验收，均未标用户通过。
