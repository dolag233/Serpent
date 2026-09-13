# 2026-09-13 交互性能：设计、工单与 agent 执行安排

## 当前状态

- 用户要求先深入设计、沉淀文档并拆单；全部开发指定 **Luna Extra High**。高成本主 agent 只安排 agent，不实现、不审代码。
- 设计基线 dev `b2ece599`，0.2.1；性能分支 `codex/performance-20260913`。
- [顶层设计](../implementation/2026-09-13-interactive-performance-design.md) / [ADR-0033](../adr/0033-isolated-catalog-reads.md)。代码事实、历史性能与本轮待测证据分开记录。
- 设计阶段未运行性能、功能、Electron 或真实NAS测试；未宣称修复完成，未新增待人类验收功能。
- 三个 **Luna High** 资料整理 agent 均在执行前返回用量限额错误，没有交付。设计主 agent 完成资料核对，不代替后续开发。
- 设计检查：`git diff --check` 通过；本轮文档相对链接/隐私模式检查通过；JSONL解析与依赖图检查为1个总单+10个实施单、无环；`node scripts/ticket.mjs ready --fields id,title,status --json` 确认本计划初始仅 PERF2-01 就绪。以上是文档/工单检查，不是软件测试。

## 工单索引

<!-- PERF2_TICKETS_START -->
总工单：`Serpent-e9a66b`「交互性能第二阶段：文件夹切换、NAS缓存、资源加载与刷新反馈」。

| 编号 / 工单 | 交付边界 | 技术前置 | 模型 / 状态 |
| --- | --- | --- | --- |
| PERF2-01 / `Serpent-41426d` | 端到端性能基线与读版本/提交回执协议 | 无 | Luna Extra High；执行中，已确认环境与设计 |
| PERF2-02 / `Serpent-6dc70b` | 提取共享纯读目录服务，分离隐藏物化写入 | PERF2-01 | Luna Extra High；未开始 |
| PERF2-03 / `Serpent-0ecab5` | 只读UtilityProcess直达路由与真正的导航抢占 | PERF2-02 | Luna Extra High；未开始 |
| PERF2-04 / `Serpent-078a15` | 首屏优先的两阶段BrowseSession与稳定顺序 | PERF2-03 | Luna Extra High；未开始 |
| PERF2-05 / `Serpent-f60a3f` | NAS快照持久命中、版本发布与写后可见 | PERF2-03、PERF2-04 | Luna Extra High；未开始 |
| PERF2-06 / `Serpent-f6df4d` | 文件夹操作及时反馈与提交后局部投影 | PERF2-01 | Luna Extra High；未开始 |
| PERF2-07 / `Serpent-777a14` | 按影响范围刷新与全库对账最终收敛 | PERF2-05、PERF2-06 | Luna Extra High；未开始 |
| PERF2-08 / `Serpent-aea5b9` | 媒体描述符授权与本地预览缓存直达 | PERF2-05 | Luna Extra High；未开始 |
| PERF2-09 / `Serpent-312c29` | 元数据队列有界入队与维护写事务预算 | PERF2-05、PERF2-07 | Luna Extra High；未开始 |
| PERF2-10 / `Serpent-6db419` | 最终独立双轴审查与本地/SMB性能验收 | PERF2-04、PERF2-05、PERF2-06、PERF2-07、PERF2-08、PERF2-09 | Luna Extra High；未开始 |
<!-- PERF2_TICKETS_END -->

## 模型、所有权与串行规则

代码、测试脚本、集成、审查和QA agent 全部使用 `gpt-5.6-luna` / `xhigh`；只有资料整理可用 `high`。本轮已获用户授权，不再逐次询问；额度不足不擅自换模型或兑换额度。

只有协调者通过 `node scripts/ticket.mjs` 写 JSONL，实现 agent 返回需记录的交付评论；禁止旧 bd/Dolt。各 agent 有独立开发日志，QA清单与project-status由集成者统一更新。

PERF2-01先交付协议和基准；随后02与06可并行。shared protocol、LibraryService、App、Main/Worker入口和迁移尾部必须分配文件时段，不允许多人同时修改。两条代码轨道使用独立worktree，Luna集成者串行合流；其它用户任务不得覆盖。

Native重编译、依赖安装、E2E与最终合流检查由Luna集成者集中串行安排，测试后台且使用隔离userData，结束清理本次产物。

依赖表示技术前置未交付。前置代码和测试证据已经交付、但工单仍待用户验收时，协调者可向下游评论提交号/证据并解除该实现依赖；不可为得到ready结果伪造关闭。历史用户问题保持原验收要求。

## 每个开发任务的交付合同

1. 读AGENTS、设计、对应工单及既有实现/测试；先建立可运行基线，不把静态推断写成实测。
2. 只修改分配范围；新增逻辑抽模块，复用主题、协议、缓存、恢复和job机制。
3. 代码和受影响测试同交付；资源库相关完整跑availability，跨进程/媒体跑真实Electron。
4. 返回提交号、实际命令/结果、四列证据、遗留问题及供下游使用的接口。未跑只写未验证。
5. 不自签accepted，不关闭人类UI问题。可操作增量、相关自动化绿且无已知阻断后才提议加入人类验收。
6. 设计不可行时提交证据与替代建议，由协调者安排决策，禁止弱化目标或删除测试交差。

## 集成与最终验收

PERF2-10由未实现主要功能的**一个Luna Extra High agent**进行独立Standards+Spec审查与集中QA；主设计agent不审代码。有缺陷交回对应Luna实现者，由同一审查者复核。

Luna集成者运行最终 `verify:mainline` 和串行E2E。真实SMB/Windows无环境就记未执行；前台Computer Use先取得用户同意，不抢窗口。packaged必须当前提交新构建且只在dev，按发布规范恢复native；本轮未授权发布。不得用旧包证明新HEAD。

## 额度恢复后的调度

查询 `performance-v2` 标签与依赖，读此索引和交付评论，核对分支状态。从第一个未交付的技术前置安排单个有界Luna xhigh任务。派发须包含工单、设计章节、可写范围、共享文件时段、测试边界和交付合同。

额度不足时保存失败事实与待派任务，不循环重试、不改变模型、不让主设计模型代写。恢复后继续现有工单，不重做设计或重复开单。

## 首轮派发记录

设计提交 `8fd09dbc` 已推送性能分支。PERF2-01 已由 Luna Extra High 确认读取工作树/工单/设计并开始执行，未遇额度错误；其余任务等待技术前置。此前Luna High资料任务的额度错误不代表Luna Extra High开发不可用。
