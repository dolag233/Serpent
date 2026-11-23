# 媒体全库暂停修复开发记录

- 工单 `Serpent-1deebf`，进行中；基线 `ebb7f9be`。
- [规格](../implementation/2026-11-16-media-queue-pause-boundary.md)。已完成编码、直接相关自动化、真实 Electron 合同验证与独立复核；未提交/未签署用户验收。验收增量 `MEDIA-PAUSE-030`。
- v61 由本轮占用，保留既有迁移原文。真实素材只读、测试库/userData 隔离、测试串行后台运行。

## 实现与根因

root 负责持久策略、Service 与调度入口；Luna 分别负责直接 Worker 合同测试、typed/UI 投影和相关单测。测试由 root 统一运行；完成后仅一个独立 Luna 双轴审查。

旧控制命令只更改已有行，所以旧闭包和全库 discovery 可以继续。新的边界同时落在 durable policy、admission、claim、晚到生成与 resume 唤醒；明确动作只取得精确许可，不改变全库模式。

- v61 新增库级暂停位与任务准入来源，触发器拒绝暂停库的自动入队/领取，terminal 时撤销显式许可。Service 使用 write connection 读取模式，避免网络元数据快照提供旧状态；事务失败时模式、行和缓存一同保留旧值。
- 自动可见波、普通补队、RAW 元数据、色卡和修复入口尊重模式；可见文件头探测、原图与既有产物读取保留。指定恢复/重试只消费显式行，不运行全库发现尾部。
- 全部恢复唤醒主、次队列。明确唤醒与自动续泵各有交接路径；关闭、重开和资源冷却恢复时重新查询持久许可。
- 协议、Preload、Renderer 与自动化列表保留 `queuePaused`，数值计数仍只含六个状态。复用既有任务面板按钮，不增加界面文案或样式。

## 本轮发现与修正

1. 完整资源库门禁首轮 9 个失败，涉及重放迁移时重复添加列、旧插件 fork fixture 的 jobs 列数错位。保留 frozen migration SQL/checksum；新增幂等 additive tail helper，兼容现存列，历史 fixture 真正构造旧 schema。失败的三文件定向复测 110 passed / 1 skipped；后续完整门禁 9 文件 240 passed / 1 skipped。没有修改既有迁移原文或删除测试。
2. 独立 Luna 找到旧 explicit 主泵收尾吞掉全库恢复的竞态。可控测试先 hold 自动 owner，验证指定恢复接管，再 hold 显式 owner，执行全部暂停/恢复：修复前第二个资产没有 ready，10 秒断言失败；修复后通过。显式请求不再混用自动 reschedule 标志，连续显式交接保留自动唤醒，最终以新普通 owner 恢复。
3. `enqueueArtifactRetry` 原先可能复用旧 revision 的 paused job，给旧版本授权后直接返回，当前版本没有任务。active 查询与显式 promotion 限定当前 revision；测试构造旧 paused 与新 current revision，证明只新任务生成成功、旧任务保持 paused/automatic。
4. 一次新 scheduler 测试因开发中的 SQL 列名错误超时，不能计为竞态复现。修正列名后的独立运行才稳定触发第 2 项断言；两者证据不混用。首次超时留下一个隔离 fixture，清理请求被自动审批以 `blocked by policy` 拒绝，未重试或改道清理。成功运行的其余 fixture 按测试生命周期回收。

## 已执行的自动化

- 最终 `npm run test:library-availability`：native ABI/FTS5 probe OK，**9 文件 240 passed / 1 skipped**，107.68 秒；本次所有产品代码修订之后执行。没有使用首轮失败或中途定向结果代替最终门禁。
- `node scripts/run-vitest-with-electron.mjs run tests/worker/media-queue-pause.test.ts tests/worker/media-pause-scheduler.test.ts tests/worker/thumbnail-scheduler.test.ts tests/worker/media-ignore-scheduling.test.ts tests/worker/media-job-summary-cache.test.ts --disableConsoleIntercept`：5 文件 **23 passed**，包括现有调度故障注入与 handoff 回归。
- `npx vitest run tests/unit/automation-command-gateway.test.ts tests/unit/media-job-handler.test.ts tests/unit/media-generation-handler.test.ts tests/unit/protocol.test.ts tests/unit/preload-library.test.ts tests/unit/media-jobs-dialog.test.ts tests/unit/media-job-list.test.ts`：7 文件 **218 passed**。
- `npx vitest run tests/unit/serpent-mcp-adapter.test.ts -t 'queries media job state from a fresh call'`：本次修改涉及的 fixture **1 passed / 22 skipped**。完整 MCP 文件另有既有搜索字符串断言仍预期旧 clauses，而当前搜索产生 expression；完整文件不是绿，未改动无关搜索行为或断言。
- 标准 mixed fixture：`node scripts/generate-large-library.mjs --output <本次新建隔离目录> --assets 20000 --seed 20261116 --asset-profile mixed`，生成器 **1 passed**，约 66.90 秒；随后 `node scripts/run-large-library-performance.mjs <同一隔离目录>`，基线 **3 passed**，约 13.67 秒。新建 fixture 由同一父流程确认子进程退出后清理。

20k 同进程基线：打开 8.1 ms，所有资产 13.1 ms，文件夹 0.5 ms，合集 6.0 ms，固定 token 搜索 16.6 ms，layout 112.0 ms，导航摘要冷/热 60.8/0.3 ms，Inspector 0.4 ms。对账并发 viewer：p95 3.7 ms，事件循环 lag p95/max 1.5/98.5 ms。这些是固定混合 fixture 的 Worker 服务数据，**不是用户真实前台端到端导航耗时，也不是暂停修复带来的加速对照**。删除刷新未由此基线执行，不据此声明删除性能通过。

## 真实只读素材与完整进程重启

当前产品代码通过 `node scripts/run-e2e.mjs tests/e2e/real-media-queue-pause.test.ts --reporter=line` 构建后，前两次测试发现了测试本身的生命周期错误：空壳已有 canvas，不等于异步建库完成；Playwright app 关闭后再调用 `application.process()` 会访问失效对象并遮蔽原错误。已明确等待本轮库落盘，在 launch 时保存 ChildProcess，关闭后只使用该引用。新库与素材始终分离；两次均未进入素材导入，不作为产品失败或吞掉异常后的通过。

修正测试后，保持同一份当前产品构建，运行 `node node_modules/playwright/cli.js test tests/e2e/real-media-queue-pause.test.ts --reporter=line`（只读素材、输出目录通过环境变量传入）：**1 passed，50.2 秒**。没有在这之后修改产品代码。

| 实际阶段 | 观测 |
| --- | --- |
| 隔离链接导入 | 28,930 个真实资产；只写隔离库与 profile，不复制或修改源素材 |
| 暂停前 | 收到 106 个唯一 batch ready artifact，39 批，单批最大 7；20 个完成图片候选经过摘要核验 |
| 全部暂停 | 暂停 518 项，命令往返 21 ms；8 秒观察 queued/running 为 0，成功数与新 ready 数不增长 |
| 完整重启 | 原 Electron 主进程正常退出，重新拉起同一隔离 profile 与库；再观察 8 秒仍暂停且没有新自动完成 |
| 精确重试 | 仅目标图片允许活动；新 artifact 经 `serpent://preview` 的 `Image.decode()` 验证 `complete` 与非零尺寸；库仍暂停 |
| 全部恢复 | 恢复 518 项；观察到目标以外资产的新 batch ready，证明普通泵重新接续 |
| 收尾 | 再次暂停后 queued/running 为 0，paused 502；全过程 batch ready 共 109；正常退出、隔离库与输出清理成功 |

可见图片实际解码数量在初始/暂停/重启分别为 10/14/19；这是保留和重开后可解码的证据，首屏图片集合可能随尺寸补齐改变，**不据此声称全页 100% 解码或比较导航速度**。21 ms 也是本次单样本暂停回执，不是文件夹切换耗时。

初次 E2E 的清理异常导致旧隔离目录保留，确认该应用已退出后已安全清理；第二次与最终运行均由本身生命周期成功清理。唯一尚保留的本轮产物是前述被自动审批拒绝清理的 scheduler fixture；未重试该目标。没有操作前轮被拒绝清理的其他目录。

## 检查限制

- 本次 23 个改动文件定向 ESLint 无错误、无警告（超大 Service 文件只有 Babel 编译提示）。
- 最终 `npm run typecheck` 仍因其他 CLIP 轨道的 4 项既有错误失败：Worker 的 Database namespace/unknown 与对应单测。该输出没有本次暂停文件诊断；第二段 extension tsc 因 `&&` 未执行。不称全仓类型检查通过。
- 单一独立 Luna 的 Standards/Spec 审查发现的两项实质问题均已修正；前台按用户要求未执行，packaged/macOS 与用户原库升级后同负载未执行。详见[审查记录](../reviews/2026-11-16-media-queue-pause-review.md)。
- 最终 `git diff --check` 通过；本轮 31 个文件的新文件内容/新增行做路径与凭据增量扫描，0 命中。这不是全仓历史脱敏门禁。最终进程核查无 Electron/Serpent；本轮 workspace 的 mixed、pause Electron 与输出目录均为 0。前述 OS 临时 scheduler fixture 的清理被拒绝，仍保留。

## 四列追溯

| 需求 | 实现 | 自动化 | 人工/平台证据 |
| --- | --- | --- | --- |
| 持久全库暂停与自动准入边界 | `src/worker/media-queue-control.ts:5`；`src/worker/library-service.ts:23778` | `tests/worker/media-queue-pause.test.ts:121`、`:349`、`:374`、`:392`；定向绿 | 隐藏真实 Windows Electron 1 passed；前台未执行 |
| 指定操作、当前版本精确重试 | `src/worker/library-service.ts:31352`、`:34162`；`src/worker/index.ts:766` | `tests/worker/media-queue-pause.test.ts:228`、`:298`、`:314`；`tests/worker/media-pause-scheduler.test.ts:21` | packaged/macOS 未执行 |
| 模式经过协议与 UI 摘要保留 | `src/shared/protocol/responses.ts:665`；`src/preload/bridge/library.ts:2630`；`src/renderer/MediaJobsDialog.tsx:122` | `tests/unit/protocol.test.ts:1618`；`tests/unit/media-jobs-dialog.test.ts:157`；投影/merge 单测绿 | 前台按用户要求不执行；未签用户验收 |
| 跨库/重开/完整重启 | `src/worker/media-queue-control.ts:78`；`src/worker/index.ts:3445` | Worker 隔离/重开绿；`tests/e2e/real-media-queue-pause.test.ts:466` 1 passed | Windows 完整正常退出重启通过；前台/packaged/macOS 未执行 |
| 迁移、库可用性与 20k 基线 | `src/worker/library-service.ts:3864`、`:6851` | migration discipline 绿；最终完整 availability 240 passed / 1 skipped；20k 3 passed | 独立进程/packaged/macOS 性能未验证 |
