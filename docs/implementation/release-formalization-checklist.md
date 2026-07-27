# Serpent 首版正式化发布清单

> 状态：规划中  
> 目标：以轻量方式完成开源软件的 GitHub 自动测试、安装包构建和首版发布。  
> 原则：不建设企业级发布平台；但最终用户必须能够获得可安装、可启动、可卸载的 macOS/Windows 版本。

## 一、发布基线

- [ ] 从最新 `main` 建立干净的发布候选分支。
- [ ] 工作树无未提交代码、临时文件、本地测试资源和根目录媒体二进制。
- [ ] 版本号、Git tag、安装包版本和 GitHub Release 版本一致。
- [ ] 发布说明包含新功能、已知问题、支持平台、安装方法和数据保留说明。
- [ ] 当前人类验收清单中的发布阻断项已经处理或明确列为不发布原因。

## 二、用户可见内容

- [ ] 应用名称、产品描述、窗口标题、安装包名称和关于页面统一为 Serpent。
- [ ] macOS、Windows、浏览器扩展使用正确 Logo 和图标。
- [ ] 清理 `TODO`、`FIXME`、`TBD`、测试文案、开发态提示、调试入口和内部错误说明。
- [ ] 中英文界面没有明显缺失、混用或面向开发者的文案。
- [ ] 错误提示可操作且不泄漏绝对路径、堆栈和内部实现。
- [ ] 复查媒体组件缺失时的用户提示，正式包不能要求用户自行安装开发依赖。

## 三、开源组件与许可证

建立第三方组件清单，至少覆盖：

- npm 运行时和开发依赖；
- Electron、Electron Forge、better-sqlite3；
- FFmpeg、ffprobe、OpenImageIO 和 vcpkg 构建依赖；
- Noto Sans SC、HarmonyOS Sans SC；
- IBM Plex Mono；
- 字体、图标和其他外部资源。

每项记录版本、来源、许可证、是否进入安装包，以及对应许可证文件。FFmpeg 必须保持项目要求的 LGPL-only 组合，不得把本机未验证的 GPL/nonfree 二进制放进发布包。

## 四、源代码仓库与安装包边界

`.beads/`、`docs/development/`、`docs/qa/`、测试代码和开发规范属于源代码仓库的维护记录，不应为了制作安装包而删除。

最终安装包必须排除：

- `.beads`、`.github`、`.cursor`、`.claude`；
- `docs`、`tests`、源代码和开发脚本；
- `.env`、测试资源、本地日志；
- 根目录临时的 `ffmpeg.exe`、`ffprobe.exe`。

需要检查 `app.asar` 和 `resources`，确认包内没有开发资料。

## 五、GitHub 自动化

### PR / main 测试

macOS arm64 和 Windows x64 均执行：

```text
npm ci
npm run rebuild:native
npm run lint
npm run typecheck
npm run extension:verify
npm test
npm run test:perf:search
npm run test:e2e
```

### Tag 发布

推送 `v*` tag 或手动触发 workflow 后：

```text
获取并校验媒体 bundle
npm run package
npm run verify:package
npm run test:e2e:packaged
npm run make
```

然后自动创建 GitHub Release 并上传：

- macOS DMG 和 ZIP；
- Windows Setup、ZIP、`RELEASES` 和 `.nupkg`；
- SHA-256 校验文件；
- 第三方许可证清单。

带 `-rc` 的 tag 创建预发布版本，正式 tag 创建稳定版本。

应用内自动更新、灰度发布、强制更新和差分更新暂不作为首版阻断；GitHub 自动测试和安装包发布属于首版必须项。

## 六、媒体与打包门禁

- [ ] `resources/media-binaries/bundle-lock.json` 两个平台不再是 `build-required`。
- [ ] 媒体 bundle 来源、哈希、manifest、许可证和 acquisition receipt 可追溯。
- [ ] `npm run package` 成功。
- [ ] `npm run verify:package` 成功。
- [ ] 图片实际解码，视频至少能读取元数据并显示非零尺寸。
- [ ] 视频缩略图/封面路径在正式包中可用。

## 七、安装、卸载和重装验收

### Windows

- [ ] `Setup.exe` 可在干净环境安装并启动。
- [ ] 快捷方式、首次启动、创建资源库和导入媒体正常。
- [ ] 从系统应用设置卸载成功。
- [ ] 卸载不删除用户资源库和用户数据。
- [ ] 重新安装后可以继续打开旧资源库。

### macOS

- [ ] DMG 可打开，应用可拖入 Applications。
- [ ] 从 Applications 启动并完成创建资源库、导入和预览。
- [ ] 将应用移入废纸篓后程序文件被移除。
- [ ] 用户资源库和用户数据保留。
- [ ] 重新安装后可以继续打开旧资源库。
- [ ] 在本地 APFS 上验证，不能用 SMB/NAS 运行安装包。

## 当前已知正式化阻断

- [`resources/media-binaries/bundle-lock.json`](../../resources/media-binaries/bundle-lock.json) 两个平台仍为 `build-required`。
- [`ci.yml`](../../.github/workflows/ci.yml) 目前没有 package、make 和 packaged E2E 发布门禁。
- 尚无 GitHub tag/release workflow。
- Windows/macOS 安装、卸载、重装和发布包平台证据尚未形成。

