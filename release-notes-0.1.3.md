**Serpent 0.1.3** — NAS 资源库、检查更新与一键更新、PDF 缩放与 Windows 文件复制 · NAS libraries, check-for-updates with one-click install, PDF zoom, and Windows file copy

## 新增功能 / New features

**NAS/网络共享资源库（实验性）**
- 支持在网络共享（NAS/SMB）上打开与创建资源库，自动使用回滚日志；文件锁与断线恢复取决于 NAS。同一时间请只让一个实例写入，并自行备份。

*Libraries on network shares (NAS/SMB) are now supported (experimental). Serpent uses rollback journaling there; file locking and disconnect recovery depend on the NAS. Keep a single writer at a time and keep your own backups.*

**支持检查更新并一键更新**
- 从 GitHub Release 检查、下载、取消更新，并显示进度；Windows 安装版与便携版走各自的安装/解压路径。

*Supports checking for updates and one-click update: check, download, and cancel updates from GitHub Releases, with progress in-app. Windows installed and portable builds follow their own install/extract paths.*

**PDF 查看器缩放与平移**
- 滚轮缩放锚定鼠标位置，可拖拽平移，缩放后文字与页面保持清晰。

*PDF viewer zoom and pan: wheel zoom anchors to the pointer, drag to pan, and pages stay sharp after zoom.*

**画布悬停播放音频**
- 鼠标悬停音频卡片即可在画布内播放，移开即停；视频悬停是否带声音可在设置中开关（默认静音）。

*Audio cards play in place on hover and stop when the pointer leaves. Video hover sound is optional in Settings (off by default).*

**查看器复制**
- 资产查看界面支持 Ctrl+C 复制；图片/视频等查看器右键菜单也可复制。

*Ctrl+C copies the current asset from the viewer; image/video context menus also expose Copy.*

**诊断日志按会话拆分**
- 每次启动写入独立日志文件，并自动清理过旧会话日志，不再无限追加到单一 `serpent.log`。

*Each launch writes its own session log; older session logs are pruned instead of appending forever to a single `serpent.log`.*

## 修复 / Fixes

- Windows 上 Ctrl+C 写入标准文件剪贴板，可粘贴到 PureRef、LocalSend、资源管理器等外部应用。
  *Windows Ctrl+C now writes a standard file drop list, so PureRef, LocalSend, Explorer, and similar apps can paste assets.*
- 原视频无法播放时，卡片悬停与查看器应改播已生成的代理，而不是一直使用失败的源。
  *When the original video cannot play, card hover and the viewer use a generated proxy instead of keeping the failed source.*
- 文件夹「递归显示」时不再画出子文件夹卡片，避免与已展开的子内容重复。
  *Recursive folder browse no longer shows child-folder cards on the canvas.*
- 大型资源库中递归合集浏览更快。
  *Recursive collection browsing is faster on large libraries.*

## 已知限制 / Known limitations

- NAS 资源库为实验性支持：文件锁与断线恢复取决于共享盘；同一资源库仅支持单实例写入，多机同时写暂不支持。
  *NAS libraries are experimental: locking and reconnect behavior depend on the share; a library supports a single writer — simultaneous multi-machine writing is not supported yet.*
