# 任务临时文件回收

工单 Serpent-9fc856。应用按配置目录隔离自己的任务暂存。浏览器保存退出或被拒绝时，由上传服务清理文件，下一次应用启动回收识别出的中断任务。网络回退下载直接写入最终导入文件名，文件名已匹配时省去一份复制。上传、下载和额外复制落盘前检查目标卷空间。

Windows 安装更新把归档和解压后程序放在同一个暂存任务目录。启动后立即回收未交接的目录。已经进入交接的目录仍由后台进程清理，应用启动时只检查超过一天的遗留目录。下载输出若遇到其他程序抢先创建同名文件，保留对方文件。

CLIP 预览用只读 SQLite 内存反序列化，并将查询的临时存储限定在内存。导入缩略图的多档编码先在内存中选定结果，只落盘一次。常见大小的旧缩略图从有容量上限的缓冲区解码，避免 Windows 上 libvips 持有源文件。打开资源库后的产物扫描可识别超过原有五分钟保护期且无数据库引用的规范化临时文件。

| 需求 | 实现 | 自动化 | 人工与平台 |
| --- | --- | --- | --- |
| 扩展暂存归属、空间不足和重启回收 | [扩展服务](../../../src/main/extension-server.ts) · [Worker 导入](../../../src/worker/library-service.ts) | [HTTP 测试](../../../tests/unit/extension-message.test.ts) · [Worker 导入测试](../../../tests/worker/extension-save.test.ts) | 自动化覆盖；浏览器实际操作未执行 |
| 安装器交接、遗留回收、同名文件保留 | [更新服务](../../../src/main/app-update-service.ts) · [任务回收](../../../src/main/task-staging.ts) | [更新单测](../../../tests/unit/app-update-service.test.ts) · [Windows Electron](../../../tests/e2e/app-update-handoff.test.ts) | 隐藏窗口模拟安装器进程；真实安装和安装包待验证 |
| CLIP 预览不生成数据库副本 | [预览读取](../../../src/worker/clip-canvas-preview.ts) | [CLIP 测试](../../../tests/worker/clip-canvas-preview.test.ts) | 以 SQLite 与封装夹具验证；真实应用操作未执行 |
| 缩略图落盘一次，重开回收旧暂存 | [库服务](../../../src/worker/library-service.ts) | [规范化测试](../../../tests/worker/imported-thumbnail-normalization.test.ts) · [资源库重开测试](../../../tests/worker/library-service.test.ts) | Windows Worker 验证；macOS 未执行 |

## 测试记录

- `npm run test:library-availability -- --maxWorkers=1`，9 文件 241 项通过，1 项跳过。
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts` 定向执行 CLIP、扩展、更新和缩略图规范化六份测试，154 项通过。最终更新和扩展单测复跑 75 项通过，Worker 扩展单独复跑 57 项通过。
- `node scripts/run-e2e.mjs tests/e2e/app-update-handoff.test.ts --trace off`，Windows 隐藏窗口 1 项通过。用假安装器验证应用退出、旧任务回收、近期交接保留和隐藏清理进程。
- Playwright 托管的 Electron 退出后，未在 5 秒内观察到其分离子进程完成删除。实际 PowerShell 清理脚本的测试在独立进程中核对整个暂存目录，包括交接标记与下载归档。
- `npm run typecheck` 及直接改动的 Main/CLIP 文件定向 ESLint 通过。

新回收程序不扫描旧版散落在共享系统临时目录中的文件，因为无法确定配置归属。便携更新与非 Windows 安装更新沿用直接下载至用户下载目录，强制终止时仍可能留下部分归档。旧版全局历史残留与这些下载的崩溃恢复另行处理。
