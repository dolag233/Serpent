# Serpent 的 Electron Forge + GitHub Releases 自动更新方案研究

> 研究日期：2026-08-20
> 范围：只做资料研究，不修改产品代码，不提交、不推送。
> 研究基线：开始研究时仓库 `HEAD c45733b8` 且工作区干净；官方资料截至研究日期可访问的内容。研究期间工作区出现了其他未提交改动，它们不是本研究产生的，未纳入判断。当前 `gh repo view dolag233/Serpent` 显示仓库为公开仓库。
> 结论性质：文中标注“事实”的内容来自官方文档、官方源码或当前仓库；“推断/建议”是基于这些事实对 Serpent 的工程建议。

## 结论先行

1. Electron 的 `autoUpdater` 不是“任何 Electron 安装包都能接入”的通用下载器，而是带有平台格式协议的运行时 API。它可以直接配合 **Electron Forge 的 macOS ZIP + `RELEASES.json`**，也可以配合 **Electron Forge 的 Squirrel.Windows Maker + `RELEASES`/`.nupkg`/Setup.exe**；它不能直接把当前 Serpent 的 DMG、Inno Setup EXE 或普通 Windows ZIP 当作可更新产物。
2. 在研究基线中，Serpent 使用 `MakerDMG`、`MakerZIP`，Windows Inno Setup 另行构建；没有应用内 `autoUpdater` 或 `electron-updater` 实现。该基线的 macOS 还是 ad-hoc signing（`identity: '-'`），不应据此承诺可靠的 macOS 自动更新。
3. 如果坚持 Forge 并希望使用 Electron 原生更新协议，最小的官方路线是：macOS 用 DMG 做首次安装、另产签名 ZIP 做更新；Windows 改用 Squirrel.Windows 产物。若必须保留 Inno Setup，则应把更新视为一套自定义的“下载并重新运行已签名安装器”流程，而不是宣称 `autoUpdater`/`electron-updater` 支持 Inno。
4. 如果目标明确是 `electron-updater` + GitHub Releases，官方建议是把 electron-builder 作为主要构建工具，使用 macOS DMG+ZIP 和 Windows NSIS，而不是继续把 Forge Maker 当作完整的 electron-builder 发布/自动更新流水线。
5. GitHub Releases 只是版本、说明和二进制 asset 的发布/托管界面；它不会自动生成 Electron 更新所需的 `RELEASES.json`、`RELEASES`、`latest.yml` 或 `latest-mac.yml`。必须选择一种 feed/metadata 协议，并把对应 metadata 与精确匹配的安装/更新资产一起发布。

## 当前 Serpent 的事实基线

- [`forge.config.ts`](../../forge.config.ts#L114-L121) 当前配置 `MakerZIP({}, ['darwin', 'win32'])` 与 `MakerDMG({})`；没有 `MakerSquirrel`、publisher 或 updater 配置。
- [`assets/inno/serpentsetup.iss`](../../assets/inno/serpentsetup.iss#L15-L40) 当前 Inno Setup 是安装到 `{autopf}\Serpent` 的 per-machine 安装，要求管理员权限，并把打包目录复制进去；它不是 Squirrel.Windows 的 `Setup.exe`/`.nupkg`/`RELEASES` 产物。
- [`scripts/release/pipeline.mjs`](../../scripts/release/pipeline.mjs#L161-L167) 通过 Forge 构建后，在 Windows 另行执行 `make:inno`。当前发布约定中，macOS 有 DMG 和 ZIP，Windows 有 Inno Setup 包和 portable ZIP。
- 在上述研究基线的代码和 `package.json` 中，没有 `autoUpdater`、`electron-updater`、`update-electron-app` 的运行时实现或依赖。当前 GitHub 源仓库已公开，因此公共 `update.electronjs.org` 的仓库可见性前提已满足；签名、产物协议和 Release 资产前提仍未满足。
- [`forge.config.ts`](../../forge.config.ts) 的 macOS signing identity 当前为 `'-'`（ad-hoc）。这是开发/本地打包事实，不是可面向用户的签名与 notarization 证明。

## 1. `autoUpdater` 能否直接用于 Forge 产物？

### 官方事实

Electron 官方 `autoUpdater` 在 macOS 使用 Squirrel.Mac，在 Windows 使用 Squirrel.Windows 或 MSIX；Windows 文档明确提到传统安装包应来自 `electron-winstaller` 或 Electron Forge 的 Squirrel.Windows Maker，而没有把 Inno Setup 或普通 ZIP 列为输入格式。更新下载完成后通常在下次启动应用时应用，`quitAndInstall` 只能在下载完成后调用。

来源：

- [Electron `autoUpdater` API](https://www.electronjs.org/docs/latest/api/auto-updater)
- [Electron 应用更新教程](https://www.electronjs.org/docs/latest/tutorial/updates)
- [Electron Forge Maker 配置](https://www.electronforge.io/config/makers)
- [Electron Forge Squirrel.Windows Maker API](https://js.electronforge.io/modules/_electron_forge_maker_squirrel.html)

Forge 本身可以生成符合这些协议的更新产物：

- Forge ZIP Maker 在配置 `macUpdateManifestBaseUrl` 时，会维护架构对应的 macOS `RELEASES.json`；manifest 的 `updateTo.url` 指向更新 ZIP。
- Forge Squirrel.Windows Maker 会生成 `{appName} Setup.exe`、完整 `.nupkg` 和 `RELEASES`，供 Squirrel.Windows 更新使用。

来源：[Forge ZIP Maker 文档](https://www.electronforge.io/config/makers/zip)、[Forge ZIP Maker API](https://js.electronforge.io/interfaces/_electron_forge_maker_zip.MakerZIPConfig.html)、[Forge Squirrel.Windows Maker 文档](https://js.electronforge.io/modules/_electron_forge_maker_squirrel.html)。

### 对当前产物的判断

| 发布通道 | 当前/目标产物 | Electron 原生 `autoUpdater` | 结论 |
| --- | --- | --- | --- |
| macOS 安装 | DMG | DMG 不是 Squirrel.Mac 更新 payload | DMG 可做首次安装；还需单独提供 ZIP 和 macOS feed |
| macOS 更新 | Forge ZIP | 可以，但要是签名应用的更新 ZIP，并配套 `RELEASES.json`/兼容 feed | 可行；当前未配置 manifest，不能算已支持 |
| Windows 安装 | 当前 Inno Setup EXE | 官方支持矩阵未包含 Inno | 不能直接接入 |
| Windows 当前 ZIP | Forge 普通 ZIP | 没有安装器/增量包/更新协议 | 不能直接接入 |
| Windows Squirrel（若以后改用 Forge Maker） | Setup.exe + `.nupkg` + `RELEASES` | 原生 `autoUpdater` 支持 | 可行，但会改变当前 Inno 的安装体验和发布资产 |

因此，准确回答是：**可以用于某些 Forge 产物，但不能直接用于当前 Forge 全部产物。** `autoUpdater` 能否工作取决于“平台 + 打包格式 + feed metadata + 签名”，不取决于产物是否由 Forge 这个工具名生成。

### 与 `electron-updater` 的区别

electron-builder 官方文档明确写明：发布、自动更新和代码签名只有在 electron-builder 作为主要构建工具时才是完整支持的能力；Forge 集成只是薄封装，不能把 Forge 的 Maker 自动变成 electron-builder 的发布/更新流水线。electron-updater 的 Windows 简化路径是 NSIS；其目标文档把 Squirrel.Windows 标为不支持，把 portable 标为仅手动更新。

来源：

- [electron-builder：Electron Forge 集成限制](https://www.electron.build/docs/features/electron-forge/)
- [electron-builder：自动更新](https://www.electron.build/docs/features/auto-update/)
- [electron-builder：Targets / 目标格式](https://www.electron.build/docs/targets)
- [electron-updater 官方 README](https://github.com/electron-userland/electron-builder/blob/master/packages/electron-updater/README.md)
- [electron-updater 的 NsisUpdater 源码](https://github.com/electron-userland/electron-builder/blob/master/packages/electron-updater/src/NsisUpdater.ts)

**推断/建议：** 技术上可以自行把 Forge 产物包装成某种兼容 feed，但这属于自建适配层，不应称为“electron-updater 官方支持 Forge 当前产物”。如果想要 electron-updater 的 GitHub Provider、metadata 生成、签名校验和发布管理，应完整迁移到 electron-builder；如果想保留 Forge，应优先使用 Electron 原生 Squirrel 协议，而不是混用两套 metadata。

## 2. macOS DMG/ZIP、Windows Inno Setup/ZIP 的能力与限制

### macOS：DMG 是安装分发格式，ZIP 是更新协议所需格式

Forge 文档把 DMG 描述为 macOS 常用的分享/安装格式，用户打开后把应用拖入 Applications。Forge 还明确说明：如果 DMG 要支持 Electron 自动更新，必须同时构建 ZIP，并按 Squirrel.Mac 的静态更新说明配置。

Squirrel.Mac 的静态 feed 是 JSON；核心字段包括当前版本、版本列表和 `updateTo.url`，URL 直接指向 ZIP；可选 `sha256`、`size`、notes 等信息。它还会检查应用代码签名，更新包会在退出/重新启动的生命周期中应用。

来源：[Forge DMG Maker](https://www.electronforge.io/config/makers/dmg)、[Squirrel.Mac 官方源码/说明](https://github.com/Squirrel/Squirrel.Mac)、[Electron 代码签名](https://www.electronjs.org/docs/latest/tutorial/code-signing)。

**事实：** DMG 本身不能作为 Squirrel.Mac 的更新包；macOS 更新路径需要 ZIP。
**推断/建议：** “下载 ZIP”可以是用户手动获取的归档，也可以是后台更新 payload，但这两种语义不能只靠文件扩展名区分。若要把 ZIP 暴露为用户可运行的便携归档，应明确将其设为手动更新，或为不同分发渠道建立显式标记并完成真实升级测试。

当前 macOS ad-hoc signing 还不足以支持对外可靠承诺。Electron 官方说明 macOS 应用分发应签名并 notarize，`autoUpdater`/Squirrel.Mac 需要签名应用；未签名或仅 ad-hoc 的行为可能不一致。

### Windows：当前 Inno Setup 不是 Squirrel.Windows

Inno Setup 可以生成安装器，但 Electron 原生 `autoUpdater` 的 Windows 传统协议是 Squirrel.Windows。Squirrel.Windows 的发布集合是 Setup.exe、`.nupkg` 和 `RELEASES`，并可能包含 delta `.nupkg`；Inno 的安装目录、UAC、语言和升级语义不等于该协议。

**事实：** 当前 Inno Setup EXE 不能直接作为 Electron 原生 `autoUpdater` 的更新 payload。
**事实：** electron-updater 的 `NsisUpdater` 会寻找并校验 NSIS EXE，并使用 NSIS 参数启动安装器；它不是 Inno updater。
**推断/建议：** 可以另写自定义逻辑下载并运行已签名的 Inno Setup EXE，但这应被设计成“安装器更新流程”，包括用户确认、UAC、进程退出、失败提示、重试和恢复，不应伪装成 `electron-updater` 的格式兼容。

来源：[Electron `autoUpdater` API](https://www.electronjs.org/docs/latest/api/auto-updater)、[electron-updater NsisUpdater 源码](https://github.com/electron-userland/electron-builder/blob/master/packages/electron-updater/src/NsisUpdater.ts)、[Inno Setup 当前脚本](../../assets/inno/serpentsetup.iss#L15-L40)。

### Windows ZIP/portable：当前 Forge ZIP 只是归档

当前 Windows `MakerZIP` 产生的是普通 ZIP；其中没有安装器登记、Squirrel metadata 或 updater helper。electron-builder 的 `portable` target 也明确把自动更新标为 Manual；而当前 Forge ZIP 甚至不是 electron-builder 的 portable target，因此不能从“有一个 ZIP”推导出可安全原地升级。

**推断/建议：** Windows portable 默认只提供手动下载新 ZIP。若未来需要自动更新，应另建 side-by-side 解压/切换 helper：先下载到新目录，校验签名/摘要，关闭旧进程，再切换启动入口；不能覆盖正在运行的目录，也不能假设 USB、网络盘、只读目录或杀毒软件锁定场景一定可写。

## 3. 便携版如何安全区分和处理

这里的“便携版”不能只指扩展名。建议把分发渠道作为构建时和运行时的显式事实：例如在应用资源或安装登记中写入 `distributionChannel` 与 `updateMode`，取值至少区分：

| 渠道 | `updateMode` 建议 | 默认行为 |
| --- | --- | --- |
| macOS DMG 安装 | `mac-native-feed` | 可检查 Squirrel.Mac feed；更新 payload 为签名 ZIP |
| macOS 用户归档 ZIP | `manual`，或单独的已验证更新渠道 | 不做未经验证的原地更新 |
| Windows Inno 安装 | `installer-reinvoke` | 仅走自定义、签名安装器升级流程，或手动下载 |
| Windows Forge ZIP | `manual` | 不调用原生 updater，不覆盖当前目录 |
| Windows Squirrel/NSIS（未来） | 对应协议专用值 | 只调用与该格式匹配的 updater |

**事实：** Electron 更新 API 要求应用是已打包应用；Squirrel 还涉及签名、首次运行和文件锁等平台行为。
来源：[Electron 更新教程](https://www.electronjs.org/docs/latest/tutorial/updates)、[Electron 代码签名](https://www.electronjs.org/docs/latest/tutorial/code-signing)。

**推断/建议：**

- 不要通过文件名、当前工作目录、是否位于 `/Applications` 或 `Program Files` 单独推断安装/便携状态；这些都是可复制、可移动或可被用户改变的路径事实。
- Inno 安装器应写入明确的安装 receipt/marker；portable 包应携带明确的 `manual` marker。macOS 如果 DMG 与用户 ZIP 内是完全相同的 app bundle，就不要声称能可靠识别来源；可把用户 ZIP 定为手动渠道，或为不同渠道生成不同 bundle/安装登记并测试。
- 任何更新器都应只在 `app.isPackaged`、渠道允许、版本更高、传输使用 HTTPS、更新包通过平台签名验证（必要时再做 SHA-256 完整性校验）时工作。
- 更新失败应保留旧版本可启动，用户数据与数据库迁移不能依赖“更新一定成功”。自动更新不等于回滚；如需回滚，要单独设计版本保留和数据迁移恢复策略。

## 4. GitHub Releases 所需 metadata/assets

GitHub 官方把 Release 定义为版本说明和二进制 assets 的发布容器；可以先创建 draft、上传完整资产、检查后再发布。asset 名称应稳定且唯一；GitHub API 返回 asset 的下载 URL、大小、digest 等信息。GitHub 不会根据 DMG/EXE/ZIP 自动生成 Electron feed。

来源：[GitHub Releases 概览](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)、[管理 Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)、[GitHub Releases REST API](https://docs.github.com/en/rest/releases)。

### 路线 A：Electron 原生 `autoUpdater` + Squirrel feed

**macOS：**

- 用户首次安装：`*.dmg`（手动分发）。
- 更新 payload：按架构和版本命名的签名 `*.zip`。
- feed：`RELEASES.json`，或由静态服务器返回兼容的 JSON；其中 `updateTo.url` 必须能稳定指向 ZIP，可包含 `version`、`pub_date`、`notes`、`sha256`、`size`。

**Windows Squirrel：**

- `Serpent Setup.exe` 或等价安装器。
- 版本对应的完整 `*.nupkg`。
- `RELEASES`。
- 可选的 `*-delta.nupkg`；若发布 delta，则 `RELEASES` 必须准确列出它。

Electron 官方的 `update-electron-app` FAQ 对公共更新服务列出的要求就是 macOS ZIP，以及 Windows EXE、`.nupkg` 和 `RELEASES`；缺少必需文件时更新会静默失败。其静态存储布局还要求按 platform/arch 分目录，例如 `darwin/arm64`、`win32/x64`。

来源：[update-electron-app 官方 README/FAQ](https://github.com/electron/update-electron-app)、[Electron 应用更新教程](https://www.electronjs.org/docs/latest/tutorial/updates)。

### 路线 B：electron-builder + electron-updater + GitHub Provider

若完整迁移到 electron-builder，典型 release asset 是：

- macOS：DMG 用于首次安装，ZIP 用于更新，`latest-mac.yml` 描述版本、文件、大小、哈希等。
- Windows：NSIS 安装器 EXE，`latest.yml` 描述更新；按配置可能还有 blockmap/差分相关资产。
- `app-update.yml` 是打包进应用资源中的 updater 配置，不是通常上传到 GitHub Release 的替代品。

electron-updater 的 GitHub Provider 会按 channel 文件名读取 GitHub Release 中的 metadata；因此 `latest.yml`/`latest-mac.yml` 必须和其声明的精确 artifact 在同一发布流程中生成并上传，不能只上传一个新 EXE 或 DMG。构建或发布被配置为 draft 时，公共更新服务/客户端可能看不到它；应在完整资产上传后再发布稳定 Release。

来源：[electron-builder 自动更新](https://www.electron.build/docs/features/auto-update/)、[electron-builder 发布](https://www.electron.build/docs/publish/)、[GitHub Provider 源码](https://github.com/electron-userland/electron-builder/blob/master/packages/electron-updater/src/providers/GitHubProvider.ts)、[electron-builder 排错](https://www.electron.build/docs/troubleshooting)。

### 路线 C：当前 Inno/普通 ZIP + 自定义 updater

- Inno 路线至少需要已签名的 `SerpentSetup.exe`；建议另有由 HTTPS 服务提供的版本 manifest，记录版本、平台、架构、下载 URL、大小和 SHA-256。
- 普通 ZIP 路线至少需要明确的手动下载资产；如果实现 side-by-side updater，还需要自定义 helper 和切换/恢复协议。
- GitHub Release 可以承载这些资产，但客户端不能把 GitHub Release 页面本身当作 `autoUpdater` feed；要么调用受控的 manifest/API，要么使用一个把 GitHub assets 映射为协议 feed 的服务。

**GitHub 公共服务限制：** Electron 维护的 `update.electronjs.org` 要求公共 GitHub 仓库、GitHub Releases 和符合要求的已签名构建；公共服务还要求稳定 SemVer release，且不会把 draft/prerelease 当作普通最新版本。当前仓库已经公开，但现有 Forge/Inno 资产协议和 macOS 签名仍不满足其余前提。私有 GitHub Provider 还涉及把访问 token 放到用户机器，electron-builder 文档明确提示这只适用于特殊场景，不应默认承诺。

来源：[update.electronjs.org README](https://github.com/electron/update.electronjs.org/blob/main/README.md)、[electron-updater GitHub 发布说明](https://www.electron.build/docs/publish/)。

## 5. 推荐的实现架构

### 推荐决策顺序

**第一选择：保留 Forge，采用平台原生且格式匹配的更新协议。**

1. macOS 继续发布 DMG；增加签名/公证的 ZIP 更新资产，并配置 Forge ZIP Maker 生成/维护 `RELEASES.json`。
2. Windows 如果要使用 Electron 原生 `autoUpdater`，将自动更新渠道切换为 Forge Squirrel.Windows Maker，发布 Setup.exe、`.nupkg` 和 `RELEASES`。当前 Inno 安装器可以作为手动或兼容性渠道保留，但不要把它标成原生自动更新渠道。
3. GitHub Releases 可以存放资产；若使用 Electron 的公共 `update.electronjs.org`，先解决仓库公开、代码签名和稳定 SemVer release 的前提。否则使用自有 HTTPS 静态 feed/更新服务，并按 platform/arch/channel 隔离。

**第二选择：Inno 安装体验不可改变时，明确采用自定义安装器更新。**

更新器只负责：获取 manifest → 下载到临时目录 → 校验 HTTPS、版本、签名和完整性 → 请求用户确认 → 退出主应用 → 以适当权限运行 Inno 安装器 → 重新启动并记录结果。它不调用 Squirrel feed，也不依赖 `electron-updater` 的 NSIS 假设。portable ZIP 保持手动更新，除非另行实现经过验证的 side-by-side helper。

**第三选择：明确要求 electron-updater 的 GitHub Provider 时，完整迁移到 electron-builder。**

使用 electron-builder 作为主要构建工具，macOS 采用 DMG+ZIP，Windows 采用 NSIS，交给 builder 生成并发布 `latest-mac.yml`/`latest.yml`。不要只在现有 Forge 配置旁边安装 `electron-updater` 就对外承诺官方支持。

### 运行时分层建议

无论选择哪条路线，更新逻辑应放在 Main 进程，并分成以下边界：

1. `ReleaseChannelResolver`：读取构建时的显式安装/分发 marker，禁止以路径和扩展名猜测。
2. `UpdatePolicy`：判断 packaged、平台、架构、channel、签名状态、网络策略和是否允许自动检查。
3. `UpdateProvider`：Squirrel JSON、Squirrel Windows、electron-updater GitHub Provider 或自定义 manifest 只能选定一种协议；协议之间不共享“看起来像版本号”的裸 URL。
4. `UpdateInstaller`：只执行与当前 marker 匹配的安装动作；下载、校验、退出、安装、重启和失败恢复都要有状态记录。
5. Renderer 只接收状态和用户意图，不直接读写任意更新路径；更新失败要显示平静、可恢复的提示。

## 不应承诺的行为

在没有额外实现和平台证据前，不应对用户承诺：

- “所有 Forge 产物都支持自动更新”。
- “DMG 会被直接用于 macOS 应用内更新”；Squirrel.Mac 更新 payload 是 ZIP。
- “Inno Setup EXE 或任意 ZIP 可以直接接入 `autoUpdater`/`electron-updater`”。
- “Windows portable 会安全地原地覆盖正在运行的目录并自动升级”。
- “只上传新 EXE/DMG，GitHub Releases 会自动产生 `latest.yml`/`RELEASES`”。
- “私有 GitHub 仓库可被普通终端用户无 token 地使用公共更新服务”。
- “ad-hoc/未 notarize 的 macOS 构建能稳定完成自动更新”。
- “SHA-256 sidecar 单独就等于真实性”；完整性校验仍需建立在可信传输和平台签名/可信发布链上。
- “更新不需要用户确认、UAC、退出或重启”，或“更新失败一定能自动回滚”。
- “应用从网络盘、SMB、只读目录、被杀毒软件锁定的目录运行时更新行为与本地安装完全相同”。

## 待产品/发布流程后续决定的事项

这份研究不替代实现前的产品决定；至少还需要明确：

- Windows 是否必须保留当前 Inno 的 per-machine、UAC 和语言选择体验。
- 是否接受引入 Squirrel.Windows，或接受完整迁移到 electron-builder/NSIS。
- GitHub 仓库是否会公开；若不会，feed/metadata 放在哪里，客户端如何匿名访问。
- macOS 的 Developer ID signing、notarization、更新 ZIP 与 DMG 是否在 CI 中稳定生成。
- portable 版是纯手动下载，还是要投入独立的 side-by-side 更新 helper。
- 是否有 stable/beta channel、强制更新、灰度发布和回滚要求。

## 官方来源索引

- [Electron `autoUpdater` API](https://www.electronjs.org/docs/latest/api/auto-updater)
- [Electron 应用更新教程](https://www.electronjs.org/docs/latest/tutorial/updates)
- [Electron 代码签名](https://www.electronjs.org/docs/latest/tutorial/code-signing)
- [Electron Forge Makers](https://www.electronforge.io/config/makers)
- [Electron Forge DMG Maker](https://www.electronforge.io/config/makers/dmg)
- [Electron Forge ZIP Maker](https://www.electronforge.io/config/makers/zip)
- [Electron Forge S3 Publisher](https://www.electronforge.io/config/publishers/s3)
- [Electron Forge Squirrel.Windows Maker API](https://js.electronforge.io/modules/_electron_forge_maker_squirrel.html)
- [Electron Forge ZIP Maker API](https://js.electronforge.io/interfaces/_electron_forge_maker_zip.MakerZIPConfig.html)
- [electron-builder 自动更新](https://www.electron.build/docs/features/auto-update/)
- [electron-builder 的 Electron Forge 集成说明](https://www.electron.build/docs/features/electron-forge/)
- [electron-builder Targets](https://www.electron.build/docs/targets)
- [electron-builder 发布](https://www.electron.build/docs/publish/)
- [electron-updater GitHub Provider 源码](https://github.com/electron-userland/electron-builder/blob/master/packages/electron-updater/src/providers/GitHubProvider.ts)
- [electron-updater NsisUpdater 源码](https://github.com/electron-userland/electron-builder/blob/master/packages/electron-updater/src/NsisUpdater.ts)
- [Squirrel.Mac](https://github.com/Squirrel/Squirrel.Mac)
- [Electron `update-electron-app`](https://github.com/electron/update-electron-app)
- [Electron `update.electronjs.org`](https://github.com/electron/update.electronjs.org/blob/main/README.md)
- [GitHub Releases 概览](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)
- [GitHub Releases 管理](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)
- [GitHub Releases REST API](https://docs.github.com/en/rest/releases)
