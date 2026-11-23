# 主预览与派生媒体在线调度审查

工单 `Serpent-c1371a`。单一独立Luna同时审查Standards与Spec；主agent整理实际报告与最终命令，不自签accepted。审查范围是本轮Worker index的增量和新增调度回归，不把累积工作树里的暂停、RAW、CLIP等其他变更混为本轮。设计及四列证据见[开发记录](../development/2026-11-16-media-primary-secondary-fairness.md)。

## Standards

未发现确定性代码阻断。复用原secondary泵、idle、协作取消、grant及native semaphore，没有新I/O接口或资源库数据库所有者。foreground状态按controller身份结算，暂停/关闭清理恢复标记；新增普通wake仅保留后续normal调度，不扩大urgent精确授权。

测试的资源生命周期有明确归属：shutdown ACK、异步Service close、边界及reparse核验后才异步删除，失败用AggregateError暴露。早期同步删除的EPERM不归因产品崩溃或Sharp缓存；改异步关闭/删除后的最终fixture正常清理。6个早期失败测试目录的删除被自动审批拒绝，保留且未绕路重试，因此不能称工作区完全洁净。

审查时发现开发日志状态滞后，仍写产品/扩展回归待完成；主agent随后已更新到最终10图GREEN、四次真实Electron结果及上述清理限制。该文档修正不是审查者亲自运行测试或重复验收。

## Spec

未发现当前增量的确定性代码阻断：非空primary波在允许automatic admission时独立唤醒secondary，有活动/排队primary时缩为单任务，排空后恢复原batch；actual visible/pending波及idle在RAW admission前后重新检查。对账的精确scope没有被误标为前台；urgent explicit保持原精确路径。

最终测试 `media-fairness-scheduler.test.ts:324` 起在显式palette所有者hold时全部resume，等primary排空且普通secondary调用不增长，再释放所有者，无需额外wake要求10项palette全部succeeded。该行为覆盖普通wake经过urgent所有者的保留与恢复。**全部resume本身会先发普通wake，因此它不能把保留标记的因果唯一归给最后primary波，也没有独立mutation-negative-control。**不把这项限制写成已覆盖。

自动化证据：新增Worker 1 passed（测试7.82秒），既有直接相关Worker 13 passed；定向lint通过。当前构建真实online两源及native浏览两源共4次passed，颜色完成从0到75/74；单轮、含导入和缓存差异，不证明因果提速或长期排空率。A保留1,202ms慢跳与52ms long task。最后全仓类型检查仍4项无关CLIP错误，extension检查未执行；20k标准分布基线本轮未跑，不能记绿。

人工/前台按用户要求未执行，packaged/macOS/OS物理输入、原实例同负载及真实视频/音频proxy吞吐仍未验证。`MEDIA-FAIRNESS-037`仅待人类验收。用户要求本轮收尾后停止，剩余reporter重激活与固定SQL成本候选留在文档，不继续开发、不关闭总体性能目标。
