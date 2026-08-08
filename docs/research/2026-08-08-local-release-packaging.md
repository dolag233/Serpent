# 本地自动打包研究：release 构建 + 安装包封装（macOS / Windows）

> 日期：2026-08-08
> 关联：Serpent-rp7m（首版正式化）、Serpent-d112（发布前质量收口）、CLAUDE.md 环境约束
> 目标：研究「本地自动打包」的现状、缺口与方案——产出 release 版本软件（build + package）并封装安装包（make），覆盖 Windows 与 macOS。

## 1. 现状盘点（已存在的基础设施）

### 1.1 打包工具链（Electron Forge 7.11.2）

`forge.config.ts` 已配置：

| 项 | 现状 |
|---|---|
| 平台门禁 | `nativeMediaPlatform` 强制**原生平台构建**（白名单 `darwin-arm64` / `win32-x64`），交叉打包被显式拒绝——media 二进制/ufbx/native 模块都是平台相关，不能跨平台打包 |
| makers | **Squirrel**（Windows 安装包：Setup.exe + RELEASES + .nupkg）、**DMG**（macOS 安装包）、**ZIP**（darwin/win32 通用包） |
| hooks | prePackage/postPackage/preMake 全链路门禁：`media-binaries.mjs verify --platform` + `verify-package.mjs`（校验 ASAR、better_sqlite3.node、ufbx WASM、media 产物） |
| packager | asar + unpack（trash 原生模块）、extraResource（media 二进制/图标）、Vite 多入口（main/preload/offscreen/worker/脚本运行时） |

### 1.2 发布流水线（`scripts/release/pipeline.mjs`，已存在）

npm scripts 已注册，一键全流程：

```
release:local  =  verify → media → package → e2e → make → checksums
  verify       rebuild:native + verify:mainline（与 CI 相同门禁）
  media        media:acquire（HTTPS bundle-lock 下载）+ media:verify
  package      electron-forge package + verify:package
  e2e          test:e2e:packaged（对打包产物跑启动测试）
  make         electron-forge make（生成安装包）
  checksums    out/make 产物 SHA-256 manifest
```

Flags：`--skip-verify` / `--skip-media` / `--skip-e2e` / `--build-media-locally`。

### 1.3 版本与产物

- `package.json` version = `0.1.0`（硬编码，无版本提升机制）
- 产物：`out/Serpent-<platform>-<arch>/`（package）、`out/make/`（dmg/squirrel/zip + checksums）

### 1.4 media 二进制晋升门禁（2026-08-08 实测发现）

- `resources/media-binaries/bundle-lock.json` 存在，但两个平台均为 `status: build-required`——**从未晋升**（无不可变 HTTPS URL + checksum）
- 后果：`prepackage` 的 `media-binaries verify` 门禁直接失败 → **当前 `npm run package` / `release:local` 均被阻断**
- 本机 `resources/ffmpeg/darwin-arm64`（50M）+ `resources/oiio/darwin-arm64`（23M）有 2026-07-26 构建的旧产物，但**未接入 bundle-lock 晋升机制**（verify 只看 lock）
- 本地试跑路径（pipeline 文档明示）：`npm run release:local -- --skip-verify --build-media-locally`——但 `scripts/media-build/darwin-arm64.sh` 是完整 vcpkg 构建（clone vcpkg → bootstrap → 编译 ffmpeg/oiio，**耗时以小时计**），不复用旧产物

## 2. 缺口分析

### 2.0 🔴 media 二进制未晋升（当前最先遇到的阻断）

本地跑 `release:package` 实测：prepackage 门禁抛 `Media bundle darwin-arm64 is not promoted for release`。**在晋升之前，正式流水线（不含 `--build-media-locally`）无法运行**。晋升 = 构建 ZIP + manifest 哈希 + 不可变 HTTPS URL 写入 `resources/media-binaries/bundle-lock.json`（status=ready）。本地开发试跑只能走 vcpkg 全量构建。

### 2.1 🔴 macOS 签名 + 公证（发布阻断）

- **完全缺失**：forge.config 无 `osxSign` / `osxNotarize`；本机 `security find-identity` 返回 **0 个签名身份**，`notarytool` 不可用（仅 CommandLineTools，无完整 Xcode）
- 影响：未签名/未公证的 .app 与 .dmg 在 macOS Gatekeeper 下被拦截（"无法验证开发者"），用户无法正常安装——**发布必需**，不是可选项
- 需要：Apple Developer 账号（$99/年）→ Developer ID Application 证书 + App Store Connect API key（公证用 notarytool）；或至少 ad-hoc 签名（内部试用，不能对外分发）

### 2.2 🔴 Windows 打包从未验证（CLAUDE.md 显式未验证项）

- win32-x64 在平台白名单内，Squirrel maker 已配置，但**从未在 Windows 上跑过**（无 Windows 机器/runner）
- 流水线是平台无关的（pipeline.mjs 通用）——**Windows 机器上跑 `npm run release:local` 即可**，但以下未验证：Squirrel Setup.exe 生成、RELEASES 清单、nupkg、Windows 安装/卸载旅程、Windows 上 media binaries acquire/verify
- Windows 签名：需代码签名证书（EV/OV，费用另计）——Squirrel 未签名会被 SmartScreen 拦截

### 2.3 🟡 版本号管理缺失

- 0.1.0 硬编码——发布版号提升（`npm version` / git tag / checksum manifest 关联）没有机制

### 2.4 🟡 CI/CD 未接入（下一阶段）

- `release:verify` 阶段设计为"与 CI 相同门禁"——GitHub Actions runner（macos-latest / windows-latest）可直接复用同一 pipeline；当前无 .github/workflows

## 3. 方案设计

### 3.1 macOS 本地一键打包（当前可做）

```bash
npm run release:local            # 全流程（verify+media+package+e2e+make+checksums）
# 或跳过慢阶段：
npm run release:local -- --skip-e2e
```

**签名公证接入（等证书就绪后）**：forge.config 补 `osxSign`（identity 从环境变量/Keychain 取）+ `osxNotarize`（API key 环境变量）；本机需完整 Xcode（notarytool）或 `xcrun notarytool` 路径。

### 3.2 Windows 打包（需要 Windows 原生环境）

平台门禁已保证不能交叉打包——**方案**：
1. **Windows 机器/VM 本地跑**：`npm ci` + `npm run release:local`（同一流水线）——产出 Setup.exe/RELEASES/nupkg
2. **CI runner（推荐，与 rp7m 合流）**：GitHub Actions `windows-latest` runner 跑同一 pipeline + 上传产物为 release asset
3. 两者都需要先做一次**手工 Windows 验证旅程**（安装/卸载/升级），把结果记入 CLAUDE.md 平台约束

### 3.3 版本管理

- `npm version patch/minor/major` 提升 + git tag（`v0.1.1`）→ checksum manifest 文件名/内容带版本号
- make 产物命名建议含版本（当前 Squirrel/DMG 用 package.json version ✓——只需提升机制）

### 3.4 实施顺序建议

| 步骤 | 内容 | 依赖 |
|---|---|---|
| 1 | macOS 本地跑通 `release:local` 全流程（本机验证——除签名） | 无 |
| 2 | 版本提升机制（npm version + tag + manifest 关联） | 1 |
| 3 | Apple Developer 证书 + 签名公证接入（osxSign/osxNotarize） | 证书（外部购买） |
| 4 | Windows 环境（机器或 CI runner）跑通 release:local + 手工安装卸载验证 | Windows 环境 |
| 5 | GitHub Actions matrix（macos/windows）正式化 CI/CD（rp7m） | 1-4 |

## 4. 结论

**本地自动打包的核心流水线已存在**（release:local：build→package→安装包→校验→checksums），非从零建设。真正缺口是**发布级能力**：
- macOS 签名公证（阻断，需 Apple 证书）
- Windows 原生环境验证（阻断，需 Windows 机器/CI）
- 版本管理（需机制）
- CI/CD 自动化（下一阶段，复用同一 pipeline）

建议先做步骤 1（本机全流程验证）与 2（版本机制），同时启动证书/Windows 环境的准备工作。

## 5. 外部开源项目实践调研（2026-08-08，三个并行 agent）

### 5.1 ffmpeg/大二进制分发：GitHub Release 附件，不用 LFS（实证）

- **生态共识**：BtbN/FFmpeg-Builds（每日 Actions 构建 → Release 附件 + `checksums.sha256`，不可变日期 tag）、gyan.dev（自建主站 + GitHub Release 镜像双通道）、eugeneware/ffmpeg-static（56 个平台附件挂 Release）——**均无 LFS**（`.gitattributes` 实测 404）
- **LFS 否决理由**（GitHub API/文档实证）：免费配额 **10 GiB 存储 + 10 GiB 带宽/月**（按账户计，fork/CI 下载都消耗）；Serpent 场景 CI 每月 ~30 次构建 × 150MB ≈ 5-9 GiB 带宽——**极易打爆，超限当月整账户 LFS 禁用**（zig-gamedev#4 真实教训）；Release 附件**无带宽限制**（单文件 <2GiB）
- **供应链锚点替代 LFS**：Release 附件用**不可变版本/日期 tag + 仓库内提交的 sha256 校验文件**锁定（BtbN `checksums.sha256` 范式）——零配额成本，达到与 LFS OID 同等的不可变校验
- **建议方案**：内部工具链独立仓库（构建 ffmpeg/oiiotool，每批次 release 附件 + checksums，不可变 tag）→ 主仓库 `tools/versions.json` 记录版本 + sha256 → 打包脚本按平台从固定 tag 下载校验后内嵌进安装包（复用 ufbx-wasm-lock 先例）。oiiotool 无现成构建源，需工具链仓库自建 CI 构建

### 5.2 Electron 开源项目发布流程（Joplin/Zettlr/MarkText/GDevelop/Beekeeper）

- **共性**：tag 驱动发布（推 v* tag 触发）、按平台 matrix 并行构建、**先 draft release 再转正式**、SHA256SUMS.txt（Zettlr/MarkText）或 latest*.yml 内嵌校验（Joplin/GDevelop）
- **签名铁律**：只签正式版（Joplin `SIGN_APPLICATION=1` 仅 tag 构建）；云签名避免私钥进 CI（SSL.com eSigner ×2、Azure OIDC ×1、GCP KMS+jsign ×1）
- **MarkText = 无签名发布范本**（与 Serpent 现状最接近）：完全不签名，release notes 引导 macOS 用户 `xattr -cr`，Windows SmartScreen 手动放行，发 SHA256SUMS
- **Zettlr = 条件公证范本**（与我们同为 electron-forge）：`osxNotarize` 仅在 `APPLE_ID` 环境变量存在时启用——拿证书后只加 secret 即升级，代码零改动

### 5.3 免费签名渠道（实证）

- **Windows：SignPath Foundation**（唯一真正免费）：MIT ✅ + 公开仓库 + CI 构建 + GitHub 组织全员 2FA + 无付费版；人工审批 1-2 周，可能因 star/声誉不足被拒；**VSCodium**（Electron，~3 万 star）在 Actions 里用 `signpath/github-action-submit-signing-request` 签名——最接近的先例。Azure Trusted Signing 付费（$9.99/月）且 Public Trust 对中国主体不开放；Certum 开源计划已收费化（29-69€/年 + 智能卡）
- **macOS：无免费 Developer ID**（$99/年是唯一消除警告路径）；**免费底线 = ad-hoc 签名**——Apple Silicon 上完全不签名会报"已损坏"无法启动；VSCodium macOS 至今未签名，README 引导"右键→打开"
- **未签名发布现实**：VSCodium/Joplin/MarkText 均为先例；产品影响：首发用户（设计师）首次启动安全弹窗摩擦伤转化

## 6. 综合建议（Serpent 具体路径）

| 项 | 建议 | 依据 |
|---|---|---|
| ffmpeg/oiiotool 分发 | **GitHub Release 附件 + 不可变 tag + git 锁 sha256**（不用 LFS） | 5.1 配额实证 |
| 构建源 | 独立工具链仓库（自建 CI 构建 oiiotool；ffmpeg 可参考 BtbN 或上游） | 5.1 |
| 发布流水线 | 保留现有 release:local + 接入 CI：tag 驱动 → matrix → draft→正式 → SHA256SUMS 强制 | 5.2 |
| 签名（当前） | macOS ad-hoc（Apple Silicon 必需）+ release notes 引导 `xattr -cr`；Windows 未签名 + SmartScreen 引导 | 5.3 |
| 签名（正式版） | Windows 申请 SignPath（尽早提交，审批 1-2 周）；macOS $99/年 Developer ID + 公证（Zettlr 条件模式，加 secret 即升级） | 5.3 + 5.2 |
| 版本 | 已实施：npm version + tag + pipeline 版本输出 + checksum 版本头 | — |
| 扩展 | 已实施：extraResource 内嵌 dist/extension（手动加载） | — |
