# 统一撤回/重做开发日志

> 规格：[统一撤回/重做顶层设计](../superpowers/specs/2026-08-12-unified-undo-redo-design.md)  
> ADR：[ADR-0032](../adr/0032-worker-owned-unified-operation-history.md)  
> 分支：`dev`  
> 基线：`6876b380fe1a104986fe4d614be10942bc5af523`  
> 开始/最后更新：2026-08-12  
> 状态：第一阶段实现完成，等待独立代码审查、完整主线门禁和人类验收；不是 `accepted`

## 1. 本次实现范围

本次把撤回/重做的事实来源从 Renderer 单槽和 Main 的脚本 Undo Group 迁移到资源库 Worker：

- 新增版本化、Zod 校验的 forward/inverse recipe registry；未注册的 recipe pair 会被 Worker 拒绝。
- 在资源库数据库中持久化 `operation_history`、步骤和 transition attempt，并执行每库线性栈、栈顶 fencing、redo 分支截断、barrier 和 stale 投影。
- 接入资产移动/复制/重命名/回收站、文件夹创建/重命名/移动/回收站、元数据、标签关系/实体（含 merge）、合集/合集成员、智能合集等第一阶段高频操作。
- 把脚本、MCP、插件命令的来源和 `historyEntryId` 送入同一 Worker 历史；旧 `undoGroupId` 只保留兼容投影，不再拥有领域恢复执行权。
- Desktop 菜单、快捷键、toast/状态投影读取同一 `history.status`；文本输入获得焦点时仍优先使用编辑器原生撤回/重做。
- 永久删除、链接索引移除和回收站清空等不可逆操作写入 barrier，清除 redo 并使旧条目不可操作。
- 增加 recipe/admission 上限和对 stale/旧 barrier 审计行的 best-effort 清理；活动操作栈不会被清理。

## 2. 四列可追溯矩阵

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| Worker 持有每库持久历史、迁移和重启读取 | `src/worker/library-service.ts`；`src/worker/operation-history.ts` | `tests/worker/operation-history.integration.test.ts`；schema/migration 回归 | macOS SQLite 集成测试已执行；真实 Electron 完整进程/packaged 未执行 |
| forward/inverse recipe 必须成对注册并受 payload schema 约束 | `src/worker/operation-history-recipes.ts` | `tests/unit/operation-history-recipes.test.ts` | 静态代码路径已检查；Windows 未执行 |
| undo/redo 栈顶 fencing、redo LIFO、新 mutation 截断 redo、stale | `src/worker/operation-history.ts`、`library-service.ts` | `tests/unit/operation-history.test.ts`；`tests/worker/operation-history.integration.test.ts` | 集成测试验证外部元数据变化不会被覆盖；未做真实 UI 操作 |
| 资产/文件夹/回收站等文件语义进入统一历史 | `src/worker/index.ts`、`library-service.ts` | operation-history integration + existing worker file/trash/linked-folder tests | macOS Worker 级文件验证；Windows 大小写、占用、跨卷、长路径未执行 |
| 元数据、标签、合集、智能合集共用历史 | `src/worker/bounded-write-command.ts`、`library-service.ts` | operation-history integration（metadata/tag/collection/smart） | macOS SQLite 集成验证；真实 Desktop 视觉未执行 |
| 脚本/MCP/插件与 Desktop 共享 history receipt | `src/main/*`、`src/automation/*`、`src/mcp/*`、protocol/preload | automation gateway/script IPC 定向测试、历史状态/集成测试 | 当前没有真实 MCP/Console/插件完整旅程证据；packaged/Windows 未执行 |
| 菜单、快捷键、动态 Undo/Redo 标签和文本焦点优先级 | `src/renderer/App.tsx`、`src/renderer/main-menu-items.ts`、`src/main/application-menu.ts` | menu/application/automation 定向单测；typecheck/lint | Computer Use 与真实窗口截图未执行，保留待人类验收 |
| 永久删除等不可逆行为截断历史 | `src/worker/index.ts` 的 barrier 路由、`library-service.ts` | operation-history integration barrier 测试；linked-folder/trash 回归 | 仅 macOS Worker 级证据；危险窗口真实旅程未执行 |
| 历史容量保护 | `src/worker/library-service.ts` 的 admission/retention | 类型检查和现有 schema/worker 回归；大快照基线尚未建立 | 未完成大文件/长期运行性能验证 |

## 3. 关键命令与结果

以下结果均基于本工作树的当前代码；工作树尚未提交，且包含其他 agent 的既有改动。

- `npx tsc --noEmit --pretty false`：通过。
- `npm run lint`：通过；仅有 Babel 对超过 500KB 的既有大型 Worker 文件的 deoptimised note，不是失败。
- `git diff --check`：通过。
- 历史/recipe/通知定向测试：5 files，54 passed；覆盖 MCP 桌面通知携带 `historyEntryId`、栈顶 fencing、recipe 和持久集成循环。
- `npm run test:unit`：314 files，2421 passed，1 skipped。
- `npm run test:worker`：61 files，1009 passed，4 skipped；10 项按仓库既有配置跳过。
- `npm run verify:mainline`：Unit/Main 通过（374 files passed、4 skipped；3425 tests passed、11 skipped），搜索性能通过（5 passed）；Electron E2E 为 77 tests 中 62 passed、12 failed、3 skipped，整体不能记为主线全绿。失败集中在既有浏览/媒体错误态/组织检索/插件路径；组合运行中的 `managed-move` 撤回用例通过。
- `node scripts/run-e2e.mjs tests/e2e/managed-move.test.ts`：单文件连续两次曾在创建资源库后等待“添加文件夹”超时（未进入移动/撤回断言），但同一用例在最终 `verify:mainline` 组合运行中通过；该单文件结果记录为环境/时序不稳定，不能单独当作稳定绿证据。
- `npm run package`：基于当前工作树重新构建 macOS arm64 packaged app；Main/Preload/Renderer/Worker 构建和 postPackage runtime/Host 校验通过。
- `npm run verify:package`：通过（声明文件包含 history.status/undo/redo）。

## 4. 与顶层设计的已知偏离

这些不是隐瞒的完成项，已由对应 Beads 子工单继续跟踪：

1. **崩溃恢复**：当前会把未完成 transition attempt 保守地标记为 stale，并保留诊断；还没有设计中承诺的逐 step 补偿/继续收口。因此不能声称“任意中断都自动恢复”。
2. **脚本 intent group**：当前 execution journal 持久化多个 `historyEntryId`，Console undo 会逆序请求 Worker；旧 Undo Group 仍作为兼容投影存在。还没有把一次脚本 execution 合并成一个跨多个 SQLite mutation 的单一 Worker HistoryEntry。
3. **大快照与第二阶段**：导入、托管内容替换、链接文件夹重挂载/删除、序列帧复合操作和大关系快照没有冒充第一阶段完成；标签 merge 已有精确关系快照和循环测试，但尚未建立真实大规模 merge 的容量/性能基线；`HISTORY_TOO_LARGE` 目前只提供 admission guard，完整 blob/容量策略仍待实施。
4. **平台与真实 UX**：本次没有执行 Computer Use、当前 Electron 全旅程、packaged app 或 Windows runner。Windows 只能在独立审查中做静态风险评估，不能写成“Windows 通过”。
5. **通知撤回竞态**：通知项现在携带产生它的 `historyEntryId`，内联撤回显式提交该 ID；不再从可能尚未刷新的 Renderer `operationHistory` 猜测目标。若 Worker 栈顶已被新操作改变，仍由 Worker 的 `HISTORY_NOT_TOP` fencing 拒绝，避免误撤回其他操作。

## 5. 继续入口

- `Serpent-5n4z.1`：本次 Worker schema/state/recipe 主线，当前实现中，需独立审查后再决定关闭。
- `Serpent-5n4z.2`：Desktop coordinator/menu/toast/text focus。
- `Serpent-5n4z.3`–`.8`：资产文件、元数据/标签、文件夹、合集、智能合集、脚本/MCP/plugin 接入。
- `Serpent-5n4z.9`：崩溃恢复、并发和 Windows 验证。
- `Serpent-5n4z.10`：大快照、容量和性能基线。
- `Serpent-5n4z.11`：文档/API/验收收口。

上述工单仍保持打开，原因是本日志明确列出的偏离和未执行证据尚未满足切片 `accepted` 的完成定义。
