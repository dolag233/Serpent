# 2026-07-18 CU-M4 查看页入口可发现（Serpent-tid）

## 范围

右键菜单与命令注册表补齐「查看」入口；双击打开查看页此前已可用。

## 实现

- `asset.view` 注册到 `asset-commands`（open 分组顶部，Enter 快捷键提示）
- `AssetContextMenu` 渲染「查看」并接到 `openAssetPreview`
- i18n：`command.asset.view`（中/英）
- 单测：`tests/unit/asset-commands.test.ts`

## 验收

人类清单 **VIEWER-008** 待验收。

## 未覆盖

Windows 菜单文案与快捷键展示未在本机验证。
