# 插件 ZIP 条目 `./` 前缀误判为穿越

日期：2026-08-13

## 问题

Windows 上用 `tar -a -c -f package.zip -C dist .`（GitHub Actions `windows-latest` 的 bsdtar）写出的插件 ZIP，条目名是 `./serpent-plugin.json` 这类相对路径。Host 把 `.` 段直接交给 `pluginPackagePathSchema`，按「absolute or traversing path」拒绝，GitHub 安装失败（`PLUGIN_ARCHIVE_INVALID`）。

`.` 表示当前目录，不是 `..` 穿越，也不是绝对路径。Compress-Archive 还会写出 `dir\\file`。这两类都是 Windows 打包工具的常态，不是攻击载荷。

## 实现

`extractPluginArchive` 在校验前把条目名规范化为相对 POSIX 路径：去掉 `./`、把 `\\` 换成 `/`，仍拒绝 `..`、盘符和绝对路径。包内规范路径（清单 `entry` 等）继续走原来的严格 schema。

## 验证

定向单测：`tests/unit/plugin-package-archive.test.ts`、`tests/unit/plugin-package-manager.test.ts` 中 Windows tar `./` 前缀安装用例。
