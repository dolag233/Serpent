# 0024 插件平台运行时管理与交互内核代码审查

## 审查范围

- 规格：[`docs/implementation/0024-script-plugin-platform.md`](../implementation/0024-script-plugin-platform.md)
- 基线：`a857671`
- 审查对象：基线到当前插件平台实现工作树的全部变更
- 审查日期：2026-08-02
- 审查方式：两名独立 Luna agent 分别执行 Standards / Spec 双轴审查；实现者随后处理阻断项

## Standards 轴

| 发现 | 位置 | 处理 | 结果 |
| --- | --- | --- | --- |
| App 中上下文组装逻辑超过约 60 行 | `src/renderer/App.tsx` | 提取 `buildPluginBrowseScope` / `buildPluginViewerState` 到 `src/renderer/plugin-context-state.ts` | 已修复 |
| 缺少 0024 切片级 review / QA 文档 | `docs/development-process.md` 的切片交付要求 | 新增本报告和 `docs/qa/0024-script-plugin-platform-qa-report.md` | 已修复 |
| Standard/Trusted/QuickJS Job bridge 有重复实现 | 三个 Host 文件 | 本阶段保留重复边界，避免在功能收口时引入跨运行时抽象；记录为后续重构项 | 接受，非阻断 |
| 多处调用重复传递目标库上下文 | `src/main/index.ts` | 当前行为已通过目标库路由测试；待 Gateway 上下文对象统一时处理 | 接受，非阻断 |
| Job owner 字段仍允许读取缺失值 | `src/plugins/plugin-jobs.ts`、`src/worker/plugin-job-repository.ts` | 现有 Worker 状态封装保留字段级局部读取；新 Job 创建始终写入完整 owner，后续库重建时可收紧 schema | 接受，非阻断 |

## Spec 轴

| 发现 | 位置 | 处理 | 结果 |
| --- | --- | --- | --- |
| setup context 声明了 `contributions`，运行时却未提供 | 规格 §5 与 Host | 统一契约：Contribution 由 manifest 在 setup 前注册；移除动态 Registrar，setup 提供 `signal` / `subscriptions` | 已修复并记录偏离 |
| Trusted supervisor 原先发送 deactivate 后立即 kill | `src/main/plugin-trusted-runtime-supervisor.ts` | Activated instance 改为等待 `plugin-trusted.deactivated`，超过 grace deadline 才 kill；未完成 setup 的实例仍立即结束 | 已修复 |
| global instance 崩溃不会暂停跨库 Job | `src/main/plugin-activation-coordinator.ts` | 按所有 tracked open libraries 对 global owner 发出 pause 请求；停用前同样暂停 | 已修复 |
| Contribution Context 携带过大的 asset/folder ID 数组 | `src/plugins/plugin-context.ts`、Renderer builder | Contribution Context 改为有界摘要与 opaque `selection.ref`；Invocation Context 通过显式目标传递完整 ID | 已修复 |
| Placement 规格包含 `first` / `last` 而 schema / solver 未实现 | manifest、registry、renderer solver | 补齐 schema、registry、Main/Renderer 传递和确定性排序测试 | 已修复 |

## 结论

两轴审查未留下阻断项。当前交付仍不是 `accepted`：packaged、Windows、Computer Use 以及完整 Job task-center / 重启旅程尚未完成；对应风险保留在 QA 报告和人类验收清单中。

## 复审证据

- `npm run typecheck`：通过。
- `git diff --check`：通过。
- 插件平台定向测试：21 files / 271 tests passed；修复后新增的生命周期、global Job pause、first/last 测试同样通过。
