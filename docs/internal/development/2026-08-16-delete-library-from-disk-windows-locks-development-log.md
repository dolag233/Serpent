# 2026-08-16 Windows 从硬盘删除资源库占用失败（Serpent-dfgg）

## 现象

用户点名 P0：菜单「从硬盘删除资源库」报「Serpent 无法写入所选位置。原因：文件正被其他应用使用，请关闭后重试」以及其它错误。

`%AppData%\Roaming\Serpent\logs\serpent.log`（2026-08-16 13:50 UTC / 21:50 CST）：

1. `serpent-external-library-L3PhxI`：`rmSync` → `EPERM` → `LIBRARY_NOT_WRITABLE` / `FILE_BUSY`
2. `示例资源库 B`：`rmSync` → `ENOTEMPTY` → `LIBRARY_NOT_WRITABLE`（无 FILE_BUSY 原因）
3. 随后 Worker 已 `closeLibrary`，半删树 `openLibrary` 失败 `NOT_A_LIBRARY`
4. 渲染进程仍挂着 `serpent://preview/...`，刷大量 `ASSET_NOT_FOUND`

同一路径在 2026-08-15 的两个隔离测试库上也出现过。

## 根因

`deleteLibraryFromDisk` 在 `closeLibrary` 后立刻 `rmSync`，没有：

- 等 ffmpeg/sharp 任务放下文件
- 等 Chromium 卸掉网格缩略图（`serpent://` 在 Main 里 `createReadStream`）
- 等 `fs.watch` / SQLite WAL 句柄释放
- 对 Windows 的 EPERM/ENOTEMPTY 做重试

一次失败就会留下半删目录；reopen 失败后 UI 仍当库开着，错误看起来「各种报错」。

## 修复

- Renderer：确认删除前 `flushSync` 清空资产卡/选择/悬停预览并等一帧（Windows 再等 120ms），让 Chromium 放句柄
- Main：确认后立刻 `blockLibraryMediaReads`，中止该库全部 `serpent://` 读流，并拒绝新的缩略图请求
- Worker：`drainLibraryMedia` 中止并等待媒体任务；关闭前 `wal_checkpoint(TRUNCATE)`
- `removeLibraryRootWithRetry`：EPERM/EBUSY/ENOTEMPTY 重试，仍失败则把根目录改名旁路
- 半删且无法 reopen 时返回 `LIBRARY_NOT_FOUND`，UI 关闭而不是继续刷缩略图
- Windows `ENOTEMPTY` 映射为 `FILE_BUSY`

## 验证

- `npx vitest run --config vitest.config.ts tests/unit/windows-fs-retry.test.ts tests/unit/library-media-reads.test.ts tests/unit/protocol.test.ts`：3 files / 107 passed
- `npm run typecheck`：通过
- `npm run test:library-availability`：9 files / 188 passed / 1 skipped
