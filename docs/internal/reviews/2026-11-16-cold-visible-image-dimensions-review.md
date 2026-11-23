# 冷可见页尺寸管线：独立双轴审查

范围：`Serpent-7d664f` 的 header 共享、逐项完成发布、Renderer 可见报告固定节奏。审查者为单一 Luna xhigh 独立 agent，同时覆盖 Standards 和 Spec；开发与最终命令执行由主 agent 完成。工作区 RAW 方向及其他文档格式开发不属于本次审查范围。

## Standards

复用既有 `SingleFlightRead`、`AsyncSemaphore`、安全路径解析、metadata 工件存储及 dimensions 事件，没有引入第二套任务系统或任意路径/SQL 能力。共享按 OpenLibrary 实例与 revision 隔离，不保存结束后的私有 metadata 缓存；准入后复用 canonical 工件。每库三个、跨库四个 header 是文件 I/O 限额，未增加原生图片解码预算。Renderer 使用独立小模块维护 frame/deadline，没有继续向巨型组件内联调度逻辑。

审查指出两项阻断，均已修正：

1. primary 读头 await 后必须重新检查 deleted、ignore 和 availability，而不能只比较 revision。新增受控 gate 测试，先改变 ignore 再放行，确认没有持久化或 SOURCE_DIRECT。
2. linked root 已 offline 时，资产行 availability 可以暂时仍为 available。独立探测需初始与完成后检查根 status，primary 需完成后检查根 status。两个测试只改变根目录状态，保持资产可用字段，确认不发布或取消任务。

取消或异常采用 `Promise.allSettled` 等待两个消费者收口，没有方法返回后仍游离的完成回调；独立调用取消不取消其他消费者共享的读取。最终复核没有新增 Standards 阻断。真实媒体源始终只读，临时 catalog 与 userData 独立；清理拒绝必须保留并上报，不能写成全部清理完成。

## Spec 与回归

独立消费者完成即领取下一项，先完成的图片不等慢 header。输入顺序仍用于准入，返回数组保序，完成 callback 按完成时刻发布。已有原图直出安全阈值未变，失败的 metadata 写入不宣布 source-ready。关闭重开、修订变化、非图片排除、canonical metadata 竞态都有直接断言。

固定 80ms cadence 跨同库几何 effect 重建保留，切库重置，cleanup 取消旧 frame；不再让每次 scroll 重置 trailing timer。保留 mutation re-arm 与 Worker generation 校验。最终复核未发现新增功能阻断，但未亲自执行 Electron 或前台检查，不能代替用户体验验收。

主 agent 最终命令证据：Worker 13/13，既有 thumbnails 定向 3 passed，Renderer 4 files / 27 passed，完整库可用性 238 passed / 1 skipped，标准 20k 混合媒体 3 passed；定向 ESLint 0 errors / 1 条既有 AI jobs dependency warning。全仓 typecheck 仍由其他文档格式开发四项错误阻断，不声明全仓绿。

追加投影改动前，真实 28,930 项隐藏 Windows Electron 受控两版各 1 passed：目标跳点误差均 <0.0003、最终真实解码覆盖均 100%。连续滚动新增媒体地址 0→32；帧 p95 18.6→18.9ms，脚本样本因实际开始加载而上升。四点九成显示为 1059/674/612/953→853/751/554/904ms，其中一点更慢，不能宣称冷整屏稳定明显提速。用户要求不做 Computer Use，packaged/macOS 未执行。结论为此增量无已知代码阻断，`PREVIEW-COLD-027` 待用户验收，整体性能工作未完成。

## 追加投影与版本化帧队列复核

仍由同一个 Luna agent 只读复核，没有增加审查集群。首次资产投影改为字段级幂等，同值保留资产 / 数组 / sequence frame 引用。对计数失效的初版只看 summary 尺寸差异；审查指出这不能证明 counts 快照新鲜，跨频道晚到交错未复现，未据此宣布产品回归。实现者采用保守兼容行为：首个有效完成通知仍失效，只有同资产、revision、mediaType 和尺寸的重复通知跳过，512 项 LRU；不新增协议保证。

审查进一步指出一个已有的明确队列路径：未加载 folder-cover ID 入队时不能核 revision，原 pending map 不保留它；下一帧前 R2 summary 到达会接收 R1 尺寸。新增帧队列按相邻 revision 分组合并，flush 对资产快照及 functional setAssets 当时的 current 两次解析，不把旧 versioned 尺寸与新无版本 thumbnail 一起吞掉。直接单测证明同一 snapshot 对 R1 有效、随后 R2 无效。

最初的未知 ID 放行仍会把旧 source route 写入无 revision 的 compact slot，审查要求收敛：未知 versioned 组只投影 width/height，完整 patch 按资产和修订暂存，匹配 summary 到达后重放，再走队列校验。Luna 最终确认该泄漏路径已覆盖；owner cleanup 清 deferred、解除 replay ref 并取消 frame；没有发现此范围其他具体阻断。compact index 无 revision 的几何补丁、既有无 revision 的事件不被写成完整端到端版本保证。

最终主 agent 证据：Renderer 四文件 **40 passed**；当前源码重建的只读真实源隐藏 Windows Electron **1 passed，31.0s**，四跳真实图片最终解码 100%；十次重复尺寸通知计数请求 **0**、真变化 **1**、还原继续刷新。该运行首图 387/236/199/302ms、九成 779/573/496/862ms，连续四秒新增地址 35、帧 p95 19.0ms，创建可见 177ms；它不是追加改动的新受控 A/B。特定旧 revision 桌面交错未单独复现，确定时序由 Renderer 单测覆盖。独立审查未执行测试或前台操作，用户体验验收仍待本人确认。
