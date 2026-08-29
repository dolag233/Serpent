# 媒体任务资源安全与查看器性能代码审查

## 审查边界

- 基点：`353f4d9a`。
- 范围：基点以来的媒体资源预算、Worker 调度、FFmpeg/Sharp/OIIO 调用、IPC 派生事件、查看器 source-first/proxy fallback、相关单元/Worker/Electron E2E/基准和文档。
- 审查方式：本轮用户要求不进行交互；未启动独立审查 agent，由主 agent 按 Standards / Spec 双轴完成自审，并以定向测试和主线门禁结果复核。
- 当前提交状态：实现工作树已通过静态检查和媒体定向验证，但还没有因此把主线全量门禁或平台验收写成通过。

## Standards 轴

| 检查项 | 结果 | 证据/处理 |
| --- | --- | --- |
| 架构边界 | 通过 | 原生文件、SQLite、解码器仍只在 Worker；Renderer 只通过 typed command/event；`asset.derived.ready` 为严格 Zod schema。 |
| 资源预算 | 通过 | 全 Worker/多库共享 Sharp 2、FFmpeg 1、OIIO 1；FFmpeg decoder/filter 默认线程均为 1；CPU 核数不再扩大内存预算。 |
| 错误分类 | 通过 | `src/worker/media-resource-guard.ts` 需要明确 ENOMEM/allocator/status 证据；普通 codec 错误和 `spawn UNKNOWN` 不会被误报成 OOM。 |
| 生命周期和重试 | 通过 | external hold、30s 起步的指数退避、最多 5 分钟、关闭/删除/退出 timer 清理；late artifact 会丢弃。 |
| 主窗口响应性 | 通过 | 主预览与次级派生分队列；次级单任务且交互空闲后执行；紧急 proxy 仅在用户明确 fallback 时绕过空闲窗。 |
| UI 规范 | 通过 | 本轮没有新增硬编码主题颜色或自造 tooltip；错误文案通过既有提示链路；事件只刷新选中的 Inspector。 |
| 测试质量 | 通过 | 有参数断言、真实媒体 bundle smoke、20k fixture opt-in RSS/event-loop 基准和实际解码 Electron E2E。 |

## Spec 轴

| 规格 | 结论 | 证据 |
| --- | --- | --- |
| 解决导入内存爆炸 | 已覆盖当前可观测根因 | 日志显示的是原生/进程资源压力；并发、线程、帧缓冲、退避和导入 hold 均有实现和压力模拟。真实用户素材无法复现，故不声称已在原始现场复现。 |
| 缩略图快且不卡主窗口 | 已覆盖 | `scale=640` 在 `thumbnail=30` 前；主预览优先；20k 混合基准三轮完成且资源失败 0；E2E 证明卡片图片实际解码。 |
| 质量允许降低 | 已明确落地 | 海报固定 640 长边、一帧 JPEG，文档与注释明确质量让位于速度/内存。 |
| 查看器 source-first | 已覆盖 | 直接 MP4 E2E 通过；播放错误后才 urgent retry proxy；已解码源不会在 pending poll 中闪退。 |
| 派生数据渐进刷新 | 已覆盖 | typed event + selected Inspector refresh；Worker 测试验证 poster 不等待慢 proxy/metadata。 |
| 不把一般错误当成 OOM | 已覆盖 | 单测明确断言 invalid input、`spawn UNKNOWN`、access violation 不触发资源熔断。 |

## 发现与状态

| 优先级 | 发现 | 状态 |
| --- | --- | --- |
| P1 | 未发现本轮媒体范围内会继续无限扩张原生解码并发、阻塞主预览或误报资源压力的阻断问题。 | 已处理/无 |
| P2 | `verify:mainline` 仍有 7 个非本轮媒体定向路径失败：迁移快照、reconciliation p95、lavfi fixture、macOS 临时路径、packaged native binary、UI dialog test double。 | 保留；记录于开发日志与 QA，不在本轮越界修复 |
| P2 | Windows、packaged 当前 HEAD、SMB/NAS 和真实用户不可复现素材没有证据。 | 未验证；保留人工/平台风险，禁止标记 accepted |
| P3 | 媒体基准是 opt-in，每轮抽取 100 个资产而非每次完整处理 20,000 个资产。 | 有意设计；避免 CI 产生不可接受的时间和磁盘成本，仍覆盖 20k fixture profile 与多轮资源峰值 |

## 复审结论

静态检查、资源库可用性和媒体定向测试支持本轮变更；实现没有通过扩大并发来追求吞吐，也没有用模糊的 `spawn UNKNOWN` 掩盖格式错误。完整发布结论仍被独立主线红灯和未执行的平台/人工门禁阻断，故本审查结论为“媒体范围有条件通过，非发布 accepted”。
