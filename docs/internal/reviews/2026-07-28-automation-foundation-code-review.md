# 2026-07-28：自动化基础（Registry / Gateway / QuickJS 原型）交叉审查

> 范围：`Serpent-y51c.2` 的 Automation Registry / Gateway，以及 `Serpent-y51c.3` 的 QuickJS/WASM 沙箱原型。依据 [0023](../implementation/0023-automation-scripting-mcp-framework.md) 与 [ADR-0025](../adr/0025-automation-core-script-runtime-and-mcp.md)。
>
> 结论口径：本记录只陈述此次代码审查和定向自动化证据；不构成 Desktop Console、MCP、打包平台或人类验收通过。

## 独立审查结果与处置

| 维度 | 初始发现 | 处置 | 当前结论 |
| --- | --- | --- | --- |
| Standards | P1：调用方可伪造 `context`，可能自授能力或切换资源库 | 公开命令信封收窄为 `executionId`、命令 ID 和输入；Gateway 只能经 Main-owned `AutomationExecutionResolver` 取得资源库、来源和能力，并补充拒绝伪造 context 的测试 | 已修复并验证 |
| Standards | P2：Worker 的 automation 标记没有实证证明会 fail-closed | 增加独立 `automation-readonly` dispatch；带标记的写命令不再落入桌面 Worker switch，测试断言 `tag.create` 不会调用写服务 | 已修复并验证 |
| Spec | P1：MCP output limit 只是元数据，列表/搜索可以无界返回 | 所有公开集合改为 `offset` / `limit` 分页（默认 50、最大 200）；Gateway 对投影结果再次截断；`scopeMode` 禁止 | 已修复并验证 |
| Spec | P2：Registry 的 TypeScript 文本不是可交付的脚本 API 声明 | 记录到 `Serpent-y51c.4`：生成独立 `serpent` API `.d.ts`，并以临时 `.serpent.ts` fixture 通过 `tsc` | 未在本范围实现 |
| Spec | P2：`maxPendingJobBatches` 不是未完成 Promise 的硬上限 | 原型日志明确限制语义；`Serpent-y51c.3` 保持 `in_progress`，进入生产 Runtime 前必须实现真实预算或经产品决策改成可证明的等效资源上限并补对抗测试 | 未关闭，阻断生产 Runtime |

## 可追溯证据

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 统一的只读能力接缝、能力边界与结果限制 | `src/automation/command-registry.ts`、`src/automation/command-gateway.ts` | `tests/unit/automation-command-gateway.test.ts` | 无用户界面；待 Console/MCP 实际接入 |
| Worker 只读分发不得回落为桌面写路径 | `src/worker/automation-readonly-dispatch.ts`、`src/worker/index.ts` | `tests/worker/automation-readonly-command-executor.test.ts` | 无 MCP 真实连接；Windows 未验证 |
| QuickJS 的语言、宿主能力和资源限制原型 | `src/scripting/quickjs-sandbox-prototype.ts` | `tests/unit/quickjs-sandbox-prototype.test.ts` | 仅开发态；未进 UtilityProcess，未打包/Windows 验证 |

## 本次验证

```bash
npm run typecheck
node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/unit/automation-command-gateway.test.ts tests/worker/automation-readonly-command-executor.test.ts
npx vitest run --config vitest.config.ts tests/unit/quickjs-sandbox-prototype.test.ts
npx eslint src/automation/command-registry.ts src/automation/command-gateway.ts src/main/automation-worker-adapter.ts src/main/worker-client.ts src/scripting/quickjs-sandbox-prototype.ts src/shared/protocol/requests.ts src/worker/automation-readonly-command-executor.ts src/worker/automation-readonly-dispatch.ts src/worker/index.ts tests/unit/automation-command-gateway.test.ts tests/unit/quickjs-sandbox-prototype.test.ts tests/worker/automation-readonly-command-executor.test.ts
git diff --check
```

结果：TypeScript 检查通过；Gateway/Worker 2 个文件 16 个测试通过；QuickJS 原型 1 个文件 10 个测试通过；ESLint 与 diff 检查通过。

## 不可省略的后续门槛

- `Serpent-y51c.3`：将脚本执行移入可杀掉的隔离进程，验证执行器异常退出不会影响 Main/Library Worker，并解决真实 pending-Promise 资源预算。
- `Serpent-y51c.6`：Execution journal、内容哈希绑定的授权、取消、脱敏日志和重启边界。
- `Serpent-y51c.4`：Desktop Console、保存脚本、独立 `.d.ts`、真实 Electron E2E 和人类验收项。
- `Serpent-y51c.5`：本地 stdio MCP 适配器及 Agent 真实连接回归。

因此，`Serpent-y51c.2` 可以关闭；Automation 平台 epic 与脚本沙箱门禁仍未完成。
