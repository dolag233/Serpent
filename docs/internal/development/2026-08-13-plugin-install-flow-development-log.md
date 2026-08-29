# 插件安装面板与 GitHub 下载控制开发记录

日期：2026-08-13

## 范围

- 设置 → 插件 → 安装插件面板收敛为“本地安装”和“从 GitHub 安装”两个入口，保留安装范围选择。
- 本地入口直接使用 Main 原生选择器，支持已构建插件文件夹和 ZIP 压缩包。
- GitHub 入口进入独立界面，支持完整 GitHub 地址和 `owner/repository` 简写。
- GitHub 下载由 Main 持有操作状态，向 Renderer 推送脱敏的阶段、字节数、错误摘要；支持暂停、继续、停止，关闭按钮会发出停止请求。

## 实现要点

- 下载流使用 `ReadableStream` 分块读取，透传 `AbortSignal`，下载/解压/复制到 staging 的循环都会响应停止。
- GitHub 安装继续复用既有 Release asset、平台匹配、zipball 回退、包校验和原子替换流程，不执行 npm/build。
- Renderer 在提交前校验仓库地址，远端 HTTP、平台包缺失和包校验错误沿既有 `failureCode/message` 返回并显示。
- 新安装完成后不再立即触发额外的自动更新网络请求，避免安装面板出现无进度的第二个后台操作。

## 验证证据

- `npm run lint`：通过。
- `npm run typecheck`：通过。
- `npx vitest run --config vitest.config.ts tests/unit/plugin-install-operation.test.ts tests/unit/plugin-github-client.test.ts tests/unit/plugin-release-asset.test.ts tests/unit/plugin-package-manager.test.ts tests/unit/plugin-package-ipc.test.ts tests/unit/plugin-manager-response-parse.test.ts tests/unit/secure-http-download.test.ts`：7 个文件、53 个测试通过。
- `node scripts/run-e2e.mjs tests/e2e/plugin-management.test.ts`：1 个 Electron E2E 通过，覆盖两个入口、无效 GitHub 地址提示、返回、本地文件夹安装、信任和 Safe Mode。

## 未验证边界

- Windows 原生文件选择器、Windows 打包应用和真实 GitHub 网络下载尚未在当前 macOS 环境执行；Windows 仍需独立验收。
