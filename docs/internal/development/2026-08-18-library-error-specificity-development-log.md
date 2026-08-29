# 2026-08-18 资源库错误必须写清原因与解法

> 关联：`Serpent-n5iu`、`Serpent-4f44f1`、[0004 错误文案原则](../ui/0004-calm-error-and-copy-ux-principles.md)、验收 `ERROR-LIB-001` / `TOAST-003`

## 产品约束

用户明确：只说「xx 无法完成」「xx 无法打开」对排障没有帮助。错误正文必须同时给出**原因**和**解决方法**。资源库相关失败最多，且已有真实反馈（同步库磁盘满被折成 INTERNAL_ERROR；NAS 上 Eagle 转换被折成「无法写入所选位置」）。

## 实现

- 更新 0004：正文强制「原因 + 解法」；禁止把「无法完成这项操作 / 请查看日志」当完整错误。
- `classifyUnknownFailure`：按 SQLite/errno 分类，**不复制** `Error.message`（避免泄漏路径）。
  - `SQLITE_IOERR*` → `LIBRARY_NETWORK_SHARE`（NAS/SMB 不支持 SQLite 文件锁）
  - `SQLITE_BUSY` / `database is locked` → `LIBRARY_BUSY`
  - `SQLITE_CANTOPEN*` → `LIBRARY_NOT_WRITABLE` + `IO_ERROR`
  - `SQLITE_CORRUPT` / `NOTADB` → `LIBRARY_CORRUPT`
  - `ENOSPC` / `EDQUOT` / `SQLITE_FULL` → `DISK_FULL`
  - 未知错误若有 errno，保留 `INTERNAL_ERROR` 并附带 `PERMISSION_DENIED` 等 reason
- `serviceError` 在套上 `LIBRARY_NOT_WRITABLE` 等 fallback 之前先走上述分类，避免 NAS IOERR 被说成「无法写入」。
- WebDAV：`HTTP_*` → `SYNC_HTTP_ERROR`；`DriverUnsupportedError` → `SYNC_METHOD_NOT_ALLOWED`。
- 重写资源库相关 `PUBLIC_ERROR_MESSAGES` 与 zh-CN/en `error.code` / toast 兜底文案。

## 测试

定向：

```bash
npx vitest run tests/worker/public-error.test.ts tests/unit/protocol.test.ts tests/worker/automation-readonly-command-executor.test.ts tests/unit/webdav-url-normalize.test.ts
```

资源库可用性（改了 library-service `serviceError` 与 public-error）：

```bash
npm run test:library-availability
```

## 补充：INTERNAL_ERROR 兜底点核查与日志补全（2026-08-18 第二轮）

按验收口径第 4 条（INTERNAL_ERROR 只允许出现在「真正不可归类」路径且必须有 error 级日志）逐条核查：

- `src/main/index.ts`（17 处）：全部为 OS 层操作失败（`shell.openPath` / `open-with` / reveal / 剪贴板写入）或 sender 校验失败——属于不可归类路径。为「真正不可归类」且此前**缺失日志**的 4 处补上 `logger?.error`：`main.open-external`、`main.copy-asset-files`（写入后无文件列表）、`main.open-folder-in-file-manager`、`main.copy-folder-files`。其余 catch 分支原本已有日志。
- `src/main/automation-script-ipc.ts`：为两处真实基础设施失败补日志——`automation.script.gateway-unavailable`（命令行网关缺失）、`automation.script.resolve-failed`（按 id 解析已存脚本失败）。sender/ownership 安全守卫保持静默（有意避免噪音与信息泄露）。
- `src/worker/library-service.ts` 4 处裸 INTERNAL_ERROR（15619/17032 为 closed-union 不可达 default，19491/19586 为协议已校验的字节边界防御）：均不可达，且由 worker 顶层 catch（`src/worker/index.ts:3595`）统一 `console.error` 记错误日志，满足验收口径。
- `src/worker/automation-readonly-dispatch.ts:19` 与 `src/shared/automation-host-command-error.ts:102`：失败关闭的守卫兜底，不可归类，由调用链上层日志覆盖。

## 未执行

NAS 真机、Computer Use、packaged、完整 `verify:mainline`。其余 toast「X 失败」键尚未逐条改写，下一轮继续。
