# 2026-07-29：交互式脚本沙箱预览（Serpent-opwv）

> 状态：受限 Desktop Console 评分路径已实现，并已在隔离的真实 Electron 窗口完成一次端到端写入验证；macOS 当前锁屏，Computer Use 的独立视觉检查及产品负责人按 AUT-006 的人类验收仍待执行。
>
> 基线：`a160f60`（工作树增量，尚未提交）
>
> 规格边界：[0023 脚本化与 MCP 框架](../implementation/0023-automation-scripting-mcp-framework.md)。本切片目前只公开“搜索资产 + 批量评分”的最小可用 Desktop Console，不包含保存/打开脚本、完整只读 API、MCP 或其他写操作。

## 目标

让产品负责人能够在 Serpent 中输入 JS/TS，搜索当前资源库资产并批量设置评分，同时保留可终止的 Renderer Web Worker 沙箱。

## 严格边界

- 入口位于工作区工具的“更多”菜单，命名为“自动化脚本”。
- 脚本在渲染器 Web Worker 中运行；停止操作终止 Worker。它不会在 Main 或 Library Worker 中执行。
- 只注入 `serpent.assets.search({ query, limit?, offset? })` 与 `serpent.assets.setRating(assetIds, rating)`；搜索返回固定分页页（`items`、`total`、`offset`、`limit`、`hasMore`），不暴露任意 IPC、文件系统、网络、Node、SQL 或 MCP。
- 每次运行由 Main 创建绑定资源库、脚本哈希和 capability 的 Execution，显示一次明确的评分写入授权；命令经 Automation Gateway 和既有 `asset.rating.set` 有界写路径执行。脚本不保存，输出不持久化。
- 本切片不替代 `Serpent-y51c.3` 的 UtilityProcess 隔离、真实 pending-Promise 预算或打包平台门禁，也不解除 `Serpent-y51c.4/.5/.6` 的依赖。

## 测试接缝

将 Worker 生命周期抽成 Renderer controller，以 fake Worker 单测覆盖运行、成功、失败、停止与过期消息忽略；将 Worker 的真实请求处理抽为独立 runtime，以相同测试路径覆盖默认脚本、导入拒绝和源码大小拒绝。QuickJS 原型继续覆盖 TypeScript、资源限额、宿主能力与取消。`automation-script-rating.test.ts` 还会启动隔离 Electron、导入两项测试资产、打开实际 Console 并检查 Inspector 的 4 星结果。当前 macOS 会话锁屏，仍待用 Computer Use 完成独立视觉检查。

## 实现进展

- 新增 `ScriptSandboxPreviewDialog`：工作区“更多工具”入口、JS/TS 编辑区、结果/console 区、运行、停止、恢复示例、Escape 与 ⌘/Ctrl+Enter。默认示例按 `name:Ser | tag:Ser` 搜索，以 200 项分页、500 项批次完成 4 星评分。
- 新增 renderer Web Worker 和 controller：每次运行创建新 Worker；停止、关闭或下一次运行都会终止旧 Worker；过期消息不会覆盖新运行结果。
- QuickJS 原型的 UTF-8 字节计数从 Node `Buffer` 改为标准 `TextEncoder`，使同一引擎可在 Worker 中打包；源码在 UI、Worker runtime 与 QuickJS 转译前均限制为 64 KiB，避免 TypeScript 转译接受无界输入。
- 显示层以稳定错误码映射本地化提示，不把 Guest/Worker 的英文错误原样展示给中文用户；BigInt 与循环对象可安全用于结果大小核算和预览显示。
- Escape 纳入全局弹窗关闭栈；无论当前焦点是否仍在 textarea 内，都可终止并关闭预览窗口。
- Web Worker 的 host 请求先回到 Renderer controller，再经受限 preload IPC 回到 Main；Main 仅接受固定的 `asset.search`、`asset.rating.set`，校验 execution owner 后才交给 Gateway。完成、失败、取消均收口 Execution journal。
- `asset.rating.set` 的 descriptor 是 `metadata-write` / `execution` approval，MCP 仍不可公开调用；它不走只读 automation dispatch，而是复用 Worker 的 transaction-bound write lease。
- Renderer WebContents 销毁、应用重载或异常关闭时，Main 会取消其尚未完成的 Execution；这一收口与用户点击“停止/关闭”使用同一个 journal 取消信号。
- 文本搜索由 `shared/search-expression.ts` 统一解析；工具栏与脚本共享空格 AND、`|` OR、字段别名和引号语义。脚本只可传文本与分页参数，Main 才将其转换为结构化 Gateway 查询。
- 脚本终态（包括部分写入后的失败）只刷新一次当前浏览内容；选中资产的 metadata 通过 `applyLoadedMetadata` 同步缓存与 Inspector 编辑态，避免数据库已经写入但评分星标仍显示旧值。
- 新增隔离 Electron E2E：只在未打包应用同时设置 `SERPENT_E2E=1` 和 `SERPENT_E2E_AUTOMATION_CONFIRM=1` 时跳过不可由 Playwright 控制的原生授权框。该测试接缝不能在普通 `npm start` 或任何打包应用启用。

## 计划证据

| 需求 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 打开、运行、停止 Console | `App.tsx`、`ScriptSandboxPreviewDialog.tsx`、`script-sandbox-preview-default.ts`、`script-sandbox-preview-controller.ts`、`script-sandbox-preview.worker.ts` | `script-sandbox-preview-controller.test.ts`、`script-sandbox-preview-runtime.test.ts`、`automation-script-rating.test.ts` | 隔离 Electron 测试创建临时库、导入两项资源、只选择 `Ser-reference.png`、打开实际窗口并运行默认脚本，返回 `matched: 1` / `updatedCount: 1` 后确认 Inspector 显示 4 星。Computer Use 锁屏，视觉与原生授权框仍待 AUT-006。 |
| Main-owned 搜索与评分写入 | `automation-script-ipc.ts`、`shared/search-expression.ts`、`automation-execution-journal.ts`、`command-gateway.ts`、`automation-worker-adapter.ts`、`bounded-write-command.ts` | `automation-script-ipc.test.ts`、`search-expression.test.ts`、`automation-command-gateway.test.ts`、`batch-rating.test.ts`、`automation-script-rating.test.ts` | IPC 测试验证脚本文本 `name:Ser tag:y2k | author:Jane` 转为与工具栏相同的结构化查询；Worker 与 Electron E2E 都在临时库经有界写路径写入 4 星。E2E 的授权跳过只受测试专用、未打包环境变量保护。 |
| 无 Node/网络/任意 RPC | `quickjs-sandbox-prototype.ts`、`script-sandbox-preview-runtime.ts` | `quickjs-sandbox-prototype.test.ts`、`script-sandbox-preview-runtime.test.ts` | 仅固定 assets API 被注入；Computer Use 锁屏，新的 UI 文案/错误状态未人工检查。 |
| 转译前输入/结果稳定性 | `script-sandbox-limits.ts:8`、`quickjs-sandbox-prototype.ts:131`、`quickjs-sandbox-prototype.ts:176` | `quickjs-sandbox-prototype.test.ts:73`、`script-sandbox-preview-runtime.test.ts:20` | 64 KiB 和 BigInt 为自动化证据；没有将超大脚本粘贴到真实 UI。 |
| 弹窗键盘关闭 | `dialog-escape-stack.ts:88`、`use-dialog-escape-dismiss.ts:132` | `dialog-escape-stack.test.ts:127` | 当前 Desktop Console 的 Escape UI 仍待解锁后的 AUT-006；旧 echo-only 预览截图不作为此结论。 |

## 当前风险

Web Worker 能隔离和终止脚本计算，但仍属于应用 Renderer 进程；它不是最终的跨进程安全边界。当前用户脚本可读取搜索结果并写评分，但其他资源库能力仍未开放。每次运行会懒加载一份约 3.5 MB 的 QuickJS Worker（另有 WASM 资源）；这对最小 Console 可接受，但正式 Runtime 应另行优化加载与进程隔离。
