# 媒体任务全库暂停边界

- 工单：`Serpent-1deebf`；基线 `dolag_dev` / `ebb7f9be`。
- 依据：真实链接库 pilot 暂停 515 项后又出现 562 queued / 2 running，见[测量记录](../development/2026-11-16-real-thumbnail-memory-investigation.md)。
- 本轮选择以下实现；不修改媒体质量、线程数或缓存容量，不把暂停当作常规导航优化算法。

## 用户结果

1. 「全部暂停」持久暂停该库的自动媒体队列。现有 queued/running 工作进入 paused，后续发现、补队、自动修复/重试与领取不再偷偷恢复。
2. 全部恢复清除该模式并恢复 paused 任务。即使当时没有任务，界面仍可设置、识别和解除暂停。
3. 指定 ID 暂停只影响这些任务；指定恢复和指定失败重试只放行精确任务，不解除全库模式，也不顺带启动全库发现。
4. 自动可见窗口属于后台需求，尊重暂停。用户明确请求的查看仍可读取原文件/已有产物；明确重试、播放失败后的代理与手动模型缩略图生成可以获得精确许可。
5. 取消只取消现有行，沿用现有行为，不暗中改变全库模式。公开请求 omit IDs = 全部、非空 IDs = 指定；空数组保持无效，不扩张为全部。
6. 切换到另一库不共享暂停；关闭重开和完整退出重启保留状态。

## 根因与完整边界

现有 pause 只 UPDATE 当前 jobs 并 abort 活动 job，没有任务生产/领取策略。primary/secondary pump、timer、启动补队、reconciliation、RAW/普通图 metadata、palette 和自动 repair 都可能产生后续工作。只拦某一个 timer 或只放 session Set 无法保证持久性、指定恢复和旧异步闭包的安全。

新增 v61 迁移（开始前远端与当前 MIGRATIONS 尾部均为 v60）：`library.media_queue_paused` 默认 0；`jobs.media_admission_origin` 默认 `automatic`，明确用户动作设 `explicit`。既有行自然归入 automatic，不改历史迁移。

数据库层拒绝暂停库 automatic 媒体行进入 queued/running；任务 terminal 后撤销 explicit 许可，防止后续自动重试借用旧许可。只约束七类既有 media jobs，不影响 AI、插件任务或库结构恢复。模式位与 pause/resume 行转换同事务发布。没有模式变化时不增加逐任务磁盘写入。

Service 与调度层同时约束自动入队、修复和维护读取，避免仅靠 SQL 拒绝后仍扫描全库。claim 动态检查当前模式，只允许当下的 explicit 行；暂停先撤销既有许可并 abort，异步生成结束仍需检查行状态，不能覆盖 paused。

明确动作可恢复/创建精确任务并重新唤醒主、次队列；在模式仍暂停时禁止 discovery/repair 尾部。正常全部恢复后重新唤醒两条泵，不依赖新的 browse 报告。库结构对账仍保留，媒体回填受暂停控制。

## 投影与复用

- 复用现有媒体任务按钮、状态摘要、列表与主题样式，不新增自造控件或解释内部约束的文案。
- response/API 新增 `queuePaused`，与 numeric counts 分开；兼容缺省 false，当前 Worker 总返回真实值。Preload 和 Renderer summary/list merge 都保留它。
- 全部暂停按钮以模式控制 disabled；恢复按钮在模式为真或 paused 行存在时可用。不要把 boolean 加入 numeric count 求和/缓存。

## 验证与完成定义

- 确定性 Worker 覆盖零行模式、拒绝自动生产/领取、精确恢复/重试、空 ID、跨库、旧运行完成、terminal 许可撤销和重开持久。
- 同步协议/Preload/Renderer merge/按钮单测，handler 验证全部/精确恢复正确唤醒两条泵。
- 迁移纪律、旧 v60 数据迁移后可用、完整资源库可用性；本轮性能产品变化再跑标准 20k mixed。
- 隐藏隔离 Electron 使用真实素材，证明暂停响应后的持久状态/任务对账和恢复后实际图片解码；加入完整进程退出重启。先前 300ms 沉降探针只能作复现，不能作为这轮暂停合同证明。
- 单一独立 Luna 同时审 Standards 与 Spec；前台按用户要求不执行，人工/packaged/macOS 证据另列。

本文件是本轮实施规格；验收四列与当次命令结果写入开发记录。未取得对应证据不得关闭工单或签署 accepted。
