# Windows 打包与 Squirrel 安装器适配 — 开发日志（2026-08-08）

> 关联：Windows 平台打包（portable + 安装包）、Squirrel 安装器集成、发布管线 release.yml。
> 环境：Windows 11 Pro x64，Node 24.14.0，Electron 43.1.0，Forge 7.11.2。

## 背景

macOS arm64 打包已验证；Windows 打包此前从未在真实 Windows 上执行。本次目标：跑通
`npm run package` + `npm run make`（Squirrel 安装包 + zip portable），并让安装/升级/卸载
全流程健壮可用。

## 修复清单（7 项代码/配置修复）

### 1. ufbx WASM 产物 CRLF 行尾漂移（.gitattributes 新建）

- **现象**：`prepackage` 的 `verify-ufbx-wasm.mjs` 报 ufbx.js SHA-256 不匹配。
- **根因**：`core.autocrlf=true` 且仓库无 `.gitattributes`，checkout 时 git 把
  `resources/ufbx/ufbx.js` 的 LF 转成 CRLF；门禁按字节校验哈希，必然漂移。
  macOS 默认 autocrlf=false，所以 mac 打包未暴露。
- **修复**：新建 `.gitattributes`，`resources/ufbx/* -text`（整个目录禁止行尾转换）。
  所有平台 checkout 后字节与 lock 一致。

### 2. verify-package.mjs 双盘符路径（`E:\E:\...`）

- **现象**：postPackage 的 `verify-package.mjs` 报 ENOENT，路径为 `E:\E:\MyRepositories\...`。
- **根因**：`path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')` ——
  URL `.pathname` 在 Windows 上以盘符开头（`E:/...`），`path.resolve` 拼出双盘符；
  macOS 的 pathname 以 `/` 开头所以正常。
- **修复**：改用 `fileURLToPath(import.meta.url)`。

### 3. verify-package.mjs 声明文件路径过期

- **现象**：`Workspace is missing generated automation declarations`。
- **根因**：`f0578c9` docs 重组把 `automation-api.d.ts` 移到
  `docs/internal/skills/serpent-automation/`，脚本仍查旧路径 `docs/skills/...`。
- **修复**：路径更新为实际位置。

### 4. verify-package.mjs asar 条目路径格式

- **现象**：`asar.extractFile` 报 `"\.vite\build\main.js" was not found`。
- **根因**：Windows 上 `@electron/asar` 的 `listPackage` 返回 `path.join` 风格条目
  （`\.vite\build\main.js`，反斜杠 + 前导分隔符）；库内部按 `path.sep` 遍历，
  需要去掉前导分隔符但**保留**平台分隔符。macOS 返回 `/.vite/build/main.js`。
- **修复**：`mainEntry.replace(/^[\\/]+/u, '')`。

### 5. MakerSquirrel 拒绝 win32（electron-winstaller 缺失）

- **现象**：`Cannot make for win32 and target squirrel: the maker declared that it
  cannot run on win32`。
- **根因**：MakerSquirrel 的 `isSupportedOnCurrentPlatform()` 要求 `electron-winstaller`
  已安装；它不是任何 dependency/peerDependency，是隐式运行时要求。mac 上平台检查
  直接返回 false（非 win32），所以 mac 打包从未暴露。
- **修复**：`npm install --save-dev electron-winstaller@^5.4.4`。

### 6. NuGet "Authors is required"

- **现象**：Squirrel 打包 NuGet nuspec 报 `Authors is required`。
- **根因**：package.json 无 `author` 字段，nuspec `<authors>` 为空。
- **修复**：补 `"author": "dolag233"`。

### 7. media-build 工作目录与 Squirrel 安装目录冲突（win32-x64.ps1）

- **现象**：安装器报 `PathTooLongException`，安装整体失败；错误提示误导
  （"is the app still running???"）。
- **根因**：`scripts/media-build/win32-x64.ps1` 的 vcpkg 工作目录是
  `%LOCALAPPDATA%\Serpent\media-build\win32-x64`——与 Squirrel 安装目录
  `%LOCALAPPDATA%\serpent`（包名，不区分大小写）是同一目录！Squirrel 全量安装
  先删整个目录，vcpkg 构建树（深层长路径）触发 PathTooLongException，删除失败
  → 安装失败。mac 的 `darwin-arm64.sh` 用仓库内 `.media-build/`，无此问题。
- **修复**：工作目录改为 `%LOCALAPPDATA%\SerpentMediaBuild\win32-x64`。

## Squirrel 安装器集成（核心健壮性修复）

### 根因链

1. Serpent 完全不处理 Squirrel 事件（`--squirrel-install/updated/uninstall/obsolete`）。
2. 安装时 Squirrel 运行 `Serpent.exe --squirrel-install` → 应用当普通参数启动整个
   GUI 且不退出 → hook 超时（`OperationCanceledException`，约 18s）→ 快捷方式与
   注册表卸载项全部缺失。
3. 用户无法正常卸载 → 手动删 `%LOCALAPPDATA%\serpent` → 删不干净 → 残留。
4. 下次安装 Squirrel 删目录失败 → 安装整体失败。

### 修复：`src/main/squirrel-events.ts`（新建，零 electron 依赖）

- `squirrelEventFromArgv`：识别四个 Squirrel 事件参数。
- `squirrelCommandFor`：install/updated → `--createShortcut`；uninstall →
  `--removeShortcut`；obsolete → 无操作。
- `runSquirrelHandler`：`spawnSync` 同步调用同级父目录的
  `Update.exe <command> <exe名>`（Squirrel 自带命令，负责开始菜单/桌面快捷方式
  与卸载注册表项），完成后返回。
- `src/main/index.ts` 顶部接入：检测到 Squirrel 事件 → 同步处理 → `app.exit(0)`
  + `process.exit(0)`，**绝不启动 UI**。

单测 `tests/unit/squirrel-events.test.ts` 11 例（事件识别/命令映射/路径/缺失
Update.exe 容错）。

### 安装/升级/卸载实测（真实 Windows）

| 场景 | 结果 |
|---|---|
| 首次安装 | ✅ 快捷方式（开始菜单 `dolag233\Serpent.lnk` + 桌面）创建；注册表卸载项
  `HKCU\...\Uninstall\serpent` 创建；hook 无超时 |
| 重复安装（升级路径） | ✅ ApplyReleases 增量更新，不删目录 |
| 卸载（Update.exe --uninstall） | ✅ 快捷方式/注册表删除、app 文件删除 |
| 卸载残留 | ⚠️ Update.exe + app-0.1.0 少量文件残留——Squirrel.Windows 引擎行为
  （运行中的 Update.exe 不能自删，且不安排延迟清理）；残留无害且重装时
  "burn it to the ground" 能成功删除（无长路径后不再失败） |
| 安装后启动 | ✅ 4 进程正常（Electron 多进程） |

## 环境性记录（非代码问题）

- **GitHub 直连超时**（`connect ETIMEDOUT 20.205.243.166:443`）：`@electron/get` 在
  缓存命中后仍强制联网拉取 `SHASUMS256.txt` 校验（`cacheMode: Bypass`）。本机网络
  下需 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`。
- **EBUSY 瞬时锁**：Defender 实时扫描锁定刚写入的 exe，重试即可通过。
- **打包产物进程锁 out 目录**：运行中的 `out\Serpent-win32-x64\Serpent.exe` 会锁
  out 目录导致 Forge 无法重建，打包前先结束残留实例。

## 安装器方案升级：Squirrel → WiX MSI（同日追加）

### 产品反馈（3 项）

1. 安装后 Windows 任务栏/程序列表出现 Electron 默认图标。
2. Squirrel 无安装向导、无法选择安装路径、卸载无弹窗。
3. Squirrel 的绿色 loadingGif 动图。

### 修复

- **setAppUserModelId 缺失**（问题 1 根因之一）：main 启动时（win32）
  `app.setAppUserModelId("com.serpent.app")`，与 WiX 快捷方式 AUMID 一致，
  任务栏图标/分组/固定恢复正常。
- **安装器替换为 WiX MSI**（问题 2/3，产品拍板）：`@electron-forge/maker-wix`。
  - `ui.chooseDirectory: true` → 向导含安装路径选择页（实测静默安装
    `APPLICATIONROOTDIRECTORY=D:\SerpentTest` 成功）。
  - `defaultInstallMode: "perUser"` → 免管理员（perMachine 需 UAC，暂不需要）。
  - `upgradeCode` 固定 → 后续版本覆盖升级（实测重装 exit 0）。
  - 无 Squirrel loadingGif；MSI 用 Windows 标准进度/完成 UI。
- **移除 Squirrel**：MakerSquirrel、electron-winstaller、squirrel-events.ts 及其
  测试、index.ts 接入全部删除。
- **checksums 适配**：`DISTRIBUTABLE_EXTENSIONS` 增加 `.msi`。

### WiX 工具集依赖（环境）

electron-wix-msi 从 PATH 找 candle.exe/light.exe（WiX 3.x）。本机安装方式
（免管理员，国内网络）：从 NuGet 中国节点下载解压到
`%LOCALAPPDATA%\SerpentTools\wix314\tools`，打包前加入 PATH：
`https://nuget.azure.cn/v3-flatcontainer/wix/3.14.1/wix.3.14.1.nupkg`

### 实测结果（真实 Windows）

| 场景 | 结果 |
|---|---|
| MSI 构建（candle/light 3.14.1.8722） | ✅ |
| 静默安装自定义路径（D:\SerpentTest） | ✅ exit 0 |
| 快捷方式（开始菜单 + 桌面） | ✅ |
| 注册表卸载项（InstallPath 正确） | ✅ |
| 启动冒烟 | ✅ |
| 覆盖重装（升级路径） | ✅ exit 0 |
| 卸载（msiexec /x） | ✅ **目录/快捷方式/注册表全部清除**（对比 Squirrel 残留彻底解决） |

## WiX MSI 回退 → Inno Setup（同日追加）

### 回退原因（产品需求：安装时可选语言，默认系统语言）

- MSI 的 UI 语言在安装进程启动时锁定，运行时切换需自定义 bootstrapper
  （WiX 社区确认，见 SO 讨论）；electron-wix-msi 不支持自定义主模板，
  注入 Type 50 重启动作需后处理且体验差（UAC 二次弹窗）。
- 调研结论：**NSIS / Inno Setup 内置多语言选择**（安装时语言选择 + 系统
  语言自动检测），是 Electron 生态成熟做法（electron-builder 的
  installerLanguages/displayLanguageSelector；VS Code 用 Inno Setup）。
- 决策：**Inno Setup**（用户确认，VS Code 同款），WiX 全部回退。

### 回退内容

- forge.config.ts：MakerWix 移除（Windows 暂只产 zip/portable）
- 删除：assets/wix/（ui.xml + WixUI_en-US/zh-CN.wxl）、
  scripts/wix-msi-language-inject.mjs、scripts/wix-bootstrapper/（C# BA 工程）
- package.json：@electron-forge/maker-wix 移除
- 保留（与 WiX 无关的成果）：.gitattributes（ufbx 行尾）、verify-package.mjs
  三处修复、media-build 撞名修复、setAppUserModelId、checksums 的 .msi 扩展

### 遗留（Inno Setup 接入待办）

- Inno Setup 工具获取（nuget Tools.InnoSetup 或官方安装，免管理员优先）
- code.iss 风格脚本（参考 VS Code build/win32/code.iss 多语言配置）：
  [Languages] 简体中文 + 英文，安装时语言选择，默认系统语言
- 安装向导（路径选择、开始菜单、快捷方式、卸载器 unins000.exe）
- 构建集成（Forge postMake 或独立 script）+ 验证

### 其他待办

- 发布阻断仍在：媒体 bundle 未 promote 到不可变 HTTPS + checksum pin。
- Windows 单测 5 例失败为既有 POSIX 路径假设（/Users vs E:\），非本任务引入。
