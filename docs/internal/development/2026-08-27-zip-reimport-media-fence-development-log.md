# 2026-08-27：从硬盘删除后再导入同一份 Serpent ZIP，全部卡片损坏

工单：`Serpent-e04fbc`。验收：`LIB-ZIP-001`。

## 现象

用户导出本机 Serpent 资源库 ZIP，从硬盘删除原库后再导入。导入进度条正常结束，磁盘上的 `Assets/`、缩略图 JPEG/PNG/WebP 和 `library.db` 都完好，但网格里**全部卡片**变成裂开图标。

这不是 ZIP 解坏了文件。对照 ZIP 与导入目录，抽样原图哈希一致，当前 revision 的缩略图 magic 也合法。

## 根因

`library.delete-from-disk` 会按 `libraryId` 拦住 `serpent://` 媒体读取，以便在 Worker `rm` 之前掐掉 Chromium 文件句柄（`Serpent-dfgg`）。成功删除后这个拦住**没有释放**。

Serpent ZIP 导入会保留导出库的 `library_id`。用户「删除 → 再导入同一份备份」时，新库仍是同一个 ID，于是每张卡片的 `serpent://preview` / `serpent://source` 都返回 **410 Library unavailable**。协议层对 410 不打 error 日志，看起来像「导入把内容弄坏了」。

同一会话里用户删除并导入了两次，第二次仍然全坏，符合「fence 泄漏」而不是解压损坏。

## 修复

删除请求无论成功、失败还是抛错，都在 `finally` 里结束媒体 fence。打开或导入资源库时再按 ID 释放一次，避免同进程里旧 fence 挡住重导入。

删除期间 fence 仍然有效：Worker `rm` 完成前不会重新打开句柄。

## 验证

- `npx vitest run --config vitest.config.ts tests/unit/library-media-reads.test.ts`：1 file / 5 passed（含「成功删除后必须释放 fence，同 ID ZIP 重导入才能出预览」）。
- 未跑 Electron E2E / Computer Use：当前环境没有桌面操控。现有进程里的 fence 是内存状态；用户需要**完全退出后再打开**导入后的库才能看到修复。磁盘文件本身完好，仅退出旧进程、不重新导入，预览也应恢复。
- 2026-08-27 用户 Windows 真机确认通过（删除后再导入同一 ZIP，卡片可解码）。LIB-ZIP-001 / LIB-011 记为人类验收通过。
