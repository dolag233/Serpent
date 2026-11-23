# 媒体全库暂停修复双轴审查

- 工单：`Serpent-1deebf`；[实施规格](../implementation/2026-11-16-media-queue-pause-boundary.md)；[开发与测试记录](../development/2026-11-16-media-queue-pause-boundary.md)。
- 单一独立 Luna，Standards 与 Spec 同时审查；只读审查，不运行测试。测试统一由主 agent 执行，结果不冒充 reviewer 自测。

## Standards

静态核对持久暂停模式、SQL 准入边界、事务与缓存、显式许可、主/次调度交接、关闭重开、typed 投影与按钮复用。v61 为新 additive migration，没有修改既有迁移原文。模式使用 write connection；旧库/fork 重放经幂等 tail 收敛。没有新增样式或把内部规则写进用户文案。

发现两项实质问题并由 root 修复：

1. 全局恢复发生在旧 explicit 主泵 abort 尚未结束时，automatic reschedule 被 explicit tail 消费后提前返回，恢复行可滞留。确定性 Worker 测试修复前在第二资产 ready 断言失败；修复后自动唤醒穿过显式 owner 交接，使用新普通闭包续领。
2. artifact retry active 查询未限制当前 revision，可能把旧 paused job 授权并返回，当前版本没有任务。现在查询绑定当前 revision；新增测试证明旧任务保持 paused/automatic，新当前任务成功。

同一 reviewer 增量复核未发现其他未修复 P1。原有旁置开发不属于本次审核结论。

## Spec

静态实现覆盖全库与指定操作的区别、自动生产/领取与晚到结果、持久重开、精确显式任务和全局恢复唤醒。queued/running 数量与库暂停模式分离，空队列也可暂停/恢复；空 ID 数组无效。终态撤销临时许可，不使后续自动修复继承授权。

主 agent 的直接相关 Worker 5 文件 23 passed，投影/界面/handler 7 文件 218 passed；标准 20k mixed 3 passed。最终完整资源库门禁与类型检查以开发记录为准，不靠静态结论代替。

## 隐藏 Electron 测试增量复核

最初测试过早把已存在的 canvas 当成创建完成，随后在 app 关闭后读取失效的 Playwright process 对象，遮蔽原异常。现已等待本轮库实际创建，并在 launch 时保存 ChildProcess。关闭、完整重启与清理均使用保存的子进程引用。

同一 reviewer 复核：测试只在独立临时根目录创建库，linked-folder 指向只读源，删除前校验根目录与 reparse points，并确认保存的子进程退出；没有发现新的测试生命周期/清理阻断。前述被自动审批拒绝清理的 scheduler fixture 仍保留，不因本审查改写为“全部清理”。

主 agent 报告当前构建真实旅程 **1 passed / 50.2 秒**：28,930 资产，106 个 batch ready 后暂停 518 项，往返 21 ms；暂停与正常完整退出重启后均无新自动任务；目标图片新 artifact 经协议 URL 解码；全部恢复后其他资产继续完成，最终再次暂停并清理成功。reviewer 未独立重跑，不称人工或 packaged 验收。

## 保留边界

- 前台按用户要求未执行；UI 人类验收、packaged/macOS、用户原库升级后的同负载尚未验证。
- 全仓类型仍受其他 CLIP 轨道 4 项错误阻断；完整 MCP 测试另有既有搜索表达式断言不一致。本次直接相关投影用例通过，不称全仓绿。
- 本轮证明暂停合同修复，没有浏览/文件夹延迟的前后对照；整体性能目标仍进行中，未签署整项 accepted。
