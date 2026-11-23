# 真实大库生命周期测量

关联整体性能 `Serpent-3kfe`。本轮先补实测，尚未修改产品生命周期逻辑，也不是性能目标完成或人类验收结论。

## 测量边界

只读使用两组经授权真实素材，A 28,930 项、B 15,465 项；写入仅在自有隔离 linked catalog/userData。新建空 Control 只作为切库控制组，不冒充另一组大库。隐藏 Windows Electron，无前台操作；不打开用户原 catalog 数据库、不写原素材。测试创建 Alpha、链接真实源、检查实际图片解码、通过真实菜单创建 Control，完全退出，再以同 profile 冷启动 Alpha，执行 Alpha→Control→Alpha 并再次退出。

`tests/e2e/real-library-lifecycle-perf.test.ts` 复用既有 `launchBenchmarkApp`、实际菜单与 loading helper、图片自然尺寸验证、匿名阶段日志。库身份和资产ID只在进程内核对，不写入结果。每库只读一次任务汇总，末尾只读一次已打开数量，避免状态轮询改变调度。重返 Alpha 前已断言 Control 卡片数为零，重返后比对原资产身份，不能以旧卡片冒充首屏。

每阶段最多60秒，整条240秒；退出必须确认应用进程终结后才能递归清理自有路径，并拒绝reparse点与越界。临时备份过期控制仅在应用退出后改自有普通、单链接备份文件mtime至48小时前；默认不做此修改。

当前产品构建与上一增量一致：Renderer连续内容SHA-256 `f8803433c348fc394506b7ba0f1377ce0b217cb522849ae7c4c353c829448aa3`；Worker `f1d3c083aa5b80e420d78db855960d975033e0fde758fb6bf80a19d63c76081e`。本轮harness不要求重建产品；此前缺图诊断已对当前源码重新构建。

## 首轮有效结果

命令：通过环境变量提供授权源，隔离输出和TEMP，串行运行 `node node_modules/@playwright/test/cli.js test tests/e2e/real-library-lifecycle-perf.test.ts --reporter=line`。A **1passed /22.0秒**，B **1passed /17.5秒**。两条旅程新建目录、输出由退出后的测试owner清理。

| 指标（毫秒） | A | B |
| --- | ---: | ---: |
| 链接导入响应 | 10159 | 6163 |
| 链接后首张/九成实际解码 | 187 /612 | 218 /838 |
| 从已开大库通过菜单创建空库，到身份/完成 | 809 /831 | 1587 /1608 |
| staging 完整退出墙钟 | 2136 | 148 |
| 新Electron启动到大库身份/九成实际解码 | 2883 /3184 | 2803 /3263 |
| 大库→空库身份/确认空卡片 | 249 /266 | 685 /706 |
| 空库→大库身份/九成实际解码/完成 | 425 /681 /717 | 323 /645 /648 |
| 最终完整退出墙钟 | 169 | 172 |

冷启动数字包含Electron启动与Renderer装载，不能解释为单个 `library.open` 耗时。菜单数字也包含自动化click、填表/菜单过程，不冒称纯Worker耗时。首轮仍有超过500ms的首屏，以及A一次约2秒退出，不能据其他快点关闭整体问题。

解码数字是helper首次采样命中的墙钟上界，并非从点击前持续逐帧观测得到的实际首帧时刻：当前helper是在菜单/标题/loading检查、显式所有资产click和首卡visible检查后开始采样。它证明在采样时图片确已解码，不能证明采样前一直空白，也不能把这段墙钟全部归因解码。后续需要提前布置按目标库资产身份隔离的逐帧观测，才能区分真实挂载等待与自动化actionability等待；本轮不把该缺口当产品根因。

两组最终已打开库数量均为1；A冷开22/24图片实际解码、重返24/24，B冷开与重返均25/25。原90%测试阈值保留，不把A的22/24写成全部完成。初始任务汇总A排队96/运行17、B排队96/运行31，证明旅程中存在真实后台工作，不代表所有任务都正在消耗CPU或同一解码器。

被动日志中两组恢复文件操作阶段max不超过1ms、adopt-services max7ms；没有复现静态审计提出的旧饱和度回填或历史journal积压，不能据源码结构直接优化它们。A首次退出会话只观察到1条close total，最终退出会话3条；两组Main未记录专门的shutdown ACK/timeout事件，因此ACK和是否达到2秒强杀均明确为 `unobserved`。应用已退出不等同于证明graceful shutdown，A的2136ms也不能单凭接近2秒就判定强杀。

## 测试夹具修正

首次A运行在重启后标题locator缺失，未形成有效冷启动数据。原harness在应用尚运行时写recent active Alpha，运行中的Main仍可能在关闭/切库收尾时覆盖配置。已将seed移到应用完全退出并确认子进程结束后，重启依靠隔离recent配置而非仅控制原生打开对话框的路径env。该轮失败不归因产品性能，失败新产物已清理。修正后A/B完整旅程才计入上表，不以失败后重跑通过关闭任何产品竞态。

## 过期备份分支与操作窗口

在同一命令增加 `SERPENT_REAL_LIFECYCLE_STALE_BACKUP=1`，并保留真实素材与完整重启：A **1passed /21.1秒**，B **1passed /18.7秒**。两组各有1个已存在、自有、非硬链接的备份被设为48小时前，分支实际触发；本次全部新产物退出后清理。

| 指标（毫秒，仍含自动化成本） | A | B |
| --- | ---: | ---: |
| 创建空Control到身份/完成 | 1153 /1166 | 1338 /1362 |
| 大库→空库身份/确认空卡片 | 270 /304 | 1176 /1210 |
| 空库→大库身份/首次采样九成解码 | 947 /1011 | 371 /2269 |
| 最终退出 | 185 | 183 |
| 冷重启会话close backup阶段max | 302 | 183 |

最后一次返回的全部图片A24/24、B25/25，最终已打开数量均1。B的371ms身份到2269ms采样间隔需要预先观测才能归因，不能把近1.9秒直接称作解码耗时或持续空白；与首轮645ms相比也不能宣称改善或稳定回归。A首次退出2136ms在本次为134ms，但缺ACK证据，保持未解释，不以重跑正常关闭。

新增仅在测试中解析现有日志的三个动作窗口，以Date.now截取 `worker.cmd` / `worker.cmd.roundtrip`，requestId只在内存关联，输出静态命令白名单的最多5项。缺字段为null、无匹配为unobserved，不以默认0伪造测量。A/B创建Control的 `library.create` roundtrip分别180/143ms（run177/142ms），不能解释整个1166/1362ms墙钟；队列与调度等待接近0也只针对这些已观测命令，不能据此断言UI空档的原因。

A返回Alpha窗口：open roundtrip404ms（queue152、run250、scheduler约0.08ms），close max317ms，导航汇总149ms。B返回窗口：open160ms，close194ms、导航96ms。close backup确实有可量化成本，但没有证明是B采样长间隔的唯一原因；安全恢复、lease、close栅栏均未绕过。两个会话的恢复文件操作阶段max1ms、adopt max7ms，与首轮一致，仍不足以支持旧journal/饱和度候选的产品改动。

最终两个harness定向ESLint通过。缺图诊断直接helper的4项单测通过；无额外产品变更，未运行无关后端或全量门禁。单一测试实现agent与主agent静态核对只构成测试审阅，不冒充产品最终验收。

收尾进程核查无本工作副本匹配的Electron/媒体进程，无本轮生命周期/输出/缺图新目录；两个历史拒绝清理目录保持不动，没有重试或绕路删除。6块当前诊断代码/文档/状态/工单评论定向隐私检查中，仅既有官方HTTPS链接被简易盘符正则误报；逐行核对是链接scheme，不是本机路径，无新增本机或凭据残留。本项不是提交级全仓扫描。状态/工单diff空白检查通过，仅有既有换行风格提示。未提交推送。

## 审计候选与未验证范围

- `backfillDominantSaturation` 同步读取缺失饱和度的旧色卡；服务内独立阶段计时未覆盖它，但外层adopt阶段包括注册工作。缺少积压真实数据，尚未证明它耗时显著。
- `recoverFileOperations` 全量读并按created_at排序；可撤销的move/copy journal需要保留。没有历史操作规模证据，不能跳过恢复或删除journal换取速度。
- close串行等待reconciliation、媒体abort结算、必要备份、checkpoint和连接释放。备份间隔24小时；媒体drain是资源所有权安全边界，不能任意绕过admission或放任旧任务写已关闭数据库。
- Sharp-only idle helper不包含OIIO/FFmpeg/keyed memory阻塞，是其他格式下的静态候选；本轮两张PNG/JPG已证明快速领取，不能拿该候选解释这次尾图。

本轮只增加诊断测试、开发记录，未改Main/Worker/protocol/library-service；只运行直接E2E与helper门禁，不重跑库可用性、20k Worker、全量测试或发布门禁。前台、packaged/macOS、原库同负载及旧journal/色卡积压仍未验证。人类验收队列未新增产品功能，不把诊断通过标成人类验收。

## 四列追溯

后续已补菜单动作前arm的事件驱动RAF观测，结果与本文件旧post-action上界分开；当前两源的九成实际DOM/decode观测809/517ms，而B同动作到1109ms才结束自动化。详见[侧栏边界增量记录](2026-11-17-sidebar-committed-boundary.md)。这不反推此前2269ms那次实际首帧；ACK和A约2秒退出仍未解释。后续产品构建已变化，不能将其数据混算成本文旧构建同条件A/B。

| 需求 | 实现位置 | 自动化证据 | 平台/人工证据 |
| --- | --- | --- | --- |
| 真实大库完整退出、重开、菜单切换且源只读 | `tests/e2e/real-library-lifecycle-perf.test.ts` | A/B默认及48h备份两组共4次完整passed；源独立、空库零卡、资产身份和自然尺寸检查 | 隐藏Windows Electron当前构建；原实例、packaged/macOS与前台未验证 |
| 区分操作墙钟与Worker已有阶段 | 同文件 `summarizeLifecycleLog` / `summarizeWorkerCommandWindow` | 分支实际触发、阶段被动观察；无字段null/未匹配unobserved | ACK/强杀未观察；预先逐帧解码时间仍待补，不宣称根因已闭环 |
