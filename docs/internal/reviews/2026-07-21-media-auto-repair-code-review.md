# MEDIA-003 代码审查：媒体环境恢复后的历史预览自动修复

> 状态：review complete — QA incomplete
> 审查范围：当前工作树中 MEDIA-003 相关改动
> 分支：`codex/windows-adaptation`
> 审查模型：Composer 2.5（Standards / Spec 两轴）

## 基线与范围

审查目标为：

- `src/worker/library-service.ts`
- `src/worker/index.ts`
- `tests/worker/video-exr.test.ts`
- `docs/internal/implementation/0006-thumbnails-preview-format-decoding-vertical-slice.md`
- `docs/internal/development/2026-07-21-media-auto-repair-development-log.md`
- `docs/internal/qa/2026-07-21-media-auto-repair-qa-report.md`
- `docs/internal/qa/human-acceptance-checklist.md`
- `docs/internal/project-status.md`

用户已有的 `README.md`、`vite.renderer.config.ts` 改动和根目录媒体二进制不属于
本次审查主体；README 中与自动修复相关的一行说明作为本功能文档变更核对。

## Standards 审查

独立审查结论：Worker 架构边界、SQLite 入队事务、失败 artifact 失效路径、
错误码白名单和会话级防重复设计无数据损坏级阻断项。

- **一般问题（已处理）**：`scheduleThumbnailScene` 将 `repairFailed` 传给
  所有可见区/刷新调度；组件缺失时会在 Worker 同步路径反复执行
  `execFileSync`。新增 `autoRepairProbeFailedAtByLibrary` 负缓存，30 秒内
  同一资源库/组件不重复探测，并在关闭资源库时清理。
- **一般问题（已处理）**：修复波次成功完成后才写入
  `autoRepairAttemptedByLibrary`；当前实现不会在入队事务抛错前提前标记。
- **一般问题（已处理）**：补充 `media-auto-repair.enqueued` 诊断事件，带
  `libraryId`、组件列表和 `enqueuedCount`。
- **建议（已处理）**：移除未被外部使用的 `MediaAutoRepairComponent` 类型导出。
- **建议（保留）**：真实生成能力可能比 `-version`/`--help` 探测更严格；
  生成再次失败时依靠显式重试，不能把探测成功写成完整媒体能力证明。
- **未验证**：真实 Electron、Windows/packaged、完整进程重启和 Computer Use
  仍未执行，不能以 Worker 单测替代。

## Spec 审查

独立审查结论：Worker 实现基本覆盖组件缺失自动修复、历史任务重置/入队、
启动与调度入口、非组件失败终态和会话防循环；按四列验收纪律仍为
“部分完成/未验证”。

- **阻断项（未解决，证据门禁）**：已新增
  `tests/e2e/media-preview.test.ts` 的“组件恢复 → 完整退出/重启 →
  自动入队 → 实际媒体解码”旅程，但当前 Windows Electron 启动阶段拒绝
  Playwright 的 `--remote-debugging-port=0`，因此仍无通过证据；Windows/
  人工验收也未执行。
- **一般问题（已处理）**：OIIO 用例补充第二次 `repairFailed` 调度返回 0、
  job 数不变的会话去重断言。
- **一般问题（已处理）**：新增缺失组件 probe 节流回归，锁定可见区调度不
  反复同步探测的性能契约。
- **范围决定（已记录）**：自动修复只处理当前 revision 的 `thumbnail` /
  `video_poster`；`extracted_metadata`、`contact_sheet`、`webm_proxy` 的
  孤立组件失败不在 MEDIA-003 本次预览修复范围。
- **建议（未扩展）**：`defaultMediaComponentProbe` 的真实 ffmpeg/ffprobe
  对称性仍依赖现有 resolver/Worker 集成；本次不引入依赖本机二进制的单测。

## 处理记录

处理结论：实现修正已落入当前工作树；修正后的定向 Worker 37/37、定向
ESLint 和 `git diff --check` 通过。媒体 E2E 已执行但被 Electron 启动参数
阻断，QA 结论保持 `QA incomplete`，不标记 `accepted`。审查 agent：
Standards `a712b98f-72c6-4b54-94a0-b8c3a6ae90c7`、Spec
`e1c5519e-6568-499c-94a7-feee34a2a569`。
