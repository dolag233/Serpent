# 本地 CICD（2026-08-09 决策：放弃 GitHub Actions 主仓库 CI）

> 背景：主仓库的 GitHub Actions CI 在 2026-08-09 多轮修复后仍无法稳定：
> electronjs.org headers 网络、Windows runner 上 Electron E2E 环境性全挂
> （app-log 证明 main 进程在 runner 上硬崩溃，同样代码本地 51 passed）。
> 产品负责人决策：**主仓库不再使用 GitHub Actions**，全部验证走本地。
> 浏览器扩展仓库（Serpent-Extension）的 CI/Release workflow 保留（发布通道，
> 工作正常）。

## 本地验证流水线（Windows / macOS 各自平台执行）

开发提交前至少跑：

```bash
npm run lint && npm run typecheck        # 静态
npm run test:unit                        # 单元（node 环境）
npm run test:worker                      # worker（Electron 环境）
```

任何资源库相关修改（打开/关闭/迁移/schema/损坏恢复/切库）还必须完整跑完：

```bash
npm run test:library-availability
```

功能提交（跨进程/大改动）加：

```bash
npm run test:perf:search                 # 10 万资产搜索门禁（约 2 分钟）
npm run test:e2e                         # 全套 E2E（约 20-30 分钟）
```

发布前全流程（等价旧 release pipeline）：

```bash
npm run release:local                    # verify → media → package → e2e → make → checksums
# 或分步：release:verify / release:media / release:package /
#        release:e2e:packaged / release:make / release:checksums
# Windows 安装器在 release:make 阶段自动串联 make:inno（ISCC）
```

**注意事项**：

- **E2E 期间不要操作鼠标/键盘**：Playwright 断言对 hover 状态、焦点、
  窗口位置敏感，真实鼠标移到应用窗口会改变测试预期（2026-08-09 实测，
  本地 E2E 全程无人操作才可信）。
- **打包后必须恢复 dev native 模块**：`npm run package / make` 会更新
  `node_modules/electron`，跑完执行 `npm run rebuild:native`（否则
  `npm run test` 报 better_sqlite3 NODE_MODULE_VERSION 不匹配）。
- **平台职责**：Windows 产物在 Windows 验证，macOS 产物在 macOS 验证
  （平台门禁 `nativeMediaPlatform` 拒绝交叉打包）；发布前双平台各自
  跑一遍 `release:local`。

## 双平台发布分工（无 GA 后）

| 平台 | 执行者 | 命令 |
|---|---|---|
| Windows | 任一 Windows 开发者 | `npm run release:local` |
| macOS | 任一 macOS 开发者 | `npm run release:local` |

产物：`out/Serpent-<platform>-<arch>/`、`out/make/`（dmg / zip /
SerpentSetup.exe）、`SHA256SUMS-<platform>.txt`。

## 发布步骤（主仓库，无 GA 后）

1. `npm version patch|minor|major`（版本提升 + git tag）
2. 各平台跑 `npm run release:local`（产物在 `out/make/`）
3. 在 GitHub 手动创建 Release（tag 对应）并上传产物：
   `out/make/` 下的 dmg / zip / SerpentSetup.exe + `SHA256SUMS-<platform>.txt`
   （参照 Serpent-Build 的 media 上传先例 `scripts/release/publish-media-bundle.mjs`）

## 与 Serpent-Extension 的关系

浏览器扩展（`dolag233/Serpent-Extension`）仍用 GitHub Actions：
- `ci.yml`：main/PR 的 lint/typecheck/build
- `release.yml`：打 `v*` tag → 构建 zip → 上传 Release

主仓库原 `.github/workflows/release.yml`（tag 驱动发布）已随 GA 一并移除，
发布走上面的本地流程。

## 历史（档案）

- 2026-08-09 之前的 `.github/workflows/ci.yml`（macos-15 / windows-2022
  matrix）的修复记录见 `docs/internal/development/2026-08-09-ci-e2e-handoff.md`
  与本文件；`ELECTRON_MIRROR`/`NODEJS_ORG_MIRROR` 经验保留在 CLAUDE.md
  （本地 `npm ci`/rebuild 遇 electronjs.org 网络问题时同样适用）。
