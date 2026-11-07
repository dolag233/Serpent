# 开发实例与 E2E 构建相互干扰（2026-11-07）

工单 `Serpent-dcaf86`。一次查看器返回性能验证期间，已有开发实例仍在运行，`scripts/run-e2e.mjs` 在启动前清空并重建共享 `.vite` 目录。运行中的开发窗口随后可能读取到混用的构建产物。这是本次操作流程的错误，不能要求用户靠重启电脑恢复。

另查到 `scripts/kill-stale-dev.mjs` 在 Windows 上按 `electron.exe` 进程名全局强制结束，未限制到本工作副本。这会波及其他 Electron 应用，也会让重复启动时的故障更难诊断。

修订：E2E 在改动 `.vite` 前检查本工作副本的开发 Electron 进程，Windows、macOS 与 Linux 均存在时直接拒绝构建；Windows 清理只匹配本工作副本 `node_modules` 下的 Electron 可执行文件。测试用运行中隔离开发实例验证：E2E 返回失败，`.vite/build/main.js` 哈希不变。进程匹配的 Node 定向测试 2 passed，脚本语法检查通过。macOS 与 Linux 的活跃进程守卫只有纯函数测试，尚无相应平台实测。

此防护只阻止今后再次覆盖活跃开发构建；用户当前启动失败的直接网络错误及恢复见 [开发态 Renderer 启动记录](2026-11-06-dev-renderer-startup.md)。前台实例未由 agent 操作；真实窗口复验仍由用户完成。

本次新建的隔离用户数据目录在系统临时目录下。验证无相关进程后尝试清理，自动审批以 `blocked by policy` 拒绝递归删除；未改用其他命令绕过，目录仍待清理。
