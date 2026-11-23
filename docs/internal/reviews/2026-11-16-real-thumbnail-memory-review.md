# 真实缩略图内存测量复核

- 范围：`real-thumbnail-memory.test.ts`、`thumbnail-memory-probe.ts`、堆摘要与 writer 测量辅助模块/单测及对应开发记录；产品代码未变化。
- 角色：单一独立 Luna，Standards 与测量规格双轴；主 agent 集中串行运行隐藏 Electron。

## Standards

确认固定帧直方图/计数器不保留历史 URL，Electron KiB 与 CDP bytes 换算正确；只有隔离目录可写，先关闭应用再清理，拒绝 reparse point。匿名摘要只输出类型/白名单和最短非 weak 根路径，明确不是 dominator retained size。

发现两项诊断边界：暂停支路可能漏掉 queued 和轮询间短任务；256 MiB 原来只限制 JSON 解析。主 agent 已强化 queued/完成数稳定检查，另加 UTF-8 字节写盘预算、超限不解析。writer 单测 3 passed，连同摘要共 6 passed；最终六文件 lint 无错误警告。修订后没有再运行完整 19 分钟数据，不能算第二轮 Electron 通过。

同一 reviewer 对上述增量复核无新具体阻断；仍保留暂停模式 300 ms 旧 fanout 沉降窗口内短任务可能进入 baseline 的限制。该模式是有界复现，不能替代后续暂停实现的可控时序验证。

## Spec 与证据

真实 15,465 个资产链接导入，10,059 个唯一离屏 ready artifact，4,350 个批事件，单批最多 6；原图直出、取消和失败不计入成功。前后可见固定页 16/16 图片完整解码。自然耗尽运行 1 passed，原始堆图实际解析并随后清理。

1,025 / 2,522 / 5,002 个完成项时，Renderer 私有内存 270.50 / 255.43 / 256.19 MiB；最终 idle 15 / 45 / 90 秒为 267.72 / 271.98 / 281.07 MiB。未复现历史多 GiB 增长，但 idle 仍缓慢上升，**不宣称已证明长期平台**。快照后 349.36 MiB 与约 2.6 秒帧间隔是诊断扰动，单列。

原始快照 145,575,457 bytes，小于后续写盘预算；数据中的三个 idle count 均为 10,059，最终 queued/running 均为 0。root 已核查本轮 memory 临时目录为 0、没有 Electron/Serpent 残留；未触碰前轮被拒绝清理目标。

## 保留项

- 暂停模式首次 pilot 已失败，产品缺口为 `Serpent-1deebf`，尚未修复。
- 最终 82 项媒体任务失败没有按种类/错误码归因，不等于所有缩略图或全部格式兼容通过。
- 3D/FBX、不同导航/悬停历史、90 秒后的长时平台、packaged/macOS 未验证；本轮没有浏览延迟对照。
- 全仓类型检查仍有其他 CLIP 轨道 4 项既有错误；本轮不是全仓绿或产品 accepted。

详见[开发记录](../development/2026-11-16-real-thumbnail-memory-investigation.md)。
