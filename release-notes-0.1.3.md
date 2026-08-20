**Serpent 0.1.3** — NAS 资源库支持、GitHub Release 自动更新与视频代理播放 · NAS library support, GitHub Release auto-update, and video proxy playback

## 新增功能 / New features

**NAS/网络共享资源库（实验性）**
- 支持在网络共享（NAS/SMB）上打开与创建资源库，自动使用回滚日志模式；文件锁与断线恢复取决于 NAS，请保持同一时间只有一个实例写入并做好备份。

*Libraries on network shares (NAS/SMB) are now supported (experimental): Serpent uses rollback journaling there, and file locking / disconnect recovery depend on the NAS. Keep a single instance writing at a time and maintain backups.*

**自动更新**
- 接入 GitHub Release 更新流：检查/下载/取消/进度展示；Windows 安装流程收口（portable 更新保留下载包，安装型更新自动清理临时文件）。

*Auto-update now uses GitHub Releases: check, download, cancel, and progress are shown in-app; the Windows install flow was hardened (portable updates keep the downloaded archive, installed updates clean up temp files).*

**视频代理播放**
- 已生成代理的视频在卡片 hover 与查看界面播放代理视频；源播放失败时静默降级生成代理（与查看器「失败才生成」规则一致）。

*Videos with a generated proxy now play it on card hover and in the viewer; when the original cannot play, Serpent silently falls back to generating a proxy (same “generate on real failure” rule as the viewer).*

**PDF 查看器缩放/平移**
- 滚轮缩放锚定鼠标位置、拖拽抓手、缩放渲染清晰。

*PDF viewer zoom/pan: wheel zoom anchors to the pointer, drag-to-pan, and crisp zoomed rendering.*

**查看器 Ctrl+C 复制**
- 资产查看界面支持 Ctrl+C 复制资产；视频查看器右键菜单新增复制。

*Ctrl+C copies assets from the viewer; video viewer context menu gained a Copy action.*

**主菜单「检查更新」**
- 关于菜单不再显示版本号，改为「检查更新」入口（打开关于页处理自动更新）。

*The About menu no longer shows the version; a “Check for updates” item opens the About page, which owns the update flow.*

## 修复 / Fixes

- 视频查看界面代理状态三态区分：仅「生成失败」显示警告，加载中/生成中为普通状态提示。
  *Viewer proxy states are now distinct: only “generation failed” warns; loading/generating show ordinary status.*
- 视频代理提示随鼠标停驻 UI 一并渐隐，不再遮挡画面。
  *The proxy playback notice now fades with the rest of the chrome after the mouse rests.*
- NAS 与恢复提示弃用常驻 banner——NAS 提示改为 warning toast，恢复提示改为确认弹窗（含「查看恢复报告」入口）。
  *Persistent banners were retired: the NAS notice is now a warning toast, and library-recovery reports open a confirmation dialog (with a “view recovery report” action).*
- PDF 白屏/闪烁：渲染完成再替换占位、缩放时旧节点作过渡占位、缩放中心精确锚定。
  *PDF blanking/flicker fixed: the placeholder is replaced only after render completes, the old page stays as a transition placeholder while zooming, and zoom centers exactly on the pointer.*
- 递归显示子文件夹时不再显示子文件夹卡片图标。
  *Recursive folder view no longer shows child-folder cards.*
- 合集浏览性能优化。
  *Recursive collection browsing performance improved.*

## 已知限制 / Known limitations

- NAS 资源库为实验性支持：文件锁与断线恢复取决于共享盘实现；同一资源库仅支持单实例写入，多机同时写暂不支持。
  *NAS libraries are experimental: file locking and disconnect recovery depend on the share; a library supports a single writer at a time — simultaneous multi-machine writing is not supported yet.*
