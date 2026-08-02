# 2026-08-01：脚本/MCP 读取 AI 分析结果

> 工单：`Serpent-b2qv.1`  
> 父 Epic：`Serpent-b2qv`  
> 状态：完成（保留供应商与平台验收边界）

## 目标

`ai.enqueue` 与 `ai.jobs.status` 已能让脚本/MCP 启动并等待 AI 分析，但原有自动化只
能读取人工 metadata，Agent 无法直接取得当前 AI 描述、AI 标签和建议评分。本增量
复用已有 Worker `ai.content.get`，把 AI 层结果通过统一 Automation Registry 暴露给
脚本与 MCP。

## 约束

- 只读 Action，不修改资产、人工 metadata、文件位置或资源库版本。
- 结果不包含资源库路径、文件路径、API Key 或原始供应商响应。
- AI 结果与 `assets.getMetadata()` 的人工层保持分离。
- 没有当前 AI 结果时返回稳定的空值，而不是把人工字段当作 AI 结果。

## 实现范围

- Registry 新增 `asset.ai-content.get` 与 MCP 工具
  `serpent_asset_ai_content_get`。
- QuickJS Console 新增 `serpent.assets.getAiContent(assetId)`。
- 自动化类型声明、Skill/使用说明和人类验收清单同步更新。
- 复用已有 Worker `ai.content.get`，不新增数据库表或 AI 供应商调用。

## 验证记录

- `npx vitest run tests/unit/automation-command-gateway.test.ts tests/unit/quickjs-sandbox-prototype.test.ts`
  ：56/56 通过；加入 MCP catalog 与 Gateway 路由后，三文件定向回归为 66/66 通过。
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/automation-readonly-command-executor.test.ts`
  ：5/5 通过；确认读取 AI 层不改变数据库字节。
- `node scripts/run-e2e.mjs tests/e2e/automation-mcp-library-create.test.ts`
  ：1 passed（7.2s）；真实 stdio MCP 列出并调用 `serpent_asset_ai_content_get`，无 AI
  结果时返回空值，结果不含临时路径。
- `npm run typecheck`：主 TypeScript 与扩展 TypeScript 通过。
- 定向 ESLint：通过；`git diff --check`：通过。
- 真实 AI 供应商、Computer Use、packaged 和 Windows 尚未执行。

## 人类验收

- `AUT-020` 已加入 `docs/qa/human-acceptance-checklist.md`，状态保持“待人类验收”。

## 后续边界

交叉分析确认：自动化 `ai.enqueue` 当前可完成入队，但 Gateway → Main 的
`AiQueueScheduler` 触发仍需独立接缝。该范围已拆为 `Serpent-b2qv.2`；在该工单
完成前，不把“入队后自动完成 AI 分析”写成已验证能力。
