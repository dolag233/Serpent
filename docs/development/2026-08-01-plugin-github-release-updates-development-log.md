# 2026-08-01 插件 GitHub Release 分发与自动更新

## 范围

一次性落地产品约定：安装通道为 **GitHub / ZIP / 文件夹**；GitHub 优先匹配平台 Release asset；支持更新提示与可选自动更新（含风险确认）。源码目录 npm（`Serpent-x9ci`）明确不做。

工单：`Serpent-u3nx`、`Serpent-8r91`。

## 实现摘要

| 区域 | 变更 |
| --- | --- |
| 规范 | [`docs/plugin-distribution-and-updates.md`](../plugin-distribution-and-updates.md)；0024 / ADR-0026 / 开发指南 / project-status 对齐 |
| 平台与命名 | `src/plugins/plugin-release-asset.ts`：`{pluginId}-{version}-{platformToken}.zip`，精确平台后回退 `any` |
| URL | `src/shared/plugin-github-url.ts`：仓库根与 `/releases` / `/releases/tag/...` / `latest` |
| GitHub 客户端 | Release `listReleases` + `downloadReleaseAsset`；无规范 asset 时 zipball 成品回退 |
| Package Manager | `installFromGitHub` Release 优先；`findGitHubAvailableUpdate` / `applyGitHubUpdateForLock` / auto-update 偏好与 `applyEligibleGitHubAutoUpdates` |
| IPC / UI | `update-github`、`set-auto-update`；设置页显示可用更新、手动更新、自动更新勾选前 `confirm` 风险文案 |
| 设备态 | `plugin-device-state.json` 增加 `updatePreferences` |

## 自动化证据

```text
npx vitest run tests/unit/plugin-release-asset.test.ts \
  tests/unit/plugin-package-manager.test.ts \
  tests/unit/plugin-package-ipc.test.ts
# 28 passed
npx tsc --noEmit -p tsconfig.json
# exit 0
```

## 验收

清单 `PLUGIN-037`（自动化口径）。packaged / Windows / Computer Use / 真实 GitHub 网络旅程未执行。

## 非目标

- 源码目录现场 `npm install` / `build`
- SHA256SUMS 强制校验（后续增强）
- `upsn.9` 打包最终 QA
