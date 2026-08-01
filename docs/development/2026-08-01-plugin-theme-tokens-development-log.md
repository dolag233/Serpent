# PLUGIN-032：插件主题 token 包开发日志

> 日期：2026-08-01  
> 工单：`Serpent-upsn.9`（主题切片；模板/打包/最终 QA 仍开放）

## 范围

- Manifest 可选 `contributes.themes[]`：bounded light/dark CSS variable token 覆盖（仅允许 Host 设计 token 白名单）。
- Host 通过既有 `plugin-ui.theme` postMessage 将 Host token + 插件覆盖合并后下发 sandboxed iframe。
- `theme.trusted-css` 权限在信任对话框与插件设置页显示单独警告；标准插件不能向宿主 DOM 注入任意 CSS（本切片不实现宿主 CSS 注入机制，仅披露边界）。
- 扩展 `iframe-workspace-probe` fixture 与定向单测。

## 四列追溯（开发态）

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| `contributes.themes` bounded schema | `src/plugins/plugin-manifest.ts`；`src/plugins/plugin-themes.ts` | `tests/unit/plugin-themes.test.ts` | 待人类验收：`PLUGIN-032` |
| Host token + 插件覆盖合并后经 `plugin-ui.theme` 下发 iframe | `src/renderer/plugin-iframe-view-host.tsx`；`src/main/plugin-activation-coordinator.ts` | `tests/unit/plugin-themes.test.ts`；`tests/unit/plugin-ui.test.ts` | 待人类验收：`PLUGIN-032` |
| `theme.trusted-css` 信任/设置披露 | `src/renderer/PluginTrustPromptDialog.tsx`；`src/renderer/PluginSettingsPage.tsx`；i18n | `tests/unit/plugin-themes.test.ts`（权限检测） | 待人类验收：`PLUGIN-032` |
| iframe-workspace-probe 主题覆盖探针 | `tests/fixtures/plugins/iframe-workspace-probe/` | `tests/unit/plugin-themes.test.ts` | 待人类验收：`PLUGIN-032` |

## 验证

```bash
npx tsc --noEmit
npx vitest run tests/unit/plugin-themes.test.ts tests/unit/plugin-ui.test.ts
```

真实 Electron、亮暗切换 live 验证、packaged/Windows/Computer Use 未执行。

## 未覆盖（仍属 `Serpent-upsn.9`）

- 插件开发模板与校验工具（`Serpent-8csl`）
- 可信插件实际向宿主 DOM 注入 CSS 的运行时机制
- packaged macOS/Windows 与最终主线 QA
