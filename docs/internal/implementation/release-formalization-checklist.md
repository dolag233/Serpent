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

`.beads/`、`docs/internal/development/`、`docs/internal/qa/`、测试代码和开发规范属于源代码仓库的维护记录，不应为了制作安装包而删除。

最终安装包必须排除：

- `.beads`、`.github`、`.cursor`、`.claude`；
- `docs`、`tests`、源代码和开发脚本；
- `.env`、测试资源、本地日志；
- 根目录临时的 `ffmpeg.exe`、`ffprobe.exe`。

需要检查 `app.asar` 和 `resources`，确认包内没有开发资料。

## 五、GitHub 自动化

发布流水线由 [`scripts/release/pipeline.mjs`](../../../scripts/release/pipeline.mjs) 统一定义。本地与 [`.github/workflows/release.yml`](../../../.github/workflows/release.yml) 调用同一组 `npm run release:*` 命令，避免两套步骤漂移。

### PR / main 测试

macOS arm64 和 Windows x64 均执行（与 `release:verify` 前半段一致，CI 目前仍分步调用）：

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

等价快捷命令：

```text
npm run release:verify
```

### 本地发布试跑

在对应平台本机（Windows x64 或 macOS arm64）依次执行：

```text
npm ci
npm run release:verify          # 与 CI 相同的主线门禁
npm run release:media           # 需要 bundle-lock 已晋升，否则会给出明确阻断说明
npm run release:package
npm run release:e2e:packaged    # 自动设置 SERPENT_E2E_PACKAGED_EXECUTABLE
npm run release:make
npm run release:checksums       # 为 out/make 产物写入 SHA-256 清单
```

一次性跑完全部阶段：

```text
npm run release:local
```

调试时可跳过部分阶段（**不能用于正式发布**）：

```text
npm run release:local -- --skip-verify --skip-media --skip-e2e
```

在 `bundle-lock.json` 尚未晋升、但已在本地跑过 `scripts/media-build/*` 时，可本地编译媒体并试跑后半段（自动设置 `SERPENT_MEDIA_SKIP_PROVENANCE=1`，**不能用于正式发布**）：

```text
npm run release:local -- --skip-verify --build-media-locally
```

当前已知阻断：`bundle-lock.json` 仍为 `build-required` 时，不带 `--build-media-locally` 的 `release:media` 会阻断；带该 flag 可本地编译媒体后继续 package/make，但正式 tag 发布仍需完成 bundle 晋升（见第六节）。

### Tag 发布

推送 `v*` tag 或手动触发 `Release` workflow 后，各平台 runner 执行：

```text
npm ci
npm run release:verify
npm run release:media
npm run release:package
npm run release:e2e:packaged
npm run release:make
npm run release:checksums
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

- [`resources/media-binaries/bundle-lock.json`](../../../resources/media-binaries/bundle-lock.json) 两个平台仍为 `build-required`；`release:media` 会在此阻断并打印下一步指引。
- [`.github/workflows/release.yml`](../../../.github/workflows/release.yml) 已就位，但在媒体 bundle 晋升前 tag 发布会失败。
- [`ci.yml`](../../../.github/workflows/ci.yml) 尚未改为直接调用 `release:verify`（步骤等价，可后续合并以减少漂移）。
- Windows/macOS 安装、卸载、重装和发布包平台证据尚未形成。

## 2026-07-28 当前评估记录

本节记录当前工作树的发布准备情况，不把旧测试或旧项目状态文档当作当前 HEAD 的证据。

本轮后续工作已记录为 Beads epic `Serpent-d112`。

- 用户确认：Inspector 切换资产时描述值未发现可复现问题；标签管理页面的 Ctrl/Command 多选已实测正常；Shell 顶部坐标、普通选择、回收站和媒体播放暂不作为已确认的产品缺陷。
- 仍需处理：当前 HEAD 的完整单元/Worker 测试存在导出缩略图、回收站冲突恢复、缩略图队列和 20k 导入性能红灯；Electron E2E 有一批因序列图折叠、离散滑块、代理视频和近期 UI 变更而失配的旧 fixture/断言。下一步必须逐项判断“实现回归”或“规格变化”，并同步更新测试，不能删除测试或把失败长期标记为“测试落后”。
- 人类验收队列保持现状，不要求一次性清空全部条目；发布前只需按选定的首发范围建立一条可复现的核心旅程验收路径，并明确其余条目属于后续版本。
- 安装流程是后续必须接入的发布工作：需要完成 macOS DMG/ZIP、Windows Setup（Inno Setup 安装器）的打包、安装、卸载、重装和用户资源库保留验证，再创建 release tag。
- 当前分支尚未合入 `main`，仓库仍为 Private，尚无稳定发布 tag；公开仓库和稳定版本发布应在媒体 bundle、测试同步、packaged 与双平台安装门禁之后执行。
- Beads 当前仍提示部分 JSONL 记录不在本地 Dolt store；在多设备或多人继续并行前需要先完成工单同步卫生检查。
