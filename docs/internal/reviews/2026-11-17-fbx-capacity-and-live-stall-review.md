# FBX 解析隔离与资源错误范围审查

- 基线：维护者工作分支 / `ebb7f9be`，本轮未提交工作区增量；不审查其他轨道和前轮全部修改。
- 实现：主 agent 与两个 Luna 分工；最终双轴审查：另一个未实现本轮代码的独立 Luna，单一审查 agent。
- 规格和证据：[开发记录](../development/2026-11-17-fbx-capacity-and-live-stall.md)，工单 `Serpent-f8b568`。
- 结论：实现增量无剩余确定性代码阻断，等待用户验收；不签署人工 accepted，不关闭总体性能目标。

## Standards

Library Worker 仍拥有文件和数据库操作，Renderer 未获得新路径、SQL 或 Node 能力。同步 WASM 解析运行在该 Worker 所有的 disposable thread；CJS bootstrap 通过 raw 字符串内嵌，不要求发布包运行源码 TS。输入专用副本再 transfer，调用者 Buffer 不被 detach；线程退出是任务结算和下一个任务启动的边界。排队取消不启动线程，活动取消终止线程；constructor、postMessage、error、异常退出和坏响应均有直接用例。

错误 code/errno 只允许有界字符串或 safe integer，接收端验证后保留；FBX 的公共结果仍经过既有 Zod 枚举，不增加任意数据能力。输入局部 WASM 容量错误与主机资源不足按类型区分，不通过改写错误文字诱导 regex。通用 native 压力保护继续有效。

查看器复用既有错误映射、错误状态和中英文 catalog；普通解析/传输失败仍保留兼容回退，没有自造样式或提示系统。无产品大小、三角数或墙钟上限的新增。取消共享只扩展原 single-flight，不另建重复路径；旧 finally 按 entry 身份比较，不删除新意图。

临时资源属于独立 fixture/profile，源只读；测试退出后精确清理本轮根，未触碰前轮拒绝删除或未知目录。产品新增解析线程不写磁盘。新增记录和增量代码需保持隐私扫描；完整提交级全仓扫描本轮未执行，因为没有提交。

## Spec

| 规格 | 独立审查判断 | 自动化/平台边界 |
| --- | --- | --- |
| 常驻 Worker 不保留扩容后的 WASM singleton，parse 不占宿主事件循环 | 满足；线程严格串行并等待 exit 后结算 | 7 个直接生命周期用例，21 个实际转换用例；真实同输入 Windows Electron 的浏览采样由主 agent 执行 |
| 单模型容量失败不反复冻结整库 | 满足；局部容量码走 terminal failure，host 码走共享退避 | 同/异库实际 Sharp 解码；完整 host 错误注入链；真实 FFmpeg 错误退避用例属于注入 |
| 取消后新请求可重新开始，旧请求不删除新共享项 | 满足；已取消 entry 不再可 join，底层线程退出屏障仍保留 | controlled deferred 覆盖，finally 结算测试遗留调用；真实 Electron 自然抢占后收敛 |
| 资源失败不在主界面重新执行 FBXLoader；普通模型继续显示 | 满足；错误检查在兼容 catch 外，两个资源码均禁止回退 | loader 单测、错误映射/Zod、真实错误文案/源请求监控和正常 FBX 几何显示 |
| 整个原实例长期内存和大型资源库全面流畅 | 未证明 | 原实例未取堆；短旅程和新 profile 不能证明约十三小时历史的全部保留者，packaged/macOS 和人工前台未执行 |

## 已处理的审查发现

1. **结构 ENOMEM 丢失（阻断，已修复）**：初稿只传 message，`{ code: 'ENOMEM', message: 'native allocation failed' }` 会丢失原生类别。现在 CJS envelope、父队列、converter 的 typed host 结果与 service 退避整链保留；直接和完整注入用例通过。bridge JSON `oom` 仍是输入局部容量错误，不会再次冻结所有任务。
2. **最终文案接线证据不足（已补）**：初始真实 E2E 仅检查错误状态存在，现在实际断言容量错误本地化文本，并以真实图片 fetch 正向核对源请求监听后断言 FBX 回退请求为零。
3. **deferred 夹具清理（已补）**：单飞取消用例增加 finally，结算 old/fresh 并等待所有已发起调用，防止断言失败遗留共享 entry。

独立 reviewer 的最后反馈为“增量复核没有发现剩余确定性阻断”。其没有独立运行测试；主 agent 随后完成最终门禁，以下为结果同步而非 reviewer 独立复跑：相关 unit 36 passed、协议定向 3 passed/123 skipped、Worker 23 passed、FFmpeg 定向 1 passed/84 skipped、库可用性 240 passed/1 skipped、标准 mixed 20k 3 passed、当前构建隐藏 Windows Electron 2 passed。定向 lint 通过；类型仍有 CLIP 轨道四项既有错误，扩展 tsc 未执行。

本轮没有修改 C bridge 或重建 WASM，因此已触发容量失败的大模型本身仍不能通过该转换器显示。修复的是失败范围、常驻内存和请求阻塞，不用减少功能的表述冒充“全部模型已兼容”。未来若降低 bridge 组装峰值，需独立构建、校验产物并重新验证真实输入。
