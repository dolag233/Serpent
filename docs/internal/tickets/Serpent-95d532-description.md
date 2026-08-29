用户反馈（2026-08-20）：在 Windows 上从一个资源库切换到另一个资源库后，前一个资源库的 `library.db` 仍被 Serpent 进程占用，无法在资源管理器中删除/移动该资源库目录，或外部工具仍报文件被占用。

## 预期

- 切换资源库（菜单打开另一库、起始页换库等标准切库路径）后，旧库的 SQLite 连接应关闭，`library.db` 及 WAL 不再被占用。
- 本单聚焦「切库未释放」；完整退出应用后的释放可作为对照复现。

## 复现线索

- 平台：Windows
- 操作：打开资源库 A → 再打开/切换到资源库 B
- 现象：A 的 `library.db` 仍被 Serpent 进程锁定

## 调查方向

- Library Worker 切库/关闭时是否 `close` better-sqlite3、WAL checkpoint、中止 `serpent://` 读流与媒体任务
- Main 是否在切库时销毁旧 UtilityProcess 或等待 Worker 释放句柄
- 是否与缩略图/预览仍引用旧库媒体、Windows 文件锁语义（EBUSY/EPERM）有关

## 关联

- 资源库生命周期、切库 E2E（`tests/e2e/library-recent.test.ts`）
- `Serpent-dfgg`：Windows「从硬盘删除资源库」EPERM，侧重删库路径；本单为切库后句柄未释
