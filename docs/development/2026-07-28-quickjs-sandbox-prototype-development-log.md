# 2026-07-28：QuickJS/WASM 脚本沙箱原型门禁

## 目标与范围

`Serpent-y51c.3` 验证 [0023](../implementation/0023-automation-scripting-mcp-framework.md) 所需的运行时候选，不实现面向用户的 Console、保存脚本、CLI、Gateway 或 MCP 工具。此前撤回的通用 CLI 没有被恢复。

原型使用 `quickjs-emscripten@0.32.0` 的独立 `newQuickJSWASMModule()`：每次调用创建一个新的 WebAssembly 模块和一个新的 QuickJS runtime/context。开发态预览只注入测试性质的异步 `serpent.readText()` 与限额 `console.log()`；Runtime 接缝额外验证两个固定的领域方法 `serpent.assets.search()` 和 `serpent.assets.setRating()`。它们只能映射到 `asset.search`、`asset.rating.set`，不能成为任意 IPC/RPC、文件系统、网络或 SQL 通道。

## 已验证的引擎边界

| 门禁 | 实现位置 | 自动化证据 | 结论 |
| --- | --- | --- | --- |
| TS 转换后真实执行 | `src/scripting/quickjs-sandbox-prototype.ts` 的 `transpileQuickJsSandboxPrototypeSource` | `quickjs-sandbox-prototype.test.ts` 的首项用 `const message: string`、`await` 与返回值 | 已验证；不是只检查转换文本，转换后的 JS 已在 QuickJS 中执行。 |
| 宿主能力最小化 | 同文件仅创建 `serpent.readText`、`console.log` | 测试断言 `process`、`require`、`process.env`、`node:fs`、`fetch` 和 `Function` 逃逸均不可用 | 已验证为该注入面；不等同于完整产品 API 的安全审计。 |
| 模块加载和动态构造关闭 | 不调用 QuickJS `setModuleLoader`；TS AST 预检拒绝 import、`eval` 与 `Function` | 静态/直接动态 import、`eval(...)` 与 `Function(...)` 都在执行前以 `SOURCE_NOT_ALLOWED` 拒绝 | 已验证为当前语法边界。 |
| CPU/栈/内存 | `setInterruptHandler`、`setMaxStackSize`、`setMemoryLimit` | 无限循环得到 `CPU_TIMEOUT`；持续分配得到 `MEMORY_LIMIT` | 已验证。 |
| Promise/异步桥接 | QuickJS deferred promise、受限 job pump 和 `getPromiseState` 跟踪器 | async host bridge 成功；微任务风暴受 `maxPendingJobBatches` 限制；超过 `maxPendingGuestPromises` 的真实未完成 Promise 得到 `PROMISE_LIMIT`；已完成 `Promise.resolve()` 不占用该预算；未完成 host promise 受墙钟限制 | 已验证。QuickJS 不提供队列长度，故 job batch 仍是独立的进度上限；但 guest 生成 Promise 的未完成数量已有单独硬上限。 |
| 固定自动化 API 映射 | `serpent.assets.search` / `setRating` 仅在 host 提供 Gateway 回调时创建 | 测试运行“搜索 `Ser` → 映射返回的 `id` → 批量评分 4”的同一段脚本，断言只能产生 `asset.search`、`asset.rating.set` 两个结构化 host 请求 | 已验证为运行时内核映射；尚未挂到 Desktop Console。 |
| 输出/并发 host 调用 | `console.log` 字节计数、`maxPendingHostCalls` | 超量输出得到 `OUTPUT_LIMIT`；两个并行 host call 在上限为 1 时得到 `HOST_CALL_LIMIT` | 已验证。 |
| 取消 | `AbortSignal` 和 QuickJS interrupt handler | 等待 host promise 时 abort 得到 `CANCELLED` | 已验证为协作取消。 |
| 引擎实例恢复 | 每次运行重建 WASM/runtime/context | 无限循环或墙钟超时之后，下一次运行仍可正常返回 | 已验证为实例级恢复。 |

执行命令：

```bash
npx vitest run --config vitest.config.ts tests/unit/quickjs-sandbox-prototype.test.ts
npx eslint src/scripting/quickjs-sandbox-prototype.ts tests/unit/quickjs-sandbox-prototype.test.ts
```

结果（2026-07-29 更新）：14 个原型对抗测试通过；`npm run typecheck`、`npm run lint -- --quiet` 与 `git diff --check` 通过。

### 未完成 Promise 的硬上限实现说明

`maxPendingGuestPromises` 默认值为 64。每次由脚本可见的 `Promise` 构造、静态方法、`.then()` 结果或 async 函数返回值，都会先由宿主侧跟踪器调用 QuickJS 的 `getPromiseState()`：已经 fulfilled/rejected 的值立刻释放；pending 值保留一个独立 handle，挂接一次性 settle 回调，并计入上限。回调在 QuickJS job batch 结束后才释放自身 handle，因此不会在 VM 正执行它时使句柄失效。

这比旧的 job-batch 计数更准确：它不会把同步完成的 `Promise.resolve()` 误判为积压，也不会因为脚本不断创建“没有微任务”的 pending Promise 而绕过限制。测试分别覆盖五个永不 resolve 的 Promise 在上限四时失败、100 个同步 resolved Promise 在上限一时成功、并发 async 调用失败和顺序 async 调用释放额度后成功。

## 打包与平台事实

- 依赖是生产依赖（非 native addon），npm 包声明 Node `>=16`，当前 Node 24 开发环境满足。
- 该依赖的 release 变体带独立 `.wasm` 文件；Forge 当前会复制生产 `node_modules`，但尚未把本模块接入 Main/UtilityProcess entry，也没有运行 macOS packaged 或 Windows 实机包。
- 因而**不能**把“开发态 Vitest 能加载 WASM”写成“安装包已验证”。`Serpent-y51c.10` 必须在真正的 Script Runtime 接入后验证：ASAR 内 WASM 解析、macOS arm64 安装包，以及 Windows x64 安装包。

## 尚未成为生产运行时的部分

1. 原型目前运行在调用者进程；它证明 QuickJS 的语言/资源边界，**不**满足“执行器崩溃绝不带走 Main/Library Worker”的进程隔离要求。`Serpent-y51c.4` 必须把它放进可强制终止的 UtilityProcess 或等价隔离执行器，并为执行器异常退出建立 IPC 对账测试。
2. QuickJS interrupt 能中断正在运行的 guest CPU；但若 host JS 主线程被同步 guest 执行占住，外部 `AbortSignal` 不能在那一刻被事件循环递送。这进一步说明不能在 Main 或 Worker 内直接运行它。
3. 当前 TypeScript 使用 `transpileModule`，因此已验证类型擦除与 ES2022 输出执行；尚未提供保存脚本的 `export default async function` 包装、类型声明、source map 栈回映或 API 版本协商。
4. `readText` 是原型桥，不经过 Zod、授权、Execution journal、AppLogger 或 Automation Gateway；后续不得把它扩大为任意 RPC。
5. 内存、CPU、输出、未完成 Promise 与 job-batch 默认值只为守住原型；需要以真实资产库、长结果和 Desktop Console 体验基准校准，不能直接宣布为产品默认值。

## 决策

QuickJS/WASM 保留为 `Serpent-y51c.4` 的默认候选，而非最终锁定的生产依赖。它通过了本工单要求的引擎层对抗门禁，且没有使用 `node:vm`；是否正式采用取决于隔离执行器、真实 Gateway RPC、日志/授权、macOS packaged 和 Windows packaged 的后续证据。
