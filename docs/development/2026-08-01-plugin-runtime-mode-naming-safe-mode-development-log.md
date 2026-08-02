# 2026-08-01 插件运行时档位命名与安全模式收窄

工单：`Serpent-n34b` · 清单：`PLUGIN-036`（并同步 `PLUGIN-001`–`003` 文案）

## 产品决定

- 对用户弃用「标准/可信运行时」档位名：`standard` → **受限模式**；`trusted` → **无限制模式**（警告色 + 风险提示）。
- 「信任 / 不信任」安装决策与运行时档位分离。
- 安全模式只停用无限制（`trusted`）插件；受限（`standard`）可继续运行。

## 本切片实现

| 区域 | 变更 |
| --- | --- |
| i18n | `en.ts` / `zh-CN.ts` 运行时与 Safe Mode 说明改写 |
| UI | `PluginSettingsPage` / `PluginTrustPromptDialog` 无限制档位使用 `plugin-runtime-mode-unrestricted*` |
| Resolve | `PluginPackageManager.#resolvedOrAwaitingTrust`：仅 `safeMode && mode === 'trusted'` → `disabled/safe-mode` |
| Activate | `PluginActivationCoordinator.refreshLibrary`：去掉「安全模式停用整库」早退；缺席 desired 的 trusted 以 `safe-mode` 停用 |
| Wire 枚举 | 仍为 `standard` / `trusted`；清单字段改名（`restricted` / `unrestricted`）与读入迁移另开跟进 |

## 自动化证据

```text
npx vitest run tests/unit/plugin-package-manager.test.ts tests/unit/plugin-activation-coordinator.test.ts
# Test Files  2 passed (2) · Tests  18 passed (18)

npx tsc --noEmit
# exit 0
```

未执行：真实 Electron 设置页开关旅程、完整进程重启、packaged、Windows、Computer Use。

## 未完

- Manifest/API 枚举从 `standard`/`trusted` 迁到 `restricted`/`unrestricted`（含兼容映射）。
- 设置页 E2E 断言文案与 Safe Mode 行为差分（受限仍激活 / 无限制停用）。
