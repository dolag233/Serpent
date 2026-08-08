# Wave 1–3 合流交叉审查（纪律 #11 补审）

> 日期：2026-07-17
> 范围：`3e49eb2..56685f5`（Wave 1–3 全部 15 个提交）
> 方法：5 个只读审查 agent（2 深度：Standards、Spec；3 广度覆盖 regression、dead code + accessibility、security，含未用 import 与 CSS 泄漏检查）
> 执行：主 agent（Kimi Work）；被审代码作者为另一 agent（Claude），满足独立最终验收角色分离

## 结论：PASS-WITH-FIXES（3 个确认 bug 已修复，见下文）

两个深度轴均通过：进程不变量保持（Renderer 只传 folderId，absolutePath 不出 Main；双向注入有拒绝测试）；纪律 #8/#10 合规（新逻辑全部抽独立模块；trash-preview 修复为正确边界根因）。Spec 轴对 12 个 REQ 逐项验证为真实实现、测试非空断言。

## 确认的缺陷与修复（本审查回合修复）

| 级别 | 缺陷 | 位置 | 修复 |
| --- | --- | --- | --- |
| HARD | 多标签排除过滤（≥2 个值）占位符未绑定参数，better-sqlite3 抛 "too few parameter values"，搜索直接失败 | `src/worker/library-service.ts:8355` | 补 `params.push(...filter.values)`；新增 worker 回归测试（多值排除 + 未命中保留） |
| HIGH | 分辨率（long_edge）过滤不触发自动搜索：未计入 `hasDiscoveryInput` 且不在防抖依赖数组 | `src/renderer/App.tsx:2284-2342` | 接入两处；与其他过滤器行为一致 |
| MEDIUM | `clearDiscoveryControls` 不清 `longEdgeRange`，切换范围后残留隐藏过滤 | `src/renderer/App.tsx:1429-1450` | 补 `setLongEdgeRange` 重置 |
| LOW | `.eyebrow` 选择器在 wave3 清除全部 eyebrow 后成为孤儿 CSS | `src/renderer/styles.css:937` | 已删除（保留 `.micro-label`） |

## 记录在案的后续项（不阻断验收，移交 backlog/后续切片）

1. **a11y**：左右侧栏拖拽手柄 `role="separator"` 无键盘操作（tabIndex/方向键/aria-valuenow 缺失）；FilterTagPicker listbox 无方向键导航。
2. **Spec 小偏差**：标签 chip 计数只显示在候选项（不在已选 chip）；无「全清」入口；REQ 要求的 DnD Playwright E2E 未写（仅单测覆盖），wave2 日志未如实记录该缺口。
3. **低危逻辑**：拖放移动不检查 `busy`（与导入中 UI 状态竞争）；「所有资产」范围同文件夹拖放的提示文案误导（worker 有防护）；框选 mousedown 会 blur 提交行内新建文件夹；TagPicker 空候选时 Enter 被吞；面板 resize 无 pointer capture（窗口外释放需再点一次恢复）。
4. **样式债**：styles.css 约 110 处字面 hex 未 token 化（wave3 只扫尾 2 处）；`InlineFolderEditResolution` 等少量类型导出未外部引用（装饰性）。
5. **既有问题（非本 wave 引入）**：旋转视频尺寸取自 ffprobe 原始宽高（未应用 rotation side_data），影响 long_edge/宽高比过滤精度。
6. **流程**：wave3 无独立开发日志（审查文档 + 清单条目代替），已在本文件补齐审查证据链。

## 审查后验证（主 agent 当次执行）

- typecheck / eslint：绿
- worker 测试：600 passed + 1 skipped（含新增多值排除回归）
- 单元测试、全量 Electron E2E：见本回合提交说明与开发日志追加
