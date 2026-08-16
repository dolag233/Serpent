# Third-Party Notices

Serpent (MIT, see [LICENSE](LICENSE)) 依赖以下开源组件。各组件按其自身许可证提供；完整许可证文本随依赖包或下方链接分发。

## 运行时依赖

| 组件 | 许可证 | 用途 |
|---|---|---|
| [Electron](https://www.electronjs.org/) | MIT | 桌面应用运行时 |
| Chromium (随 Electron) | BSD-3-Clause | 浏览器内核 |
| [React / React DOM](https://react.dev/) | MIT | 界面渲染框架 |
| [Vite](https://vitejs.dev/) | MIT | 构建工具（打包产物含构建产物） |
| [TypeScript](https://www.typescriptlang.org/) | Apache-2.0 | 类型系统与编译器 |
| [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | MIT | SQLite 绑定 |
| [SQLite](https://www.sqlite.org/copyright.html) | Public Domain | 本地资源库数据库 |
| [Sharp](https://sharp.pixelplumbing.com/) | Apache-2.0 | 图像处理（libvips） |
| [FFmpeg](https://ffmpeg.org/)（BtbN builds） | LGPL-2.1 | 媒体解码/编码；许可证文本随包分发于 `resources/media-binaries/<platform>/licenses/` |
| [OpenImageIO (OIIO)](https://sites.google.com/site/openimageio/) | BSD-3-Clause | 图像处理管线（EXR 等） |
| [three.js](https://threejs.org/) | MIT | 3D 模型查看 |
| [exifr](https://github.com/MikeKovarik/exifr) | MIT | EXIF 元数据解析 |
| [koffi](https://koffi.dev/) | MIT | 原生函数 FFI 绑定 |
| [QuickJS](https://bellard.org/quickjs/)（[quickjs-emscripten](https://github.com/justjake/quickjs-emscripten)） | MIT | 脚本运行时（自动化脚本） |
| [adm-zip](https://github.com/cthackers/adm-zip) | MIT | ZIP 读取 |
| [archiver](https://github.com/archiverjs/node-archiver) | MIT | ZIP 写入 |
| [yauzl](https://github.com/thejoshwolfe/yauzl) | MIT | ZIP 解压 |
| [libarchive-wasm](https://github.com/ofk/libarchive-wasm) | MIT | ZIP、RAR、7z、TAR 等外部资源库归档读取 |
| [Zod](https://zod.dev/) | MIT | 跨进程协议运行时校验 |
| [trash](https://github.com/sindresorhus/trash) | MIT | 系统回收站 |
| [Model Context Protocol SDK](https://github.com/modelcontextprotocol/typescript-sdk) | MIT | MCP 服务器 |
| [ufbx](https://ubfgfx.com/)（`resources/ufbx/`，WASM） | MIT | FBX 解析与转换 |

## 字体

| 字体 | 许可证 | 用途 |
|---|---|---|
| [Noto Sans SC](https://fonts.google.com/noto/specimen/Noto+Sans+SC)（[@fontsource-variable/noto-sans-sc](https://github.com/fontsource/fontsource)） | SIL OFL-1.1 | 界面中文字体 |
| [IBM Plex Mono](https://github.com/IBM/plex)（[@fontsource/ibm-plex-mono](https://github.com/fontsource/fontsource)） | SIL OFL-1.1 | 等宽字体（文件名/元数据） |
| [HarmonyOS Sans SC](https://developer.huawei.com/consumer/cn/design/resource/)（[harmonyos-sans-sc-webfont-splitted](https://github.com/...)） | © Huawei；npm 包装为 Unlicense | 界面中文字体 |

> HarmonyOS Sans 字体版权归华为所有，华为授权免费使用（需保留版权声明）；npm 分包仓库以 Unlicense 声明其打包内容。正式对外发布前请按华为官方许可条款复核署名要求。

## 开发与构建工具（不随产物分发）

Electron Forge (MIT)、@electron/rebuild (MIT)、ESLint (MIT)、Playwright (Apache-2.0)、node-gyp (MIT)、Inno Setup（免费使用，非开源）、vcpkg (MIT)、Emscripten (MIT/BSD，构建 ufbx WASM 时)、BtbN FFmpeg-Builds（LGPL）。

## 完整许可文本

- 主项目：`LICENSE`（MIT）
- 媒体二进制（ffmpeg/OIIO）：`resources/media-binaries/<platform>/licenses/`（随 media 包分发）
- ufbx：`resources/ufbx/LICENSE`
- 各 npm 依赖：`node_modules/<包名>/LICENSE*`（随源码构建时可用）
