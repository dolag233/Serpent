# 统一撤回/重做 QA 报告

> 规格：[统一撤回/重做顶层设计](../superpowers/specs/2026-08-12-unified-undo-redo-design.md)  
> 开发日志：[2026-08-12 开发记录](../development/2026-08-12-unified-undo-redo-development-log.md)  
> 分支：`dev`  
> 基线：`6876b380fe1a104986fe4d614be10942bc5af523`  
> 环境：macOS 开发工作树，Node 24 系列；无 Windows runner  
> 结论：有条件通过；未达到 `accepted`

## 自动化证据

| 档位 | 命令 | 结果 |
| --- | --- | --- |
| TypeScript | `npx tsc --noEmit --pretty false` | 通过 |
| Lint | `npm run lint` | 通过 |
| Diff hygiene | `git diff --check` | 通过 |
| 历史/recipe/通知定向回归 | `npx vitest run tests/unit/automation-command-toast.test.ts tests/unit/operation-history.test.ts tests/worker/operation-history.integration.test.ts tests/unit/operation-history-recipes.test.ts tests/unit/toast-notifications.test.ts --reporter=dot` | 5 files，54 passed |
| Unit 全量 | `npm run test:unit` | 314 files，2421 passed，1 skipped |
| Worker 全量 | `npm run test:worker` | 61 files，1009 passed，4 skipped；10 项按仓库既有配置跳过 |
| 主线门禁 | `npm run verify:mainline` | Unit/Main 通过（374 files passed、4 skipped；3425 tests passed、11 skipped），搜索性能 5/5 通过；Electron E2E 77 中 62 通过、12 失败、3 跳过，整体不通过 |
| 核心撤回 Electron E2E | `npm run verify:mainline` 内的 `managed-move` 用例 | 组合运行通过；此前单文件连续两次在建库后等待“添加文件夹”超时，记为环境/时序不稳定，不把失败归因于 Worker 历史 |

## 覆盖到的关键行为

- metadata、folder、tag、collection、smart collection 的 forward → undo → redo。
- 资源库关闭/重新打开后历史仍可读取。
- redo 以持久 `redo_sequence` 维持 LIFO，并在新的 forward mutation 后清除。
- 外部 metadata 变化使条目 stale，撤回不会覆盖外部值，并返回结构化 `HISTORY_STALE`。
- 永久删除 barrier 不暴露 undo/redo。
- asset restore 的重复 undo/redo 循环不会复用已经消费的一次性 trash operation。

## 未执行和风险

- 已基于当前工作树重新构建 macOS arm64 packaged app，且 postPackage runtime/Host 校验通过；没有执行 Computer Use，`verify:mainline` 的 Electron E2E 档位仍失败（见上表），因此 Renderer 菜单/快捷键/真实 toast 仍不能写成完整旅程通过。
- Windows 未执行。需要覆盖 Windows 文件大小写、占用句柄、同名冲突、跨卷 move/copy、Unicode/长路径、回收站和应用菜单快捷键。
- transition attempt 的崩溃路径当前是 stale 保守降级，不是完整 compensation/recovery；不能以“有 attempt 表”替代真实 kill/restart 对账。
- 大 recipe admission guard 已有；标签 merge 已做小规模集成循环，但没有用真实导入/内容替换/大关系快照建立容量、耗时和清理基线。
- 当前脚本 undo 是多个 Worker history entry 的逆序投影，不是单个跨命令 HistoryEntry；部分成功语义仍需独立验收。

## 验收判定

当前可标记为“第一阶段实现 + 自动化有条件通过”。在独立代码审查、主线门禁、真实 Desktop 旅程和 Windows 证据完成前，不标记切片或相关 Beads epic 为完成。
