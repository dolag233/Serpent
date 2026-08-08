# UI 标准化阶段 3：领域 surfaces 与 Plugin UI Contract 接入日志

> 日期：2026-08-04
> 工单：`Serpent-ex46.5`、`Serpent-ex46.6`、`Serpent-fyl5`
> 设计基线：[0029 UI 标准化执行方案与插件原生 UI 契约](../implementation/0029-ui-standardization-execution-and-plugin-ui-contract.md)

## 本次增量

- 新增 `ShellSurface`、`PaneSurface`、`CardSurface`、`ViewerSurface`，只负责结构语义、隔离和 token 化基础边界，不吞并领域状态。
- FolderCard、InspectorPanel、AssetPreviewModal 已通过 adapter 使用共享 surface；资产/文件夹/媒体的业务行为保持独立。
- NavigationSidebar、CanvasToolbarControls、WorkspaceToolsOverflow 已迁移到共享 Pane/Shell/Menu surface；原有导航、命令和关闭行为保持独立。
- 新增版本化 `contributes.ui` descriptor：settings group、menu/submenu、notice、activity、job；schema 拒绝函数、HTML、CSS、未知字段和超限节点。
- descriptor 解析提供字段级诊断；Host renderer 复用 `Field`、`Switch`、`Select`、`Slider`、`SettingsCard`、`MenuSurface`、`Notice`、`Activity`、`StatusBadge`。
- descriptor 已接入插件设置页的分组渲染和实际右键菜单：菜单命令解析到已注册 command contribution 后仍走现有 invocation/context/权限路径。
- 新增 Host Theme Profile v2：`vscode-dark`、`serpent-dark`、`serpent-light`、`soft-light`；用户 color override 叠加在 profile 之后，插件 iframe 继续通过 revision 感知主题变化。
- 新增版本化应用背景偏好：安全本地栅格图片、背景色、cover/contain/tile 和 overlay opacity；图片限 4 MiB，拒绝 SVG/远程 URL/脚本，并在根壳层统一绘制。配置背景时核心导航、工作区表面使用受控透明度，让背景确实可见；无背景时维持原有不透明布局。
- 主题组合抽为纯函数，覆盖 profile → mode custom override → explicit accent 的优先级，并对主题/背景 storage 读取异常做安全回退；预设选择支持标准 radio 键盘导航。
- 功能对话框继续迁移到 `DialogShell`：AppLog、AI 连接失败、合集编辑、创建/导入/删除/移动/恢复/重命名、序列帧、库设置、合集规则、忽略路径、媒体任务、许可证、插件信任、脚本预览、冲突、插件安装、标签确认和 Relink。
- 复用菜单/浮层结构：LibrarySwitcher、SortModeControl、DimensionFilterBar、ViewerContextMenu、MainMenu、ContextMenu 接入 `MenuSurface`/`PopoverSurface` 壳；保留各自定位、二级菜单、上下文和键盘控制器。

## 四列追溯

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 领域结构 surface 复用 | `src/renderer/ui/surfaces/index.tsx`；`FolderCard.tsx`；`InspectorPanel.tsx`；`AssetPreviewModal.tsx` | `tests/unit/ui-surfaces.test.ts` | 真实浏览/查看器视觉、Computer Use、packaged 未执行 |
| 主题 profile 与应用背景 | `src/renderer/theme/theme-profiles.ts`；`theme-composition.ts`；`background-preferences.ts`；`ThemeProvider.tsx` | `tests/unit/theme-profiles.test.ts`；`tests/unit/background-preferences.test.ts` | 真实主题切换、背景图片桌面视觉、packaged 未执行 |
| Dialog/Menu/Popover 迁移 | `src/renderer/ui/patterns/dialog.tsx`、`menu.tsx`；上述 Dialog/菜单组件 | `tests/unit/ui-patterns.test.ts`；`tests/unit/plugin-menu-contributions.test.ts`；相关组件单测 | 真实焦点、键盘、定位和跨平台视觉未执行 |
| descriptor schema 与字段级诊断 | `src/shared/plugin-ui-descriptor.ts` | `tests/unit/plugin-ui-descriptor.test.ts` | fixture/IPC 级单测；真实插件 E2E 未执行 |
| Host 原生 settings/menu renderer | `src/renderer/plugin-ui-descriptor-renderer.tsx`；`plugin-host-settings-fields.tsx`；`plugin-settings-detail.tsx`；`plugin-menu-contributions.ts` | `tests/unit/plugin-ui-descriptor.test.ts`；`tests/unit/plugin-menu-contributions.test.ts` | 真实插件设置/右键菜单未执行 |

## 验证

已通过：

```bash
npx vitest run tests/unit/plugin-ui-descriptor.test.ts tests/unit/plugin-menu-contributions.test.ts tests/unit/plugin-contract.test.ts tests/unit/plugin-manager-response-parse.test.ts tests/unit/ui-surfaces.test.ts --reporter=dot
npm run typecheck
npx eslint src/renderer/plugin-menu-contributions.ts src/renderer/plugin-ui-descriptor-renderer.tsx src/renderer/plugin-host-settings-fields.tsx src/renderer/plugin-settings-detail.tsx tests/unit/plugin-ui-descriptor.test.ts
git diff --check
```

本次增量已通过定向主题/背景/Pattern/插件菜单测试、`npm run lint`、`npm run typecheck`、`git diff --check`；完整 `npm run test`：328 个测试文件通过、3 个跳过，2852 个测试通过、8 个跳过。Electron E2E、packaged/Windows 和 Computer Use 尚未执行；本日志不把自动化通过写成完整视觉验收。

## 尚未覆盖

- descriptor 的运行时 notice/activity/job 需要接入统一 Host activity surface 和 Job 状态订阅；
- Canvas、Navigation、更多 Card/Viewer/媒体控制和少数特殊语义 Dialog（About/Fatal Alert）仍需按迁移矩阵继续收口；
- ContextMenu/MainMenu 的完整节点渲染树和 menu placement 的全量原生菜单树仍需收口；真实焦点/键盘和多库 packaged 证据也未补齐；
- 完整主题 profile 导入/导出、背景图片真实桌面验收和旧 CSS/class 全量清理。
