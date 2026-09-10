# Windows 本地插件安装只能选文件夹（GitHub #19）

## 问题

https://github.com/dolag233/Serpent/issues/19：设置 → 插件 → 高级安装 → 本地安装，在 Windows 上原生选择器只能选文件夹，选不了插件 ZIP。

## 根因

Electron 在 Windows 上不能把 `openFile` 和 `openDirectory` 写进同一个 `showOpenDialog`。当前 `selectPluginPackage` 两者并用，Windows 会退化成只能选文件夹。macOS 可以混用，所以这个问题在 Windows 上才稳定复现。

导入/导出已经按来源拆成独立选择器；本地插件安装没有跟那套走。

## 修复

高级安装拆成三个入口：

- 「安装 ZIP」：`openFile` + zip filter
- 「安装文件夹」：`openDirectory`
- 「从 GitHub 安装」不变

`plugin-manager.install-local` 增加必填 `sourceKind: "zip" | "folder"`。E2E 仍用 `SERPENT_E2E_PLUGIN_PACKAGE` 注入路径，但点击改为「安装文件夹」。

## 验证

- `tests/unit/native-dialog-i18n.test.ts`：ZIP / 文件夹规格互斥
- `tests/unit/plugin-package-ipc.test.ts`：`chooseLocalPackage` 带上 `sourceKind`
- `tests/unit/plugin-install-failure-detail.test.ts` / `plugin-settings-sections.test.ts`：请求补 `sourceKind`
- `npx tsc --noEmit` 通过
- `node scripts/run-e2e.mjs tests/e2e/plugin-management.test.ts`：1 passed

Computer Use / packaged 未执行。验收清单 `PLUGIN-053`。工单 `Serpent-1dc3c5`。
