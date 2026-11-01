# Serpent 发布与分发手册

> 发布负责人（人或 agent）按本手册执行从版本号到 release 资产上线的全流程。
> 首次发布验证：v0.1.0（2026-08-15）、v0.1.1（2026-08-18）。

## 1. 版本号

- `package.json` 与 `package-lock.json` 的 `version` 同步修改（两处：顶层 + `packages[""]`），提交消息 `chore(release): 版本号 x.y.z → x.y.z+1`。
- 版本提交落在 `main`。`main` 是最新分支，见 §2。

## 2. 分支与代码基线

- **`main` 是最新分支，也是 Pull Request 的合并目标**。它包含完整软件代码（`src` / `tests` / `resources` / `scripts` / `assets`）与公开文档（`docs/user-guide`、`docs/developer`、`docs/manual`、`docs/assets`、`docs/product-brief.md`、`docs/glossary.md`、`README`、`website` 等）。`docs/developer/` 必须留在 `main`。历史上 `0b55d64a` 把 `docs/developer` 从 main 删掉，属于分类错误，不得再做。
- **`dolag_dev` 是维护者个人工作分支**（原 `dev`）。内部文件留在这里：`.beads/`、`.github/` 里的 CI 配置、`.codex/`、`.cursor/`、`AGENTS.md`、`CLAUDE.md`、`CONTEXT.md`、`docs/internal/`、`benchmark.md`。`.github/ISSUE_TEMPLATE/` 与 `.github/PULL_REQUEST_TEMPLATE.md` 是公开模板，保留在 `main`。不要把 `dolag_dev` 整支合并进 `main`。需要内部文件和产品代码在同一棵树上时，把 `main` 合入 `dolag_dev`。
- **`main` 不引入内部开发记录**：`.beads/`、CI 配置、`docs/internal/` 留在 `dolag_dev`。2026-08-19 起 `main` 只保留产品代码与公开文档；2026-09-13 起公开文档包含 `docs/developer/`。
- **发布打包在 `main` 上执行**。`verify-package.mjs` 不读取 `docs/internal`。
- 测试必须完整合入 main（`tests/` 是产品证据）。

## 3. 打包流程

发布同样遵守 [`development-process.md`](development-process.md) 的最小化测试原则。只改界面时不跑 Worker、资源库可用性、搜索性能和全量 E2E。`release:verify` 只有用户明确要求整套门禁时才运行；进入发布流程本身不自动开跑。

优先用发布管线（本机构建，禁止交叉平台打包——`forge.config.ts` 的 `nativeMediaPlatform` 强制 `darwin-arm64` / `win32-x64` / `linux-x64` / `linux-arm64` 本机；Linux AppImage 也必须在同架构的 Linux 本机或 `make:appimage:docker` 内构建）：

```bash
npm run release:verify     # rebuild:native + verify:mainline（CI 同款门禁）
npm run release:media      # media:acquire + media:verify（linux-x64 与 linux-arm64 都与 macOS/Windows 一样校验 pinned bundle；linux-arm64 在晋升前会因 build-required 阻断）
npm run release:package    # package + verify:package
npm run release:e2e        # test:e2e:packaged（针对打包产物）
npm run release:make       # macOS/Windows: electron-forge make；Linux: AppImage（优先 docker）
npm run release:checksums  # out/make/SHA256SUMS-<platform>.txt
```

或一键 `npm run release:local`（可带 `--skip-verify` / `--skip-media` / `--skip-e2e` / `--build-media-locally`，后者仅本地试用）。

发布门禁（package/make 阶段自动执行，不可跳过）：
- `scripts/media-binaries.mjs verify`（媒体二进制哈希，`--platform <target>`）
- `scripts/build-extension.mjs`（浏览器扩展随包重建）
- `scripts/verify-package.mjs`（ASAR 内容、`better_sqlite3.node`、ufbx WASM 哈希）
- `scripts/verify-ufbx-wasm.mjs`（prepackage/premake 内嵌校验，缺失即失败并给出构建指引）

**打包完成后必须恢复开发用的 native 模块**：

```bash
npm run rebuild:native   # 重编 better-sqlite3 并用 Electron ABI 实测 FTS5
```

## 4. 产物命名规范

Forge 默认产物名（如 `Serpent-0.1.1-arm64.dmg`、`Serpent-darwin-arm64-0.1.1.zip`）**需要重命名**为以下规范名（对齐 v0.1.0/v0.1.1）：

| 平台 | 产物 | 规范名 |
| --- | --- | --- |
| macOS arm64 | 安装包 | `Serpent-darwin-arm64-<ver>-package.dmg` |
| macOS arm64 | 便携版 | `Serpent-darwin-arm64-<ver>-portable.zip` |
| Windows x64 | 便携版 | `Serpent-win-x86-64-<ver>-portable.zip` |
| Windows x64 | 安装包 | `Serpent-win-x86-64-<ver>-setup.zip`（Inno 安装器 `SerpentSetup.exe` 打包为 zip 上传；安装器由 `npm run make:inno` 产出 `out/make/inno/SerpentSetup.exe`） |
| Linux x64 | AppImage | `Serpent-linux-x86-64-<ver>.AppImage`（`npm run release:make` 在 Linux 上优先跑 `make:appimage:docker`，把 `Serpent-<ver>-x86_64.AppImage` 重命名为该规范名） |
| Linux arm64 | AppImage | `Serpent-linux-arm64-<ver>.AppImage`（同一管线把 `Serpent-<ver>-aarch64.AppImage` 重命名为该规范名；媒体包晋升前不能产出） |

每个产物配套 SHA-256 文件：`shasum -a 256 <file> | awk '{print $1}' > <file>.sha256`。

Windows 安装器（Inno Setup，2026-08-08 决策替代 WiX MSI）：
- `npm run make:inno`（`scripts/inno-build.mjs` + `assets/inno/serpentsetup.iss`），需先 `npm run package`；支持安装时语言选择（中/英）、per-machine 路径、干净卸载。
- Inno 工具获取：NuGet `Tools.InnoSetup` 或官方安装，免管理员优先。

Linux AppImage（Ubuntu 22.04 / glibc 2.35 基线）：
- 发布管线 `release:make` 在 Linux 上优先 `npm run make:appimage:docker`（无 docker 时回退 `make:appimage`）。
- linux-x64 与 linux-arm64 都内置与 macOS/Windows 相同的 pinned 媒体工具（`ffmpeg` / `ffprobe` / `oiiotool`），减少对系统 PATH 的依赖。`SERPENT_FFMPEG_PATH` / `SERPENT_OIIO_PATH` 仍可覆盖。glibc 基线都是 Ubuntu 22.04 / 2.35。linux-arm64 的 zip 尚未晋升（`bundle-lock.json` 为 `build-required`），现成 AppImage 还不能构建。
- 两条架构都需要 FUSE（`libfuse2`）；无 FUSE 时用 `--appimage-extract-and-run`。X11 / 嵌套 Wayland 的验收范围相同，原生 Wayland 仍待专项验收。

### 自动更新资产契约（2026-08-20）

当前 Serpent 已在「帮助 > 关于 Serpent」提供更新检查和更新入口。更新器运行在 Main，访问公开仓库的 GitHub Releases API，只接受 HTTPS 的 GitHub asset，并要求目标资产拥有同名 `.sha256` sidecar 或 GitHub `sha256` digest；下载后先校验再打开安装器/显示便携包。

当前格式不能直接接入 Electron `autoUpdater` / `electron-updater`：原生 `autoUpdater` 需要 Squirrel/Mac、Squirrel.Windows 或 MSIX，`electron-updater` 的 Windows 路径需要 NSIS，而当前项目是 Forge ZIP + Inno Setup。研究记录见 [`docs/internal/research/2026-08-20-electron-forge-github-release-auto-update.md`](../research/2026-08-20-electron-forge-github-release-auto-update.md)。

- 已安装版：macOS 选择 `*-package.dmg`；Windows 选择 `*-setup.zip`，下载校验后打开 DMG 或解压并打开 `SerpentSetup.exe`。Inno 安装完成后会在应用目录写入 `.serpent-installed` 标记；旧安装仍以 `unins*.exe` 兼容识别。
- 便携版：macOS/Windows 选择各自 `*-portable.zip`，下载校验后显示文件位置；不能覆盖正在运行的便携目录，用户退出后解压并启动新版本。
- Linux：按架构选择 `Serpent-linux-x86-64-<ver>.AppImage` 或 `Serpent-linux-arm64-<ver>.AppImage`（便携），下载校验后显示文件位置；用户 `chmod +x` 后运行。
- 更新产物按平台生命周期清理：失败或校验未通过的下载及解压目录立即清除；成功打开的 macOS DMG、Windows/macOS 便携 ZIP 和 Linux AppImage 保留给用户安装或替换。Windows 已安装版的临时 `SerpentSetup.exe` 由单个隐藏 PowerShell 清理进程在安装器退出后移除；进程内使用计时器等待并重试文件删除，不通过命令 shell 或 `ping` 延时。若清理在重试期限内仍失败，追加不含本地路径的错误记录到应用日志。
- 资产名是运行时选择器的一部分，不能只改 Release 上传名而不改客户端。每个平台和分发形态必须同时上传目标资产与 `.sha256`。
- GitHub Release 必须是公开、稳定、已发布的 SemVer Release；`/releases/latest` 不会返回 draft/prerelease。当前 `v0.1.2` 已验证包含 macOS DMG/portable ZIP、Windows setup/portable ZIP 及对应校验文件，但没有 `latest*.yml`、`RELEASES` 或 `RELEASES.json`。

#### 更新日志元信息（强制，2026-09-14 用户要求）

**每个 Release 都必须上传**名为 `release-meta.json` 的 JSON 资产 —— 它让「关于 Serpent」
能显示结构化更新日志，不再从 Release 正文里抓文本。同时按上一版约定上传一份带版本号的
副本 `release-meta-<ver>.json`（便于回溯）。客户端会校验 `version` 与 Release tag 一致后
显示；该资产缺失（客户端会退回 Release body，但这属于发布事故）、网络失败、格式错误或
版本不匹配时，仍使用 Release body，不能阻塞更新检查。字段契约示例见
[`release-meta.example.json`](../../../release-meta.example.json)：`date` 为发布日期，
`changelog` 是中英文条目数组，`changelogUrl`/`downloadUrl` 为可选 HTTP(S) 链接，
`mandatory` 表示产品是否要求更新。`downloadUrl` 只作元信息展示，实际安装包仍按已校验的
平台资产和 `.sha256` sidecar 选择，不能由 JSON 绕过资产校验。

若未来要改为静默原生更新，需要另行迁移打包协议：Forge 原生路线使用签名 macOS ZIP + `RELEASES.json` 和 Squirrel.Windows；`electron-updater` 路线则完整迁移到 electron-builder，使用 macOS DMG/ZIP、Windows NSIS 与 `latest-mac.yml`/`latest.yml`。不能仅添加一个 updater 依赖或把普通 ZIP 当作可原地覆盖包。

## 5. Changelog 规范

- **中英双语**：中文在前、英文在后，标题 `**Serpent <版本>** — <一句话主题> · <English one-liner>`。
- **按重要程度排序**：新功能 > 性能/可靠性 > 错误提示 > 其他。
- 重要功能逐条详细描述（中英对照条目，说明用户价值）；**UI 修改、简单 bug 修复用概括语句**（如「优化了若干 UI」「修复了若干稳定性问题」），不逐一列举。
- **只写用户能直接感知的变化（2026-09-27，强制）**：Release 正文和 `release-meta.json` 只写用户会遇到的结果。版本内部的实现调整不写进去，包括查看管线替换、兼容层、解码路径，以及同一次更新自己引入又自己修掉、用户无从对照的行为。格式能不能打开、设置里新出现的开关、原来会碰到的问题是否消失，才可以写。先例：0.2.4 曾把「链接目录可以展开子文件夹」写成新特性，那是同一次更新造成的回归，用户不知道原先有这条；0.2.9 曾把「Illustrator 文件按图片查看，并说明当前是 PDF 画面」写进更新日志，这是查看实现的内部调整，没有需要单独告诉用户的新结果。发布前对照本条删掉这类条目，正文和 `release-meta.json` 一起改。
- **未对用户发布过的中间改动不进 Release Note（2026-10-15，强制）**：若某功能或修复在上一正式版之后才合入，且在本版发布给用户之前又被改掉、撤回或重写，只写最终交付给用户的结果，不写开发过程中的中间形态、误加后删除的开关、同一次未发布周期内的反复打磨条目。对照基准是上一 GitHub 正式 Release（当前为 v0.2.10），不是开发分支上的临时行为，也不是未发布的过渡版本号（例如草稿里一度使用的 0.2.11）。先例：0.2.11 开发中一度加入「静默启动」又在发布前移除——Release Note 不得出现该开关；退出时回收本机语义模型进程属于开发周期内的修复，用户无从对照，不单列。界面迭代中的阴影滑块、浮岛等内部命名，若只是新 UI 的组成部分，应并入「全新 UI」概括，不必单独成条。用户文档同样不使用这些内部称呼。
- **不在仓库维护 `release-notes-<ver>.md`**。Changelog 直接写入 GitHub Release 正文；关于窗口短条目可选写入 `release-meta.json` 资产（见 §4）。发布时用本地临时草稿配合 `gh release create --notes-file` 或 `gh release edit`，草稿不要提交进 git。

参考：[v0.1.1 release notes](https://github.com/dolag233/Serpent/releases/tag/v0.1.1)（WebDAV 同步、外部资源库、数据恢复、性能、错误提示的写法与排序）。

## 6. Release 创建与上传

> Windows 上 `gh` 安装于 `C:\Program Files\GitHub CLI\gh.exe`，用户 PATH 可能缺失——用全路径调用或先修复 PATH。先 `gh auth status` 确认登录（keyring 凭据）。

```bash
# 创建（target 指向发布分支 main；tag 指向 main 发布基线）
# --notes-file 指向本地临时草稿，不要提交进仓库
gh release create v<ver> --title "Serpent <ver>" --notes-file <本地临时草稿.md> --target main

# 上传资产（macOS 4 个：dmg/portable + 各自 sha256）
gh release upload v<ver> \
  Serpent-darwin-arm64-<ver>-package.dmg Serpent-darwin-arm64-<ver>-package.dmg.sha256 \
  Serpent-darwin-arm64-<ver>-portable.zip Serpent-darwin-arm64-<ver>-portable.zip.sha256

# 上传资产（Windows 4 个：portable/setup + 各自 sha256）
gh release upload v<ver> \
  Serpent-win-x86-64-<ver>-portable.zip Serpent-win-x86-64-<ver>-portable.zip.sha256 \
  Serpent-win-x86-64-<ver>-setup.zip Serpent-win-x86-64-<ver>-setup.zip.sha256

# 上传资产（Linux x64：AppImage + sha256；arm64 媒体包晋升后再加对应两个文件）
gh release upload v<ver> \
  Serpent-linux-x86-64-<ver>.AppImage Serpent-linux-x86-64-<ver>.AppImage.sha256 \
  Serpent-linux-arm64-<ver>.AppImage Serpent-linux-arm64-<ver>.AppImage.sha256

# 必传：更新日志元信息（version 必须等于 <ver>，见 §4「更新日志元信息（强制）」）
gh release upload v<ver> release-meta.json release-meta-<ver>.json
```

发布后核对 release 页：标题、notes、资产齐全、`--target main` 正确。
**禁止上传裸 `SerpentSetup.exe` 或 Forge 默认名产物**（如 `Serpent-win32-x64-<ver>.zip`）——自动更新器按 §4 规范名选择资产。

## 7. 平台注意事项

**Windows 真机（打包与验收）**：
- GitHub 直连不稳定时：`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`。
- 打包前结束残留 `out\Serpent-win32-x64\Serpent.exe` 实例（进程锁 out 目录导致 Forge 无法重建）。
- Defender 实时扫描可能瞬时锁刚写入的 exe（EBUSY），重试即可。
- 安装器验收：语言选择、安装路径、快捷方式、注册表卸载项、覆盖升级、卸载干净。

**macOS**：
- 打包产物 `.app` 不能从 SMB/NAS 路径运行，先复制到本地 APFS。
- 用户测试临时产物（out/、test-results/）用后清理。

**Linux**：
- 发布构建优先 `make:appimage:docker`（Ubuntu 22.04 / glibc 2.35），避免在较新发行版上打出高 glibc 依赖。
- 发布用 AppImage 内置 pinned 媒体工具。验收不必再依赖系统 `ffmpeg`，除非用环境变量改到了外部路径。linux-arm64 使用同一合同，但在媒体 zip 晋升前没有可发布的包。

## 8. 发布检查清单（逐条对照，禁止凭印象执行）

- [ ] 版本号已改（package.json + lock，提交 `chore(release): 版本号 …`），落在 `main`
- [ ] `main` 无内部开发文件，但保留 `docs/developer/` 与 issue / PR 模板
- [ ] 产品改动经 Pull Request 进入 `main`。没有把 `dolag_dev` 整支合并进 `main`
- [ ] 全部发布门禁通过（media verify / verify-package / ufbx WASM）——在 `main` 上打包
- [ ] 产物按 §4 规范名精确重命名（`win-x86-64` 不是 `win32-x64`；安装包是 `-setup.zip` 不是裸 exe）+ 每个资产同名 `.sha256`（只含哈希）
- [ ] Changelog 中英双语（中文在前，标题 `**Serpent <版本>** — 一句话 · English one-liner`）、按重要度排序、次要改动概括；已写入 GitHub Release 正文。只保留用户能直接感知的变化；内部实现调整（查看管线、兼容层、同一次更新自己引入又修掉的行为）不出现在正文或 `release-meta.json`（§5）
- [ ] Release 正文和 `release-meta.json` 不包含上一正式版之后、本版发布前又撤回或重写的中间改动（§5「未对用户发布过的中间改动不进 Release Note」）。对照基准是上一 GitHub 正式 Release，不是工作分支上曾经出现过的开关、内部称呼或未发布的过渡版本号
- [ ] **`release-meta.json` 与 `release-meta-<ver>.json` 已上传，且 `version` 等于 tag 版本**（§4 强制项）
- [ ] Release 正文只面向用户：不写构建/打包/平台流程或内部约束（如「本页只含某平台产物」）
- [ ] `gh release create v<ver> --title "Serpent <ver>" --notes-file <本地临时草稿.md> --target main`（gh 全路径调用；草稿不提交进仓库）
- [ ] 资产上传齐全（macOS 4 / Windows 4 / Linux x64 2，arm64 媒体包已晋升时再加 2 + release-meta 2），release 页核对标题/notes/资产/`--target main`
- [ ] tag `v<ver>` 指向 main 发布基线（`git tag v<ver> <main-commit>` + `git push origin v<ver>`）
- [ ] `npm run rebuild:native` 已恢复开发用的 native 模块（FTS5 probe OK）
