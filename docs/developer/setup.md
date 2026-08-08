# 环境搭建

## 要求

- Node.js **24.15.0**（`.nvmrc` 锁定，用 `nvm use` 切换）
- npm（国内网络建议 `--registry=https://registry.npmjs.org`）
- 原生开发目标：macOS arm64、Windows x64
- **不要在 SMB/NAS 挂载目录上构建或运行**——Electron 在挂载盘上无法正常启动（`icudtl.dat not found`），打包产物也不能从挂载盘运行

### macOS

- Xcode Command Line Tools（原生模块编译需要）
- 媒体组件构建（仅需要重建时）：`scripts/media-build/darwin-arm64.sh`（vcpkg，耗时数小时）

### Windows

- Git、PowerShell
- Visual Studio Build Tools：Desktop development with C++ 工作负载 + Windows SDK
- 媒体组件构建：`scripts/media-build/win32-x64.ps1`

## 首次构建

```bash
npm ci --registry=https://registry.npmjs.org
npm run rebuild:native
npm start
```

`rebuild:native` 把 `better-sqlite3` 编译为 Electron ABI 并实测 FTS5。Windows 上**不要**裸跑 `@electron/rebuild` 或 `node-gyp`——本机 vcpkg 的 MSBuild 集成可能链接到无 FTS5 的 sqlite3.dll；项目脚本已强制禁用。

## 媒体组件

`npm ci` **不安装** FFmpeg/ffprobe/OpenImageIO。缺组件时普通开发与图片导入不受影响；视频缩略图/代理生成会报 `FFMPEG_REQUIRED`，EXR/TGA/复杂 TIFF 需要 OpenImageIO。

打包产物使用受控媒体包（FFmpeg 8.1 LGPL-only + OpenImageIO 3.1.12.0），门禁校验产物哈希与来源（`resources/media-binaries/bundle-lock.json`）。本地开发可用 `SERPENT_FFMPEG_PATH` 指向任意可信 FFmpeg（需含所需滤镜/编码器，且 `ffprobe` 同目录；GPL 构建仅限本地覆盖）：

```bash
# macOS
export SERPENT_FFMPEG_PATH="$HOME/tools/ffmpeg/ffmpeg"
npm start
```

```powershell
# Windows
$env:SERPENT_FFMPEG_PATH = 'C:\tools\ffmpeg\ffmpeg.exe'
npm start
```

更换后需完全退出 Serpent 再启动（单实例锁，二次 `npm start` 不会替换已运行进程）。

## 常见开发命令

```bash
npm run lint             # ESLint
npm run typecheck        # tsc --noEmit
npm run test             # 单元 + Worker 集成（Electron 内运行）
npm run test:unit        # 仅单元
npm run test:worker      # 仅 Worker 集成
npm run test:e2e         # Playwright E2E
npm start                # 开发启动
npm run start:multi      # 双实例
```

## 开发注意事项

- 测试跑在 Electron ABI 下（`test:worker`/`test` 经 `run-vitest-with-electron.mjs`）；`npm run package` 后需 `npm run rebuild:native` 恢复 dev native 模块
- `npm start` 自动避开被占用的 Vite 端口
