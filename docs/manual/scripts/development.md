# Desktop Console 脚本开发指南

本文面向在 Serpent Desktop 的“自动化脚本”Console 中编写实际脚本的开发者。脚本是一次性、受控的 JavaScript/TypeScript 批处理；它通过注入的 `serpent` 领域 API 调用 Automation Command Gateway，不是 Node 程序，也不是通用命令行。

API 版本：`AUTOMATION_API_VERSION = 1`。本文以当前 Console 实际注入的 `src/scripting/serpent-guest-api.ts`、Registry 和 E2E 行为为准。逐项签名见 [脚本 API 参考](api-reference.md)；编辑器类型提示见 [`docs/internal/skills/serpent-automation/automation-api.d.ts`](../../internal/skills/serpent-automation/automation-api.d.ts)。类型声明由 Registry 生成/校验，但个别 Registry 命令尚未投影到 Console，见“实现差异”。

## 先跑起来

打开资源库后，从“更多工具”→“自动化脚本”打开 Console。未打开资源库时，创建资源库面板不提供脚本入口；需要无库执行时，请使用 MCP 的未绑定会话。未绑定执行只能先调用 `serpent.library.create()`；创建成功后，Serpent 会绑定新资源库，后续命令才能访问它。

Console 运行的是脚本正文，最简单的入口是顶层 `return`：

```ts
const page = await serpent.assets.search({ query: 'tag:抽象', limit: 50 });
return { count: page.items.length, total: page.total };
```

脚本执行一次就是一个 Automation Execution。每次运行都是新的沙箱：上一次运行定义的函数、变量和 Promise 不会保留。需要辅助函数时，把函数和调用放在同一次运行中。

支持 `.serpent.js` 和 `.serpent.ts`。TypeScript 在受控运行时内转译为 ES2022；这是脚本正文，不是 ES module。不要写 `import`、`export`、动态 `import()`、`eval`、`Function` 或 `globalThis`。保存脚本只是保存源文本，不会把它变成插件，也不会获得额外权限。

## 可用全局与库绑定

脚本只应依赖以下环境：

- `serpent`：唯一的 Serpent 领域对象。其命名空间和方法见 API 参考。
- 标准 ES2022 语言能力：变量、条件、循环、函数、对象、数组、`Promise`、JSON、日期和数学等；具体可用性仍受隔离运行时限制。
- `console.log(value)`、`console.info(value)`、`console.warn(value)`、`console.error(value)`：写入本次运行的脚本输出，输出受总量限制。

没有 `require`、Node 内置模块、任意文件系统、网络、Shell、SQLite、环境变量、原始 IPC 或任意 UI/DOM。脚本不能读取脚本文件自身，也不能通过 `serpent` 取得资源库或链接文件夹的绝对路径。`assets.copyFilePaths()` 是受控例外：由 Main 把选定路径写入系统剪贴板，脚本只收到数量。

`serpent` 的调用会经过 Gateway 的 Registry、能力检查、输入/结果 Schema、执行日志和资源库范围检查。脚本不能传入 `executionId`、能力、授权、资源库路径或伪造计划证明；这些由宿主绑定。

## JS 与 TS 的写法

```js
const page = await serpent.assets.search({ query: 'name:rain', limit: 20 });
return page.items.map((asset) => asset.id);
```

```ts
const page = await serpent.assets.search({ query: 'name:rain', limit: 20 });
const ids: string[] = page.items.map((asset) => asset.id);
return { ids, hasMore: page.hasMore };
```

不要从脚本 `import` 类型。把 `automation-api.d.ts` 加到编辑器的类型根目录，或在脚本编辑器外用它做补全；运行时仍只接受注入的 `serpent`。

## 推荐工作流：读、核对、最小写入

1. 先用 `search`/`list` 查询并分页，确认目标 ID 和数量。
2. 读取需要写入的当前状态；元数据写入保存 `entityVersion`，文件内容写入保存 `currentRevisionId`。
3. 用最小批量执行写入，检查 `updatedCount`、`movedCount`、`skippedCount` 或逐项 `skipped`。
4. 文件类操作完成后在 Console 中使用“撤销自动化操作”复核；一次 execution 的可撤回 mutation 会由 Worker 组成一个 history group，宿主只消费一个 Worker 历史回执，脚本不能自行重放文件操作。
5. 对关键结果重新查询，或读取 `library.changeSequence()` 验证资源库已发生预期变化。

```ts
const page = await serpent.assets.search({ query: 'name:reference', limit: 200, offset: 0 });
const result = page.items.length === 0
  ? { updatedCount: 0, skipped: [] }
  : await serpent.assets.setRating(page.items.map((asset) => asset.id), 4);
return { matched: page.total, ...result };
```

## 分页、大结果和输出

列表/搜索接口返回统一页面：`{ items, total, offset, limit, hasMore }`。默认页大小是 50，单次最大 200；`offset` 是零基偏移。不要假设一次调用能读完整资源库，也不要把 `total` 当作当前页长度。

```ts
async function allSearch(query: string | null) {
  const items = [];
  for (let offset = 0; ; ) {
    const page = await serpent.assets.search({ query, limit: 200, offset });
    items.push(...page.items);
    if (!page.hasMore || page.items.length === 0) return items;
    offset += page.items.length;
  }
}
```

Console 的脚本源最多 64 KiB；脚本输出逐行收集，单行最多 16 KiB，总输出默认约 1 MiB，最终返回值也计入输出预算。输出超限会以 `OUTPUT_LIMIT` 失败。不要 `console.log` 整个资源库或把大文件内容直接返回；`asset.readContent()` 还会受 `maxBytes` 和内容预算限制。

## 搜索语法

`serpent.assets.search({ query })` 使用与工具栏相同的文本搜索语法；`query` 可为字符串或 `null`。`null` 表示当前资源库的非回收站资产。支持空格 AND、`|` OR、`-` 排除、引号短语和字段限定；UI 的 `name:` 会归一为 Registry 的 `filename` 字段。搜索是包含匹配，例如 `rain` 可能命中 `rainbow`，要更严格请使用更长 token 或多字段组合。

当前 Console 还接受 Registry 的结构化搜索对象，由宿主归一化；若没有明确需要，优先用字符串查询。搜索仍只返回分页资产摘要和可选摘要，不返回磁盘路径。

## 写操作、授权和计划确认

脚本启动时，Console 会按脚本内容、目标资源库和能力发起一次运行授权。未保存 Console 代码的授权是当前会话级；保存脚本可获得保存脚本级的重复授权，但改动源文本、目标库或能力后会重新确认。脚本不能自行提权。

脚本的 `history.undo` / `history.redo` 需要同时声明 `library.read` 和 `history.write`；只有读取权限的执行会在 Gateway 处稳定拒绝，Worker 不会执行逆向写入。`history.write` 与其他受控写能力一起受运行授权和 Worker 历史前置条件约束。

低风险元数据写入（评分、喜欢、标签、合集、空文件夹等）在运行授权后执行。资源库/文件生命周期和内容写入需要额外的本机计划确认，包括：

- `library.create`、`files.import`
- `assets.moveToFolder()`、重命名、移入回收站、恢复
- 替换或批量替换文件内容

计划摘要只显示目标数量、可执行/阻塞数量、冲突和是否可撤销，不把绝对路径交给脚本或输出。资源库变更序号、资产状态 token 和计划哈希绑定在 Main/Worker 侧；确认前后前提变化会使计划失效，操作不会继续写旧目标。取消确认会以取消/失败结果结束，文件不会因此被部分“暗中”执行。

文件移动、重命名、导入、回收站等可能返回内部 `operationId` 和宿主侧 `historyEntryId`。不要把 `operationId` 当作文件路径，也不要假设批量操作全成功；始终检查计数和跳过项。撤回/重做由 Worker 的统一历史栈执行，新的资源库写入会清空 redo 分支，前置条件冲突会将条目标记为 stale。

## 幂等、变更序号和长操作

当前脚本 Console 公开的 `library.create` 和 `files.import` 接受可选 `idempotencyKey`：非空白、最长 128 字符。调用超时后不要立刻用新参数/新 key 重提；先确认执行状态和资源库变化，再用同一命令、完全相同参数和同一 key 重试。参数变化会被拒绝，避免重复建库或重复导入。

`library.changeSequence()` 返回当前资源库变更序号。它是并发/复核用的观察点，不是锁，也不是事务快照。脚本不能把一连串命令包装成跨资源库事务；每个 Gateway 命令独立校验并记录。

当前 Console 没有脚本内的 `execution.status` API。停止按钮、关闭 Console/窗口会取消执行，并尝试完成本次 Worker history group；长时间调用的最终状态应在 Console 的结果和执行日志中确认。MCP 有额外的 `serpent_execution_status` 工具，但那是 MCP 传输面，不是脚本公共 API。

## 保存、打开和最近脚本

“保存脚本”只接受 `.serpent.js` 或 `.serpent.ts`，源文本上限 64 KiB。文件选择由 Main 完成；Console 只收到文件名、源文本和 Main 签发的临时句柄，不收到绝对路径。打开脚本、保存脚本和从最近脚本列表打开都走同一校验。

句柄绑定当前窗口、当前脚本源文本和当前保存内容。编辑文本后，旧句柄不能用来冒充已保存脚本以继承授权；窗口销毁时句柄也会释放。最近列表只保存可重新打开的文件名/句柄关系，不把路径交给脚本。

## 取消、超时和错误处理

运行器会限制 CPU 时间、墙钟时间、内存、并发 Host 调用、未完成 Promise 和输出。当前默认执行预算为：墙钟 60 秒、CPU 10 秒、内存 64 MiB、输出 1 MiB、最多 4 个并发 Gateway 调用、最多 128 个未完成 Promise；这些是宿主预算，不是脚本可调参数。

常见运行时错误码：`SOURCE_NOT_ALLOWED`、`SOURCE_TOO_LARGE`、`CPU_TIMEOUT`、`WALL_TIMEOUT`、`CANCELLED`、`MEMORY_LIMIT`、`OUTPUT_LIMIT`、`HOST_CALL_LIMIT`、`PROMISE_LIMIT`、`RUNTIME_ERROR`。Gateway 的业务错误会以公开错误对象/消息返回；内部授权、执行上下文和路径细节会被脱敏。

对可重试流程，先读取状态再重试；不要用 `try/catch` 把“计划被拒绝”“资源库忙”“版本冲突”吞掉后继续批量写。

## 调试与证据

- 先以只读查询验证输入；把 `return` 设为小型摘要，不要直接返回大数组。
- 使用 `console.log` 输出少量 ID、计数和状态；不要输出路径、凭据或原始二进制。
- 运行结果区域显示返回值与脚本输出；脚本错误包含运行时错误码，可能附带 guest stack。
- Console 可从本次运行打开诊断日志；执行记录包含 execution、命令计数、成功/失败摘要和关联 `logId`，日志会脱敏。
- 文件操作用实际 UI 状态和资源库内容复核；“计划存在”不等于写入成功。

## 脚本公共 API与插件 API的边界

插件运行时拥有另一套长期生命周期 API（如 `setup`、事件、Hook、Provider、插件 Job、输入捕获和插件存储）。这些来自 `plugin-guest-realm.ts`，不属于 Desktop Console 脚本公共 API；插件也不能用常驻脚本替代。

当前 Registry/类型声明还描述了 `execution.status`、`media.jobs.list`、`ai.jobs.status`、`ai.enqueue` 等命令，但 Desktop Console 的实际 `serpent` guest 投影当前未注入 `jobs` 或执行状态命名空间；不要在 Console 脚本中依赖 `serpent.jobs` 或 `serpent.execution`。类型声明的宽类型也不代表 Console 已提供稳定字段。

未承诺的能力包括通用 CLI、`serpent run`/`serpent repl`、任意 filesystem、SQLite、Shell、网络、MCP JSON-RPC 特有通知/资源引用、Desktop DOM/像素控制和永久删除。MCP 的 `serpent_desktop_*` 是附着 Desktop 的工具，不会出现在 Console 的 `serpent` 对象中。
