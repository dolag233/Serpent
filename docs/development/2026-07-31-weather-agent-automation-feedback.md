# 2026-07-31：天气图片 Agent 自动化反馈吸收

> 来源：Agent 通过 headless MCP 执行「天气图片建库 / 分类」旅程后的问题清单与产品归纳。  
> 状态：已吸收进文档、部分即时修复与 beads；大项延后按优先级实施。

## 即时修复（本轮）

| 反馈 | 处理 |
|------|------|
| `scripts/run-mcp.mjs` 含 `usage(): never` 导致 Node 语法错误 | 去掉 TypeScript 注解；`node --check` 通过 |
| 文档/脚本宣称字符串搜索，MCP Registry 要结构化 | MCP `call-tool` 对 `asset.search` 复用 Console 的字符串→AST 归一；guide/Skill 写明两种形态与 `name`→`filename` |
| `serpent_library_inspect` 泄露 `libraryPath` | `library.inspect` 投影仅 `{ libraryId, displayName }`，与 guide 一致 |

## 工单

| ID | 优先级 | 主题 |
|----|--------|------|
| `Serpent-b2qv` | P1 epic | AI 辅助导入与分类（统一产品需求） |
| `Serpent-7v2i` | P1（**已关闭**） | `file.move` 计划确认移动到文件夹 |
| `Serpent-rvw3` | P1（延后至主线） | 导入后序列自动折叠与文件/资产/序列计数语义；不纳入当前自动化分支 |
| `Serpent-3d32` | P1 | MCP 写超时 / 状态查询 / 幂等（Slice A：`execution.status` + 超时对齐已落地；Slice B 幂等键仍 open） |
| `Serpent-54gs` | P2（已关） | AI 辅助分类流程已写入 Skill/guide |
| `Serpent-lq5y` | P3 | Desktop 附着 MCP / 可见执行（可发现性与安心观察） |

## 反馈条目对照

1. run-mcp.mjs TS 语法 — **已修**
2. 搜索接口不一致 — **归一 + 文档**；结构化仍合法
3. MCP 未出现在工具目录 — 归属 `Serpent-lq5y`（附着/可发现）；当前仍须手动 `npm run mcp`
4–5. 确认与超时竞态 / 导入结果误导 — P1 超时与状态查询工单
6 / 序列产品项 — P1 序列显式工单（与 `expandImageSequences` 语义拆开说明）
7 / 文件夹移动缺口 — P1 `file.move` 工单
8. 搜索字段 `name` vs `filename`、子串匹配 — 文档/Skill 已写；更严匹配语义可并入搜索打磨
9. inspect 路径脱敏 — **已修**
10. 天气视觉验收偏弱 — 属样本/验收方法，不单开产品工单；验收应用稳定来源图集或内容抽检

## 统一产品需求（epic 范围）

- 导入阶段保留文件级准确性；结果区分文件数 / 资产数 / 序列数 / 分类数。
- 序列识别必须显式确认（或默认关闭自动折叠）。
- AI 负责理解与建议；标签、合集、文件夹职责分离。
- 文件移动属高风险，单独计划确认。
- 自动化不得把「创建空分类文件夹」误报为「已完成文件夹分类」。

## rvw3 处理记录（2026-07-31）

- 本轮误将序列行为变更带入自动化分支，现已回退；既有序列识别、导入确认和播放行为保持不变。
- `Serpent-rvw3` 留待主线重新澄清和实施，当前分支不提供 `groupImageSequences` 或“默认一图一资产”语义。

## Serpent-3d32 Slice A（2026-07-31）

- Registry 新增只读 `execution.status`（MCP `serpent_execution_status`）：经 Gateway `executionStatusHandler` 读取 Journal 投影，拒绝跨会话 `executionId` 窥探，结果不含路径。
- MCP 会话 `source: mcp` 创建时墙钟上限 30 分钟；`library.create` / `automation.file-*-plan` Worker 请求超时对齐为 5 分钟。
- 文档与 Skill 补充：客户端超时 + `serpent_execution_status` 轮询；幂等键留 Slice B。

## Serpent-3d32 Slice B（2026-07-31）

- `library.create` 与 `file.import` 的命令输入支持非空白、最长 128 字符的可选 `idempotencyKey`，Registry descriptor 宣布 `supportsIdempotencyKey: true`。
- Gateway 在单次 Automation Execution 内以 `(executionId, commandId, idempotencyKey)` 索引内存中的进行中/成功结果；相同 key 与参数复用结果，不重复派发 Worker；相同 key 改变参数返回稳定的 `AUTOMATION_INVALID_REQUEST`。
- 客户端超时处理已写入 guide/Skill：先轮询 `serpent_execution_status`，重试时沿用同一 key 和原始参数。`npx vitest run tests/unit/automation-command-gateway.test.ts tests/unit/serpent-mcp-adapter.test.ts` 通过（46/46）；`npm run typecheck` 通过（主 TypeScript 与 extension TypeScript）。
