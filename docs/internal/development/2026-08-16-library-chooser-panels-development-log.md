# 2026-08-16 打开/导入资源库选择面板（Serpent-pte2）

## 范围

产品裁决：缩短资源库菜单。

- 「打开资源库」打开选择面板：已有 Serpent 库 + 可展开的打开外部库（Eagle、Billfish 均可用）。
- 「导入资源库」打开选择面板：文件夹 / ZIP + 可展开的第三方库。有库时走导入合并；无库起始页仍走打开并转换。
- 菜单不再单列「打开外部资源库」「导入外部资源库」。
- 菜单「新建资源库」只出现名称表单，不带打开/导入按钮。
- 无库起始创建面板保持原状（仍有打开/导入）。

## 实现

- `src/renderer/LibraryChooserDialog.tsx`：打开/导入两块面板共用展开按钮样式。
- `LibrarySwitcher` / `main-menu-items` / macOS `application-menu`：去掉外部库二级菜单行。
- `CreateDialog`：`required=false` 时隐藏起始页打开/导入 CTA；菜单创建直接进入 `form`。

## 验证

定向单测覆盖菜单顺序、打开/导入面板展开、菜单新建表单不含打开/导入。壳层 E2E 断言改为点「打开资源库」出现选择面板。2026-08-16 用户确认 `Serpent-pte2` 通过（LIB-014 / SHELL-004）。随后 Billfish 入口取消置灰，见 [Billfish 接线日志](2026-08-16-billfish-library-import-development-log.md)。

## 2026-08-16 菜单微调（Serpent-7zp0）

用户点名：

1. 「打开同步资源库」从资源库名称菜单挪进「打开资源库」选择面板（与打开 Serpent / 打开外部库并列）。
2. 资源库菜单不再列出同步入口。
3. 删除「重命名资源库」菜单项（Windows 主菜单、macOS 应用菜单、左上角名称菜单一并去掉）。改名仍在资源库设置。

验收见 LIB-020；LIB-019 菜单入口已撤回。
