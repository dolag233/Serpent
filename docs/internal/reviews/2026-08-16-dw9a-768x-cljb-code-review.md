# 2026-08-16 `dw9a` / `768x` / `cljb` 独立代码审查

## 审查范围

- 审查基线：当前工作树，覆盖 `Serpent-dw9a`、`Serpent-768x`、`Serpent-cljb` 的实现、测试与证据文档。
- 审查角色：独立 `gpt-5.6-luna` 角色；一次审查同时覆盖 Standards 与 Spec 两轴，符合本仓库本会话只启动一个审查 agent 的门禁。
- 重点：大型资源库导入热路径、视频 source-first/fallback、数据库恢复边界、Eagle 转换库生命周期、Renderer/Main/Worker 边界和测试证据可复现性。

## Standards

首轮审查发现开发日志中的实现行号已落后于当前代码，以及视频 fallback 的最长轮询在资产切换、手动重试或查看器卸载后可能继续回写旧状态。已完成以下修复：

- 四列证据中的恢复、Eagle、导航和视频实现行号已更新到当前文件位置。
- 新增 `src/renderer/proxy-fallback-run.ts` 的 generation guard；资产切换、卸载和手动重试都会使旧运行失效。
- `AssetPreviewModal` 的 `resolvePreview` 在请求前、响应写入前、错误处理和 loading 收尾前检查 guard；fallback 轮询传入同一个 guard，因此旧 IPC 响应不能再污染新 viewer 的 resolution/error/loading/direct-approved 状态。
- 新增 `tests/unit/proxy-fallback.test.ts` 锁定新运行和 invalidate 的失效语义。

增量复核确认 guard 模块职责单一，未发现新的架构边界、命名、主题样式或测试隔离问题。`library-service.ts` 仍然偏大属于后续架构演进建议，不作为本次工单阻断。

## Spec

- `768x` 的自动化覆盖已补充多层文件夹/合集、长名称、缩进、disclosure、数量列、选中态和点击回调；结构化证据已具备。但 happy-dom 单测不能证明真实浏览器中的像素列对齐、ellipsis 计算或三层以上真实布局，Computer Use/真实 Eagle 小库仍是人工/平台待执行项。
- `dw9a` 已补 Inspector 在已知位置没有候选时显示“选择恢复位置”并保留 relink 入口的 Electron E2E 断言；Worker 候选指纹和协议边界也有覆盖。真实物理损坏完整退出/重启、恢复候选完整选择根目录旅程、packaged/Windows 仍未验证。
- `cljb` 已覆盖 source-first、真实媒体错误事件后的单项 proxy、复用、失败不循环、弱提示隐藏/恢复和旧 fallback 运行取消。当前媒体 E2E 为确定性 `MediaError` 注入，不能替代真实平台 codec 不支持矩阵；该限制明确保留。

## 验证证据

- `npm run lint`：通过。
- `npm run typecheck`：通过。
- 定向恢复/导航/fallback Worker/单元测试：6 个文件、99 项通过，包含 `tests/unit/proxy-fallback.test.ts` 的生命周期 guard。
- 生命周期修复后的定向 Electron E2E：`node scripts/run-e2e.mjs tests/e2e/media-video-playback.test.ts tests/e2e/trash-relink-flow.test.ts tests/e2e/linked-folders.test.ts`，5 passed（21.1s）。
- 当前工作树追加 guard 后的完整 `npm run verify:mainline`：通过；421 个测试文件 passed、9 skipped，3709 个断言 passed、16 skipped，搜索性能 5/5，Electron E2E 80 passed / 3 skipped（4.3m）。

## 结论

代码审查发现的实现问题已修复并完成增量复核；外部平台证据缺口仍按“未验证”记录。因此 `Serpent-cljb` 可保持已关闭，`Serpent-dw9a` 与 `Serpent-768x` 在真实损坏/真实 Eagle、packaged 和 Windows 证据补齐前保持 `IN_PROGRESS`。
