# ADR-0018：采用 UtilityProcess 与媒体子进程隔离后台任务

- 状态：已接受
- 日期：2026-07-11

## 背景

Serpent 需要在保持 UI 流畅的同时处理 10 万项资产的扫描、缩略图、全文索引、视频抽帧和云端 AI。媒体输入不可信，解码失败或原生程序崩溃不应带走主窗口。

详见[Electron 后台任务架构调研](../research/electron-background-worker-architecture.md)。

## 决策

- Renderer 只负责 UI，保持 sandbox、context isolation，并关闭 Node integration。
- Main 只负责窗口、生命周期、原生对话框、权限校验和后台进程监督。
- 一个常驻 Electron UtilityProcess 作为 Library Worker，统一拥有数据库写入、SQLite FTS、持久任务队列、图片缩略图和云端 AI 请求。
- FFmpeg/ffprobe 等媒体工具由 Library Worker 按任务使用异步子进程启动，限制并发并允许取消。
- 任务状态先持久化，支持暂停、继续、取消、重试和崩溃恢复。
- 正常退出时停止领取新任务并保存状态；MVP 不承诺应用关闭后继续处理，下次启动恢复。
- MVP 不引入 Web Worker 或通用 `worker_threads` 池。只有性能测量证明纯 JavaScript CPU 工作成为瓶颈时，才增加有界线程池。

## 后果

- Renderer 不直接读取任意文件、访问数据库或持有 API Key；通过窄类型 IPC 请求语义化操作。
- 大图片和视频帧不通过 IPC 搬运，只传任务 ID、缓存路径和小型元数据。
- Library Worker 崩溃时 Main 有限次数退避重启；连续失败后 UI 进入可浏览已有索引的降级模式。
- FFmpeg 等平台二进制放在 ASAR 外，按 Windows/macOS 与 CPU 架构分别打包和签名。
- SQLite 等原生 Node 模块必须针对 Electron ABI 构建。
- 未来插件不能直接运行在核心 Library Worker 中，需要独立权限和进程隔离设计。
