# 0024 插件平台运行时管理与交互内核 QA 报告

## 范围与环境

- 分支：`codex/plugin-runtime-management`
- 基线：`a857671`
- 实现提交：`02ead45`
- 日期：2026-08-02
- 环境：macOS arm64，Node 24，开发态 Electron；Worker 测试使用 Electron ABI 重建后的 `better-sqlite3`
- E2E userData：每次使用 `SERPENT_E2E_USER_DATA_PATH` 隔离临时目录

## 证据矩阵

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| global/library 统一 setup/dispose、scope、signal、subscriptions | `src/main/plugin-activation-coordinator.ts`、两个 Runtime Supervisor、两个 Host | 定向插件集合 21 files / 271 passed；Standard/Trusted Host 覆盖 dispose reason、signal、subscription cleanup | 4 条隔离插件 Electron E2E 通过；packaged、Windows、Computer Use 未执行 |
| UI-only 有界 Context、条件、隐藏/置灰/checked、多选 | `src/plugins/plugin-context.ts`、`src/renderer/plugin-contribution-context.ts`、`src/renderer/AssetContextMenu.tsx` | Context、browse/viewer、revision、菜单 solver、单/多/混合选择测试通过 | E2E 覆盖贡献列表/设置/重启恢复；真实右键点击与无选择/Viewer 全矩阵未执行 |
| manifest 菜单树、二级/三级、before/after/first/last、快捷键 | `src/plugins/plugin-manifest.ts`、`src/plugins/plugin-contributions.ts`、`src/renderer/plugin-menu-contributions.ts`、`src/renderer/plugin-surface-ordering.ts` | manifest/registry/solver/shortcut 测试通过；菜单 Placement Solver 与命令表面排序相关定向测试 30/30 通过，覆盖确定性排序、插件内锚点、缺锚点、循环边和超深分支 | 当前 E2E 未逐项验证真实原生菜单视觉一致性；Computer Use 未执行 |
| 批量内容替换与 revision 冲突拒绝 | `src/shared/content-replace.ts`、`src/worker/library-service.ts`、`src/shared/protocol/requests.ts` | Worker、Gateway、计划审批和恢复测试通过 | 开发态 Worker 证据；packaged、Windows 未执行 |
| Plugin Job owner、进度、取消、暂停/恢复、checkpoint | `src/plugins/plugin-jobs.ts`、`src/main/plugin-job-scheduler.ts`、`src/worker/plugin-job-repository.ts` | repository、scheduler、Standard/Trusted bridge、global crash pause 测试通过 | task center、完整跨进程取消/暂停恢复、应用重启恢复未执行 |
| 设置字段级容错 | `src/main/plugin-settings-store.ts`、`src/renderer/plugin-host-settings-fields.tsx` | settings store/sections 定向测试与插件设置 E2E 通过 | packaged、Windows、Computer Use 未执行 |
| 协议未知事件故障域与实例隔离 | `src/shared/plugin-*-runtime-protocol.ts`、两个 supervisor | 未知非关键事件、控制面故障、correlation/owner 校验测试通过 | 真实崩溃重启和 packaged/Windows 未执行 |

## 命令结果

- `npm run typecheck`：通过。
- `git diff --check`：通过。
- 定向插件测试：21 files，271 tests passed。
- `node scripts/run-e2e-isolated.mjs tests/e2e/plugin-management.test.ts tests/e2e/plugin-standard-host-activation.test.ts tests/e2e/plugin-trusted-host-activation.test.ts tests/e2e/plugin-unrestricted-settings-pages.test.ts`：4 passed，16.8 秒；构建基于当前工作树并使用隔离 userData。
- `npm run test`：307 files 中 298 passed、3 skipped、6 failed；2,699 tests 中 2,677 passed、8 skipped、14 failed。失败集中在既有 `user_version` 27/28 断言、历史 migration 重放时 `plugin_derived_fields` 重复创建，以及 100k 搜索性能用例超过既有 5 秒门槛；插件定向测试无失败。
- 全量 lint：未通过，主要为仓库既有 React effect、类型导入和 fixture globals 问题；不能作为本切片通过证据。

## 未执行与风险

- packaged 当前 HEAD 的插件全旅程、Windows、Computer Use：未执行。
- 任务中心 UI 与完整 Job cancel/pause/resume/restart 旅程：未执行，PLUGIN-042 保持“自动化证据不足”。
- 真实右键菜单的视觉原生一致性、无选择/混合选择/Viewer 全矩阵：未执行，PLUGIN-038/040 保持证据不足。

## 结论

有条件通过（开发态自动化范围）。代码、定向测试、插件 E2E、双轴审查和文档已具备提交条件；不能将本切片标记为最终 `accepted`，直到上述平台与完整任务旅程证据补齐。
