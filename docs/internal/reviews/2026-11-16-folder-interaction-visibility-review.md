# 文件夹提交后可见性：独立 Standards / Spec 审查

审查角色：独立 Luna xhigh，一名 agent 同时审查 Standards 与 Spec。实现与实际执行验证由主 agent / 实现 Luna 完成；审查者只读，没有启动实例、测试或构建。本记录整理其消息和最终复核，不代表人类验收通过。

范围：本轮 Renderer folder projection、inline edit session、App 接线和定向测试；不将已有 RAW/CLIP、暂停/尺寸/虚拟画布改动混入此轮。

## 发现与修正

- **P2，已修正**：初版 linked 当前 scope 改名回调在 `chooseFolder` 内部吞读取失败后仍返回 true。history 已换 ID，scope 可能仍旧，且 inline hook 因 true 跳过刷新。最终 bridge 在已成功提交的响应上同步重映射 scopeRef/UI/当前 history，App 使旧 content generation 失效；随后统一 after-paint refresh，读取失败不恢复旧 ID。独立复核确认原问题消除。
- **Standards，已修正**：App 初版两个 adapter 约 62 行，超过新交互应抽模块的指导阈值。已移入 `use-folder-mutation-bridge.ts`，App 仅约 15 行接线；复用既有 view token、投影模型和 hydration，不另造目录协议。
- **注释，已修正**：inline callback 的 true 语义更正为 caller 已处理内容收敛，避免将同步 identity remap 与可以跳过 refresh 混淆。

最终独立复核未发现本范围新增 P1/P2 阻断。隐私/磁盘方面，本轮源仅只读，写操作限制自有 fixture；未新增产品写盘路径或 UI 样式，没有 theme/fallback 变化。

## Spec 与证据边界

真实 probe 的最终一致性等待不能证明每条 linked path 的立即可见预算；创建时钟有独立 DOM/帧证据，linked/managed rename 另证明最终 UI/API/owned disk 收敛。最终 probe 增加在 active grandchild 中从侧栏改父目录名称，检查新 crumb/active row/后代 ID。读取失败和迟到会话由可控单测触发，没有在真实 Electron 注入。

主 agent 当前验证为 7 文件 50 项单测、两组真实库性能各 1 passed、真实 mutation 1 passed；详细命令、失败原因、原始对照与平台限制见[开发记录](../development/2026-11-16-folder-interaction-visibility.md)。性能没有所有链路稳定改善的结论，原工单及完整 PERF2-06 规格继续进行中。
