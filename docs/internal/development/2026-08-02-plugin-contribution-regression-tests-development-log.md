# 2026-08-02 插件贡献解析与启动激活回归测试

## 范围

工单 `Serpent-l2tj`：拦住 Image Upscaler 菜单/`settings.pages` 长期空白的三层回归（instanceId 过滤、启动恢复未 `onLibraryOpened`、Zod 4 多 `kind:view` Duplicate discriminator）。

## 交付

1. **单测** `tests/unit/plugin-manager-response-parse.test.ts`：五个 view target（`sidebar.entries` / `workspace.views` / `inspector.views` / `viewer.overlays` / `settings.pages`）各自解析；混合数组含全部 view + `menus.asset`。
2. **IPC** `tests/unit/plugin-package-ipc.test.ts`：`list-contributions` 为 `settings.pages` 注入 `serpent-plugin://` url 后，经 `parsePluginManagerResponse` 仍保留。
3. **E2E** `tests/e2e/plugin-unrestricted-settings-pages.test.ts`：安装/启用 `tests/fixtures/plugins/unrestricted-settings-probe/`（补齐 `README.md` / `LICENSE`），断言 `menus.asset` + `settings.pages`（含 iframe，非「该插件暂无设置页」）；`SERPENT_E2E_RESTORE_RECENT=1` 完整关进程再开，最近库恢复后贡献仍可用。
4. 清单：`PLUGIN-009` / `PLUGIN-020` 证据列更新。

## 验证

```text
npx vitest run tests/unit/plugin-manager-response-parse.test.ts \
  tests/unit/plugin-package-ipc.test.ts \
  tests/unit/plugin-activation-coordinator.test.ts
# 3 files / 27 tests passed

npx playwright test tests/e2e/plugin-unrestricted-settings-pages.test.ts --reporter=line
# 1 passed (约 7.2s)
```

未执行：packaged、Windows、Computer Use、故意破坏 Zod/跳过 `onLibraryOpened` 的负向 CI 钩子（正向回归已覆盖失败模式对应路径）。

## 相关

- 根因与产品修复见 [插件设置 IA 开发日志](./2026-08-01-plugin-settings-ui-ia-development-log.md)。
- 全局插件不应依赖开库：`Serpent-2qsq`（未实施）。
