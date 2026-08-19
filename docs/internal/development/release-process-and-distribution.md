# Serpent 发布与分发手册

> 发布负责人（人或 agent）按本手册执行从版本号到 release 资产上线的全流程。
> 首次发布验证：v0.1.0（2026-08-15）、v0.1.1（2026-08-18）。

## 1. 版本号

- `package.json` 与 `package-lock.json` 的 `version` 同步修改（两处：顶层 + `packages[""]`），提交消息 `chore(release): 版本号 x.y.z → x.y.z+1`。
- 版本提交先落在 dev，随发布合并进 main（main 是发布基线，见 §2）。

## 2. 分支与代码基线

- **main = 发布分支**：只含完整软件代码库（`src` / `tests` / `resources` / `scripts` / `assets` / 产品文档 `docs/user-guide`、`docs/manual`、`docs/assets`、`README`、`website` 等）。开发文件（`.beads/`、`.codex/`、`.cursor/`、`AGENTS.md`、`CLAUDE.md`、`CONTEXT.md`、`docs/internal/`、`docs/developer/`、`benchmark.md`）只存在于 dev。main 剥离动作见历史提交 `3d6474fc`（strip dev-only files）与对应恢复提交 `b4ca9b98`。
- **打包在 dev 分支进行**：`verify-package.mjs` 要求 `docs/internal/skills/serpent-automation/automation-api.d.ts`（从 `src/automation/command-registry.ts` 生成、随 dev 提交），main 剥离该目录后无法通过发布门禁。发布前核对代码一致性：
  ```bash
  git diff main dev --stat -- src/ tests/ package.json package-lock.json   # 应为空
  ```
- 测试必须完整合入 main（`tests/` 是产品证据）。

## 3. 打包流程

优先用发布管线（本机构建，禁止交叉平台打包——`forge.config.ts` 的 `nativeMediaPlatform` 强制 `darwin-arm64` / `win32-x64` 本机）：

```bash
npm run release:verify     # rebuild:native + verify:mainline（CI 同款门禁）
npm run release:media      # media:acquire + media:verify
npm run release:package    # package + verify:package
npm run release:e2e        # test:e2e:packaged（针对打包产物）
npm run release:make       # electron-forge make（ZIP + DMG）
npm run release:checksums  # out/make/SHA256SUMS-<platform>.txt
```

或一键 `npm run release:local`（可带 `--skip-verify` / `--skip-media` / `--skip-e2e` / `--build-media-locally`，后者仅本地试用）。

发布门禁（package/make 阶段自动执行，不可跳过）：
- `scripts/media-binaries.mjs verify`（媒体二进制哈希，`--platform <target>`）
- `scripts/build-extension.mjs`（浏览器扩展随包重建）
- `scripts/verify-package.mjs`（ASAR 内容、`better_sqlite3.node`、ufbx WASM 哈希、自动化声明 `automation-api.d.ts` 版本与 Registry 一致）
- `scripts/verify-ufbx-wasm.mjs`（prepackage/premake 内嵌校验，缺失即失败并给出构建指引）

**打包完成后必须恢复 dev 环境**：

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

每个产物配套 SHA-256 文件：`shasum -a 256 <file> | awk '{print $1}' > <file>.sha256`。

Windows 安装器（Inno Setup，2026-08-08 决策替代 WiX MSI）：
- `npm run make:inno`（`scripts/inno-build.mjs` + `assets/inno/serpentsetup.iss`），需先 `npm run package`；支持安装时语言选择（中/英）、per-machine 路径、干净卸载。
- Inno 工具获取：NuGet `Tools.InnoSetup` 或官方安装，免管理员优先。

## 5. Changelog 规范

- **中英双语**：中文在前、英文在后，标题 `**Serpent <版本>** — <一句话主题> · <English one-liner>`。
- **按重要程度排序**：新功能 > 性能/可靠性 > 错误提示 > 其他。
- 重要功能逐条详细描述（中英对照条目，说明用户价值）；**UI 修改、简单 bug 修复用概括语句**（如「优化了若干 UI」「修复了若干稳定性问题」），不逐一列举。
- 写好后保存为 `release-notes-<ver>.md`，`gh release create --notes-file` 使用。

参考：[v0.1.1 release notes](https://github.com/dolag233/Serpent/releases/tag/v0.1.1)（WebDAV 同步、外部资源库、数据恢复、性能、错误提示的写法与排序）。

## 6. Release 创建与上传

```bash
# 创建（target 指向发布分支 main）
gh release create v<ver> --title "Serpent <ver>" --notes-file release-notes-<ver>.md --target main

# 上传资产（macOS 4 个：dmg/portable + 各自 sha256；Windows 同模式）
gh release upload v<ver> \
  Serpent-darwin-arm64-<ver>-package.dmg Serpent-darwin-arm64-<ver>-package.dmg.sha256 \
  Serpent-darwin-arm64-<ver>-portable.zip Serpent-darwin-arm64-<ver>-portable.zip.sha256
```

发布后核对 release 页：标题、notes、资产齐全、`--target main` 正确。

## 7. 平台注意事项

**Windows 真机（打包与验收）**：
- GitHub 直连不稳定时：`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`。
- 打包前结束残留 `out\Serpent-win32-x64\Serpent.exe` 实例（进程锁 out 目录导致 Forge 无法重建）。
- Defender 实时扫描可能瞬时锁刚写入的 exe（EBUSY），重试即可。
- 安装器验收：语言选择、安装路径、快捷方式、注册表卸载项、覆盖升级、卸载干净。

**macOS**：
- 打包产物 `.app` 不能从 SMB/NAS 路径运行，先复制到本地 APFS。
- 用户测试临时产物（out/、test-results/）用后清理。

## 8. 发布检查清单

- [ ] 版本号已改（package.json + lock，提交）
- [ ] dev 与 main 的 `src/ tests/ package.json` 一致；main 无开发文件（`.beads`/`CLAUDE.md`/`AGENTS.md`/`docs/internal` 等）
- [ ] 全部发布门禁通过（media verify / verify-package / ufbx WASM）
- [ ] 产物按规范名重命名 + sha256 齐备
- [ ] Changelog 中英双语、按重要度排序、次要改动概括
- [ ] `gh release create --target main` + 资产上传成功
- [ ] `npm run rebuild:native` 已恢复 dev 环境（FTS5 probe OK）
