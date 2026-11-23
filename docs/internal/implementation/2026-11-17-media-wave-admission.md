# 可见媒体领取与实际资源准入

关联整体性能 `Serpent-3kfe`、迟就绪 `Serpent-fe5da4`。本文件是本轮设计和验证约束，未完成的项目不代表已经验收。

## 已有证据

真实照片链接源 15,465 项，隐藏 Windows Electron 远跳场景连续未达两秒内九成解码。五张 ARW 约 0.64 秒已实际可见，并已报告为 immediate；另一轮 0.669 秒入队、两秒时仍 attempt=0。它们实际生成仅数十毫秒。

匿名竞争时间线中，当次波约 25 个 job 先完成 23 个短任务，另两个 `generate_thumbnail` 分别持续约 0.84、1.41 秒。新五张直到旧尾项结束才被领取。25 是该场景的当次预算，不是默认队列容量。未结算的早期 job-start 不能单独证明仍占着 decoder。

同时确认一个独立正确性错误：同成员列表仅重排时，旧 sorted-set key 复用旧 CASE 参数顺序。已用两个明确阻塞的已领任务、只留一次后续领取的 Worker 用例稳定 RED，修复 ordered key / 同长度语句复用后整文件 10 项通过；真实迟就绪仍在，不能以该增量宣布完成。

## 方案

1. 复用现有可变 claim scope、图像优先顺序、原生 semaphore 和共享 384 MiB 预算。候选顺序改变必须更新绑定参数；仅 SQL 形状变化时重新 prepare。
2. 队列仍只允许现有交互上限内的 live worker。新增可唤醒 worker group：旧慢任务保留所有权，其余 worker 因当次预算耗尽退出后，新可见意图能复用空槽，不必等整个 `Promise.all`。不是提前返回旧任务，也不取消已领取的当前工作。
3. 可见更新在已有活动 scope 上投递一个合并的、下一事件循环唤醒。每次意图最多补到现有 100 项上限，取最大剩余预算而不是累加重复报告。普通后台初始并发保持 2；只有新可见意图可进入现有交互上限 4。不增加上限或媒体接受限制。
4. 唤醒后新领取采用交互图像排序与 lane，并保留精确 overlay 范围，不能落回全库。已经领取的后台任务保留自己的 lane。显式授予、用户暂停、失效库、旧 controller 不接受自动唤醒。
5. group 完成/失败必须等所有在途任务结算再移除 owner；失败关闭新唤醒，阻止后续 claim。返回与 promise 结算间的唤醒不能丢失，已关闭 group 不能复活。所有 handle/Immediate 随同原 scope 清理。
6. OIIO 保持全进程单槽，但用既有 memory budget 的 keyed admission 原子取得“单槽 + 字节”。禁止排队等 OIIO 的任务预先占用预算。当前嵌套 memory→semaphore 可让三个 112 MiB 申请占到 336 MiB，实际只有一个执行，阻塞仍可容纳的 64 MiB 其他 decoder；复用 FFmpeg 已有的 keyed 机制解决，不提高内存预算。

## 验证要求

| 条目 | 实现边界 | 自动化证明 | 平台/人工证据 |
| --- | --- | --- | --- |
| 同成员重新排序生效 | LibraryService claim 参数 | 受控 Worker RED→GREEN，既有队列顺序/缩窄/回落回归 | 当前真实迟就绪仍存在，不能作整体验收 |
| 慢旧任务仍在时新可见领取进入空槽 | 可唤醒 group + Service wake ref + Worker index | deferred 单测覆盖空槽复用/上限/结算竞态/错误；Worker 实际任务控制回归 | 两真实源当前构建的隐藏 Electron，图片实际解码；尚待本轮执行 |
| 自动许可与关闭语义正确 | 同一 queue/controller 生命周期 | 暂停/指定恢复/显式/取消/关闭回归，完整库可用性 | 前台按用户要求不操作，packaged/macOS 未执行 |
| OIIO 等待不提前占内存 | 既有 native budget keyed admission | 控制首项 native spawn、后续 OIIO 等待、其他 decoder 可完成；OIIO 峰值仍 1 | 单测仅证明准入，不能冒充实际媒体解码 |

性能对照使用经授权的只读真实源、全新可写 catalog，保留失败断言与匿名阶段关联。标准两万资产基线另记录，不把合成分布当作真实媒体旅程。当前源码须实际构建后验收；更改 LibraryService 后完整运行资源库可用性。大范围实现完成后由一名独立 Luna 同时检查 Standards/Spec；人工清单只能在无本范围已知阻断后新增待验收项。
