# 2026-09-20 开着的资源库主连接已被关闭

> 工单：`Serpent-1cf203`  
> 状态：实现完成，待人类验收  
> 分支：`dev`

## 现象

开发态实例里点「分析」约 0.1 秒就失败。同一时段预览、提取元数据、缩略图入队也抛 `TypeError: The database connection is not open`。Renderer 仍显示当前资源库，Worker 的 `openById` 也还挂着句柄，但 better-sqlite3 主连接已经 `close()`。

这不是 AI 入队缺 try/catch。任务在真正请求模型之前就失败了。同会话里还有 `openai_responses` + `qwen3-vl-plus` 的上游 400（`Unsupported model`），那是另一条配置问题，不会单独造成「库已打开、SQLite 已关」。

## 根因

网络库把同一个 SQLite 主连接包成两个 read-through 适配器（读缓存 + 写通道）。原先两个适配器的 `close()` 都会关掉 **同一个** primary。再叠加：

1. `openLibraryPrimary` 的 `catch` 对已经登记进 `openById` 的 primary 再 `closeIgnoringFailure`，map 里留下僵尸句柄。
2. `requireOpenLibrary` 只查 map，不查 `connection.open`。网络包装器还不转发 `open`，所以即使用 `.open` 去探包装器也探不到。
3. 同一目录身份、另一条路径的第二次 `library.open` 会再开一条可写连接并跑 migrate，然后因 `LIBRARY_ALREADY_OPEN` 关掉新连接——在 rollback journal 的网络盘上，这是对仍在使用的库再动一次写入生命周期。

不变量被打破：`openById` 有成员，并不等于主连接仍打开。之后所有走 `isExplicitlyIgnored` 的命令（分析入队、预览、元数据）都会在第一次 `prepare` 上秒失败。

## 修复

恢复「map 成员 ⇔ 主连接打开」：

- 写通道适配器 `ownsPrimary: false`；换代时 `release()` 只丢快照，不关 primary。
- 第二次打开同一目录前先只读探测 identity，不再对已打开的目录做可写 migrate。
- `catch` 若发现 connection 已是登记句柄的 primary，走 `closeLibrary` / 驱逐，而不是只关 SQLite。
- `requireOpenLibrary` 和对账 `assertReconciliationActive` 检查 primary 是否仍 open；已关则驱逐句柄并抛 `LIBRARY_NOT_OPEN`。
- Worker 把 better-sqlite3 的「connection is not open」归类为 `LIBRARY_NOT_OPEN`，避免再包装成笼统的分析失败。

## 命令

| 命令 | 结果 |
| --- | --- |
| `npx vitest run --config vitest.config.ts tests/unit/network-metadata-cache.test.ts tests/unit/protocol.test.ts` | 2 files / 133 passed |
| `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/network-metadata-cache.test.ts tests/worker/library-availability.test.ts` | 2 files / 24 passed |
| `npm run test:library-availability` | 9 files / 228 passed / 1 skipped |

未跑 `verify:mainline` / packaged / Computer Use。Electron E2E 未执行。

## 验收

清单 `LIB-OPEN-CONN-001`。自动化覆盖：写通道 close 不关 primary；关掉 primary 后浏览/分析入队得到 `LIBRARY_NOT_OPEN` 且 `listLibraries` 为空；同目录另一路径 `LIBRARY_ALREADY_OPEN` 后原句柄仍可列出资产。
