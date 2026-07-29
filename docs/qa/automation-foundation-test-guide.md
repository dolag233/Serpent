# Automation Foundation 测试说明（当前开发态）

> 适用范围：2026-07-28–29 的 Automation Command Gateway、QuickJS/WASM 脚本沙箱和受限 Desktop Console。
>
> 这不是最终的「脚本功能使用指南」。当前“自动化脚本”窗口已提供受限的真实能力：分页搜索/列出资产和文件夹、读取元数据、批量评分、将真实路径复制到剪贴板、移入回收站、单项或批量重命名、严格条件的回收站恢复，以及近期自动色卡汇总。完整示例见 [自动化脚本使用说明](../automation-scripting-guide.md)。它仍不提供保存/打开 `.serpent.ts`、独立发布的类型文件、任意资源库 API 或本地 MCP server。请不要尝试在终端或 Claude/Codex 中寻找 `serpent run`、`serpent repl` 或 `serpent-mcp`：通用 CLI 已撤回，MCP 启动器尚未实现。

相关规格：[0023 脚本化与 MCP 框架](../implementation/0023-automation-scripting-mcp-framework.md)、[ADR-0025](../adr/0025-automation-core-script-runtime-and-mcp.md)。代码审查结论见 [自动化基础审查](../reviews/2026-07-28-automation-foundation-code-review.md)。

## 这次应当如何测试

当前阶段是开发基础设施加受限 Desktop Console 验收。可验证的是：

- 旧的通用 CLI 已被移除；
- 13 个只读资源库命令只能通过统一 Gateway 分发；
- 调用者不能伪造资源库、来源或能力授权；
- 只读自动化请求不能回落到桌面写入路径；
- QuickJS 原型能够执行 TypeScript 和受限异步桥接，并拒绝 Node、文件系统、网络、导入、无限循环和资源滥用。
- 在应用中运行 `search` + `setRating` 的最小脚本，经过 Main-owned Execution、一次明确授权与有界评分写路径后，只修改当前资源库的匹配资产。

当前阶段**不能**验证：

- 保存/打开/复用脚本，或运行超出搜索和评分的真实资源库自动化；
- 让 Agent 通过 MCP 连接 Serpent；
- 完整的执行历史、授权审计 UI 或面向用户的脚本日志浏览；
- 打包后的 macOS/Windows 沙箱与 MCP 行为。

以上未实现项目不是测试失败；它们属于后续 `Serpent-y51c.3/.4/.5`。`Serpent-y51c.6` 的 Main-owned Execution journal 与授权基础已由本受限 Console 使用，但 MCP 仍没有用户入口。

## 准备环境

在本地 APFS/NTFS 工作副本根目录执行（不要从 SMB/NAS 运行 Electron）：

```bash
cd /Users/dolag/Development/Serpent
nvm use
npm ci --registry=https://registry.npmjs.org
```

预期 Node 版本为 `24.x`。若只做下列测试且依赖已经安装，可跳过 `npm ci`。

> Worker 测试必须走仓库提供的 Electron Vitest 包装器。直接用宿主 Node 运行 Worker 会因为 `better-sqlite3` 的 Electron ABI 与 Node ABI 不同而失败，这不是产品问题。

## AUT-001：确认没有恢复通用 CLI

执行：

```bash
test ! -d src/cli && test ! -f scripts/run-cli.mjs && echo "PASS: generic CLI is absent"
```

预期：只输出 `PASS: generic CLI is absent`，退出码为 0。

补充观察：可以运行 `npm start` 确认普通 Serpent 应用仍能启动。工作区工具的“更多工具”菜单中会出现“自动化脚本”；这是受限的开发态 Console，不是完整的脚本产品或 MCP 设置。

## AUT-002：Gateway 注册表与跨入口结果一致

执行：

```bash
node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/unit/automation-command-gateway.test.ts
```

预期：命令成功，`tests/unit/automation-command-gateway.test.ts` 全部通过。

该组验证的关键结果：

| 检查 | 预期 |
| --- | --- |
| 命令注册表 | 只有 13 个只读命令；没有 `tag.create` 等写命令 |
| API 契约 | 每项命令都带 API 版本、能力要求、JSON Schema 与 MCP 描述 |
| 分页 | 集合命令默认 50 条，最大 200 条，并返回 `items`、`total`、`offset`、`limit`、`hasMore` |
| 三个调用来源 | `desktop-console`、`script`、`mcp` 对同一注册命令得到同样的领域结果 |
| 授权 | 不具备所需能力、错误 API 版本或未知命令在派发前失败 |
| 资源库绑定 | 请求只能使用 Main 所持有的 `executionId` 上下文；附带伪造的 `context`、能力或资源库 ID 会失败 |

如需只运行“伪造 context 被拒绝”的一项：

```bash
node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/unit/automation-command-gateway.test.ts -t "uses only Main-owned execution state"
```

预期错误代码包括 `AUTOMATION_INVALID_REQUEST` 与 `AUTOMATION_EXECUTION_NOT_FOUND`；成功请求仍只会使用 Main 绑定的资源库。

## AUT-003：只读 Worker 分发不会写库

执行：

```bash
node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/automation-readonly-command-executor.test.ts
```

预期：3 个测试全部通过。

其中最重要的两项：

1. 带 `automation-readonly` 标记的 `tag.create` 被拒绝，且不会调用写入服务。
2. 测试会创建临时资源库，在 `tag.list` 前后计算 `.serpent/library.db` 哈希；两个哈希必须完全一致。

这证明的是当前自动化只读分发路径不会修改数据库；评分写入的独立证据见 AUT-006 及 `automation-script-rating.test.ts`，并不因此放宽其他写入命令。

## AUT-004：QuickJS 沙箱原型

执行：

```bash
npx vitest run --config vitest.config.ts tests/unit/quickjs-sandbox-prototype.test.ts
```

预期：15 个测试全部通过。

| 场景 | 预期结果 |
| --- | --- |
| TypeScript 与 `await serpent.readText()` | TypeScript 被转换并在 QuickJS 中执行，能返回异步桥接结果 |
| `process`、`require`、`node:fs`、`fetch` | 不可用，不泄露宿主 Node 能力 |
| 静态或动态 `import` | 预检拒绝或因没有 module loader 失败 |
| `while (true) {}` | 以 `CPU_TIMEOUT` 终止，下一次独立运行仍正常 |
| 持续分配内存 | 以 `MEMORY_LIMIT` 终止 |
| 过量 `console.log` | 以 `OUTPUT_LIMIT` 终止 |
| 并行 host 调用超过限制 | 以 `HOST_CALL_LIMIT` 终止 |
| Promise 微任务风暴 | 以 `PROMISE_LIMIT` 终止 |
| 永不 resolve 的 guest Promise 超过上限 | 以 `PROMISE_LIMIT` 终止；上限按真实 pending Promise 计算 |
| 大量已完成的 `Promise.resolve()` | 不应消耗未完成 Promise 额度 |
| 固定资产 API | `serpent.assets.search()` 返回只含资产卡片与分页信息的页面，`setRating()` 只能映射到对应 Gateway 命令；原型测试使用受控 Host，真实资源库接入由 AUT-006 的应用路径验证 |
| 永不返回的 host Promise | 以 `WALL_TIMEOUT` 或 `CANCELLED` 终止 |

可单独观察无限循环恢复性：

```bash
npx vitest run --config vitest.config.ts tests/unit/quickjs-sandbox-prototype.test.ts -t "interrupts an infinite loop"
```

注意：该原型当前在测试调用进程中运行。它尚不能证明“脚本执行器崩溃不会影响 Main/Library Worker”；生产接入前必须迁移到可终止的隔离进程。

## AUT-005：组合回归检查

需要一次性复验本阶段全部可运行测试时，按顺序执行：

```bash
npm run typecheck
node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/unit/automation-command-gateway.test.ts tests/worker/automation-readonly-command-executor.test.ts
npx vitest run --config vitest.config.ts tests/unit/quickjs-sandbox-prototype.test.ts
```

预期：

- `typecheck` 成功；
- Gateway + Worker 共 16 个测试通过；
- QuickJS 原型共 14 个测试通过。

这些是定向验证，不要求本次运行全量 `npm test`、Electron E2E 或打包测试。

## AUT-EXEC-001：Execution journal 与能力授权（开发者定向验证）

执行：

```bash
npx vitest run --config vitest.config.ts tests/unit/automation-execution-journal.test.ts tests/unit/automation-command-gateway.test.ts
```

预期：两个文件全部通过。

其中覆盖：

- Execution 会记录 `created → validating → awaiting-authorization/running → awaiting-approval → terminal` 状态；Desktop Console execution 必须先由 Main 的 Desktop/TTY 授予本会话能力，会话结束后不能继续使用。
- 保存脚本的 grant 只匹配相同脚本 SHA-256、目标资源库和完整能力集合；修改脚本、切库或新增能力都重新请求授权。
- MCP client 没有可伪造的 `actor` 输入，不能向自己授予能力；只有 Main Desktop/TTY 入口可以为一个 MCP 连接授予会话能力。
- 运行中的 execution 遇到应用重启会收口为 `AUTOMATION_INTERRUPTED_BY_RESTART`；journal 和日志不保存脚本正文或 API Key，路径形 library ID 与任意 session ID 会被拒绝。
- 每次 execution 会记录受限资源预算与 deadline。会话结束、手动取消或 deadline 超时会取消尚未开始的 Gateway 命令，并中止等待中的 Gateway 请求；`maxConcurrentCommands` 在 Gateway 按 execution 原子执行，超额请求不会触达 Worker。已经进入领域写入的收口语义仍由后续写租约/恢复切片负责。
- Gateway 会把命令成功/失败的数量记录在 execution history，同时不允许审计记录失败改变领域命令的结果；若 history 文件不可写，会单独写出带 execution/command ID 的应用日志诊断。

此项仍是开发者验证，不会在应用 UI 中显示。真实授权窗口、执行历史和日志定位留给正式 Desktop Console。

## AUT-006：受限自动化脚本（开发态手动测试）

先启动开发应用：

```bash
npm start
```

打开一个可写资源库后，点击工作区标题栏右侧的“更多工具”（`…`）按钮，再选择“自动化脚本”。该窗口必须绑定一个当前打开的资源库。

### 1. 默认脚本成功执行

保留预置代码并点击“运行”（或按 ⌘/Ctrl + Enter）：

```ts
const matchingIds = [];
let offset = 0;

while (true) {
  const page = await serpent.assets.search({ query: 'name:Ser | tag:Ser', limit: 200, offset });
  matchingIds.push(...page.items.map((asset) => asset.id));
  if (!page.hasMore || page.items.length === 0) break;
  offset += page.items.length;
}

const batches = [];
for (let index = 0; index < matchingIds.length; index += 500) {
  batches.push(await serpent.assets.setRating(matchingIds.slice(index, index + 500), 4));
}

const result = {
  matched: matchingIds.length,
  updatedCount: batches.reduce((count, batch) => count + batch.updatedCount, 0),
  skipped: batches.flatMap((batch) => batch.skipped),
};
console.log(result);
return result;
```

预期：点击运行后先出现“可读取资产并修改评分”的授权确认。确认后，脚本每页最多读取 200 项，以 500 项一批写入评分；结果显示 `matched`、`updatedCount` 和 `skipped`，所有匹配资产评分变为 4。取消确认时不应创建写入。真实文件操作还会出现与目标数量绑定的第二次计划确认；若资源库在确认后变化，执行必须拒绝过期计划。

`search()` 返回 `{ items, total, offset, limit, hasMore }`。可以使用循环继续请求下一页；`limit` 最大为 200。脚本只得到 `id`、`name` 和 `rating`，不会得到绝对路径或桌面内部搜索状态。

### 2. 验证没有宿主能力

替换为：

```ts
return {
  process: typeof process,
  require: typeof require,
  fetch: typeof fetch,
};
```

预期：三项均为 `"undefined"`。这证明预览脚本没有 Node、文件系统或网络能力。

再替换为：

```ts
return import('node:fs');
```

预期：结果区域显示 `SOURCE_NOT_ALLOWED`，而不是加载模块。

### 3. 验证限额与停止

无限循环：

```ts
while (true) {}
```

预期：短暂运行后显示 `CPU_TIMEOUT`，且 Serpent 主界面仍可继续操作。

手动停止可使用一条大结果循环前的搜索脚本，或在已运行的脚本等待 Gateway 响应期间点击“停止”。预期：窗口立即恢复“准备就绪”，不再继续请求；下一次运行默认脚本仍能成功。停止会取消对应的 Main Execution，不能留下继续可写的后台脚本。

```ts
const page = await serpent.assets.search({ query: 'name:Ser | tag:Ser', limit: 200, offset: 0 });
return page.items;
```

### 4. 窗口与键盘

- 用 Escape、右上角关闭按钮和点击遮罩分别关闭窗口；运行中的脚本应被终止。
- 用亮色与暗色主题各打开一次，确认代码区、结果区、错误信息和按钮文字清晰可读。
- 缩小应用窗口后，窗口应保持在视口内，代码区和结果区可滚动，不遮挡关闭或运行按钮。

该测试通过只证明当前受限 Desktop Console 的评分路径可用。文件回收、批量重命名、路径复制、严格恢复和色卡聚合的完整用法及附加验收步骤见 [自动化脚本使用说明](../automation-scripting-guide.md)；它不代表保存/打开脚本、MCP、UtilityProcess 隔离或安装包已经通过验收。

## AUT-WRITE-001：跨进程写入基础（开发者定向验证）

执行：

```bash
node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts \
  tests/worker/bounded-write-command.test.ts \
  tests/worker/library-write-coordinator.test.ts \
  tests/worker/library-service.test.ts \
  tests/worker/security-durability.test.ts \
  tests/worker/public-error.test.ts
```

预期：5 个文件、39 个测试通过。

该组验证两个独立 SQLite connection 对同一资源库的短写租约竞争、到期接管、旧 owner 拒绝续约、事务提交/回滚对应的持久 change sequence，以及 `asset.rating.set` 被 Worker 放入同一租约边界。竞争响应只能是稳定的 `LIBRARY_BUSY`，不得包含资源库路径或 SQLite 文本。

当前 Desktop Console 的评分脚本已经复用这条路径；MCP write tool、更多写命令、长任务 owner heartbeat/fencing 与跨进程变更订阅仍未实现。后续扩展不得直接访问 `LibraryService`。

## 反馈模板

若有失败，请按下面模板提交，能让后续定位直接复现：

```text
测试 ID：AUT-00x
系统与架构：macOS/Windows + arm64/x64
Node / Electron：
执行命令：
实际输出（从第一条 error 开始）：
是否使用现有 node_modules：是/否
是否在 SMB/NAS 路径运行：是/否
复现频率：每次 / 偶发
```

不要把 API key、用户资源库绝对路径、脚本中的密钥或整个 `serpent.log` 原样贴出；先脱敏后再反馈。

## 通过后的结论边界

若 AUT-001 至 AUT-005 全部通过，只能得出“Automation Gateway 与 QuickJS 原型在当前开发态通过定向技术验证”。它不代表脚本功能或 MCP 已可供最终用户使用，也不代表 macOS/Windows 安装包已验证。后续可面向用户测试的入口，会在 Desktop Console 与 stdio MCP 实际实现后另行补充到本文件和人类验收清单。
