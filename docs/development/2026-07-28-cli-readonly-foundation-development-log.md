# CLI 只读基础层开发日志

> 日期：2026-07-28
> 工单：`Serpent-bb56.1`
> 状态：实现与自动化验证完成，待人类验收；独立安装包/Windows 未验证

## 本轮范围

- 新增 `serpent` 开发态入口、帮助、版本、健康检查和 `commands --json`。
- 资源库内命令强制显式 `--library <root>`。
- 只读支持：资源库检查；资产、文件夹、标签、合集、智能合集列表；资产搜索；媒体/AI 任务查询。
- stdout 只承载结果，stderr 承载错误；JSON 失败含稳定错误码与本地日志编号。
- CLI Worker 拒绝不在只读白名单内的命令。

写命令、跨进程写租约、变更序号、detached jobs 和双平台独立分发仍属于
`Serpent-bb56.2` / `Serpent-bb56.3`，本轮没有提前实现。

## 根因与架构决定

现有 `LibraryService.openLibrary()` 不是只读操作：它会迁移 schema、恢复文件操作和
任务、刷新文件、启动 watcher 并入队缩略图。因此 CLI 不能直接复用该入口后声称
“只读”。本轮新增 `openLibraryReadOnly()`：

- SQLite 以 `readonly + fileMustExist` 打开并启用 `query_only`；
- 只接受当前 schema，不做迁移；
- 不恢复任务、不刷新文件、不创建目录、不启动 watcher、不入队后台任务；
- 关闭只读会话时不取消或更新任何 job。

Desktop UtilityProcess 与 CLI 子进程共同调用
`read-only-command-executor.ts`，列表与搜索不复制业务 SQL。Desktop 仍通过 hook
保留可见资产缩略图调度；CLI 不触发该副作用。

`better-sqlite3` 使用 Electron ABI。直接用系统 Node 启动真实 CLI 会加载失败，因此
开发态 `scripts/run-cli.mjs` 使用 Electron 的 `ELECTRON_RUN_AS_NODE=1` 无窗口模式；
这不会创建 BrowserWindow，但与 Desktop Worker 共用相同原生运行时。独立分发时由
`Serpent-bb56.3` 提供平台启动器和安装布局。

搜索表达式解析器从 Renderer 移到 shared，Desktop 与 CLI 现在共同使用空格 AND、
`|` OR、排除词、引号和字段限定解析。

## 验证

| 需求 | 实现 | 自动化 | 人工/平台证据 |
| --- | --- | --- | --- |
| parser、显式资源库、稳定 ID/路径引用、机器描述 | `src/cli/argv.ts`、`src/shared/cli-command-registry.ts`、`src/shared/resource-reference.ts` | `tests/unit/cli-argv.test.ts` 5 项 | macOS 命令行冒烟 |
| 只读 Worker 与共享命令 | `src/worker/read-only-command-executor.ts`、`openLibraryReadOnly()` | `tests/worker/cli-readonly.test.ts` 3 项 | 真实资源库 inspect/list/tag/job |
| Desktop/CLI 共用搜索语义 | `src/shared/search-expression.ts` | 原 search-expression 7 项 + CLI 搜索集成 | 真实资源库命令可执行 |
| stdout/stderr、退出码、日志 | `src/cli/index.ts`、`src/main/app-logger.ts` | parser/错误路径覆盖；真实无效路径冒烟 | 无效路径返回 `LIBRARY_NOT_FOUND`、exit 3、logId |
| 不修改资源库数据 | SQLite readonly/query_only | 测试比较 `library.db` SHA-256 | 真实 158 项库执行前后 SHA-256 一致 |

当次命令：

```text
npx vitest run --config vitest.config.ts tests/unit/cli-argv.test.ts tests/unit/search-expression.test.ts
  2 files / 12 tests passed
node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/cli-readonly.test.ts
  1 file / 3 tests passed
npm run typecheck
  passed
npm run lint
  passed
npm run cli:build
  passed
npx vitest run ... protocol/app-logger/cli-argv/search-expression
  4 files / 81 tests passed
node scripts/run-vitest-with-electron.mjs run ... cli-readonly/security-durability
  2 files / 11 tests passed
```

仓库全量 `npm run test:unit` 运行了 194 个文件、1523 passed / 1 skipped，但因本机
`node_modules` 缺少 package.json 已声明的 `happy-dom`，Vitest 另报 1 个 worker
启动错误；这不记为全量绿灯。未运行 Electron GUI E2E：本轮没有 Renderer UI，
真实 CLI/Worker 冒烟提供更直接证据。

`npm run test:worker` 也已启动扩大回归；它进入 20k 资产 soak，并复现项目状态已记录
的 4 个 known-red（导出缩略图 artifact、缩略图队列、两条回收站冲突恢复）。测试
包装器在 soak 尚未结束时提前交还控制权，未取得可接受的最终摘要，因此不记为完整
Worker 套件通过；本轮相关的 CLI、安全与协议定向集合均已独立通过。

## 人类验收

新增 `CLI-001`、`CLI-002`。macOS 源码态可验；Windows 与 packaged/独立 CLI
继续标记未验证，不能据此宣称 0011 完成。
