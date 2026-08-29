# ADR-0015：桌面客户端采用 Electron 与 TypeScript

- 状态：已接受
- 日期：2026-07-11

## 背景

Serpent 首发 Windows 与 macOS，需要复杂资产网格、预览交互、浏览器式搜索体验、文件系统操作、媒体处理和未来插件系统。预期贡献者以 TypeScript/JavaScript 为主要语言。

## 决策

桌面客户端使用 Electron，应用代码以 TypeScript 为主。

渲染进程负责界面；文件系统、数据库、任务调度和敏感权限由主进程或隔离后台进程承担，不直接暴露给网页上下文。

## 后果

- UI、浏览器扩展和未来 JavaScript 插件可以共享语言、类型与部分协议定义。
- 必须严格设计 context isolation、IPC schema 和最小权限 preload API。
- 媒体解析与重 CPU 任务不能阻塞主进程或渲染进程；具体后台进程架构由专项研究决定。
- 需要控制内存、安装包体积和大列表渲染性能。
