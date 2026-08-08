# 2026-07-28：Automation Registry 与只读 Gateway（Serpent-y51c.2）

> 状态：实现完成；后续 Script Runtime、MCP 和授权切片将复用该接缝。

## 目标

在不恢复通用 CLI 的前提下，为 Desktop Console、受控脚本和 MCP 建立唯一的只读领域命令接缝。自动化调用必须使用已有 Library Worker 协议，且查询不得因为桌面缩略图调度等副作用写入资源库。

## 实现

- 新增 `src/automation/command-registry.ts`：注册 13 个只读 Automation Command，统一定义输入/结果 Zod Schema、API 版本、能力、影响等级、批准策略、原子性、MCP 工具元数据与 Worker 映射。
- 新增 `src/automation/command-gateway.ts`：验证命令信封、显式资源库绑定、来源、能力和输入；只通过窄化的 `AutomationWorkerClient` 调用 Worker；保留 Worker 的 `PublicError`，拒绝不匹配的结果。
- 新增 Main 到 Worker 的 `automation-readonly` dispatch。桌面现有请求不带此标记，行为不变；标记请求由 `automation-readonly-command-executor` 处理，不调度缩略图、不入队任务、不启动 watcher，也不允许写命令回落到普通桌面分发。
- Registry 可生成 JSON-safe 命令描述与供后续脚本打包使用的 TypeScript 声明文本。没有新增 argv、终端入口、CLI 脚本或 `src/cli` 文件。

## 覆盖的只读命令

`library.inspect`、`folder.list`、`linked-folder.list`、`asset.list`、`asset.metadata.get`、`asset.extracted-metadata.get`、`asset.search`、`tag.list`、`collection.list`、`collection.assets.memberships`、`smart-collection.list`、`media.jobs.list`、`ai.jobs.status`。

## 独立审查返工（P1 / P2）

- 所有返回集合的公开自动化命令现在都使用 `limit` / `offset`，默认 50、最大 200，并统一返回 `items`、`total`、`offset`、`limit`、`hasMore`。Gateway 在投影结果时再次截断，故即使 Worker 返回异常的大集合，公开结果也不超过 200 项；Registry 的 `mcp.outputLimit` 与该硬上限一致，不再只是说明文字。
- 资产列表/搜索中的序列图只返回 `sequenceId`、帧率与帧数，不把可能极大的逐帧数组塞进一页结果；逐帧详情留给后续单项读取命令。
- `asset.search` 不再接受 `scopeMode`，Gateway 始终向 Worker 传 `scopeMode: false`；它不能绕开分页加载完整浏览范围。
- 公共命令信封移除调用方可伪造的 `context`。它现在只含 API 版本、`executionId`、命令 ID 与输入；Gateway 经注入的 Main-owned `AutomationExecutionResolver` 取得资源库、来源与能力。未知 execution、附带 `context`、自授能力或自行切库都会被拒绝。
- 将 `automation-readonly` 的实际 Worker 路由抽为内部 fail-closed dispatch。带标记的写命令不会再落入桌面 Worker switch；定向测试断言 `tag.create` 不调用服务写方法且返回安全失败。

## 自动化证据

- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/unit/automation-command-gateway.test.ts tests/worker/automation-readonly-command-executor.test.ts`：返工后 2 files、16 tests 通过。
- `npx eslint src/automation/command-registry.ts src/automation/command-gateway.ts src/main/automation-worker-adapter.ts src/worker/automation-readonly-command-executor.ts tests/unit/automation-command-gateway.test.ts tests/worker/automation-readonly-command-executor.test.ts`：通过。
- `npm run typecheck`：通过。
- `git diff --check`：通过。

直接使用宿主 Node 运行 Worker fixture 会因 `better-sqlite3` 的 Electron ABI（148）与宿主 Node ABI（137）不同而失败；按仓库约定使用 Electron Node 测试脚本即可通过，该差异不属于产品行为失败。

## 四列可追溯

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 统一 Registry、JSON Schema 与声明生成 | `src/automation/command-registry.ts` | `automation-command-gateway.test.ts` Registry case | 不涉及用户可见 UI；待 Console/MCP 切片验证 |
| Gateway 的资源库/能力/来源/错误边界 | `src/automation/command-gateway.ts` | `automation-command-gateway.test.ts` Gateway cases | 不涉及用户可见 UI；待 Console/MCP 切片验证 |
| 查询不会进入桌面副作用路径 | `src/main/automation-worker-adapter.ts`、`src/worker/automation-readonly-command-executor.ts`、`src/worker/index.ts` | `automation-command-gateway.test.ts` adapter case、`automation-readonly-command-executor.test.ts` | Headless MCP 实际连接待 Serpent-y51c.5；未宣称 Windows 验证 |
