# UI 标准化阶段 3：领域 surfaces 与 Plugin UI Contract 接入日志

> 日期：2026-08-04
> 工单：`Serpent-ex46.5`、`Serpent-ex46.6`、`Serpent-fyl5`
> 设计基线：[0029 UI 标准化执行方案与插件原生 UI 契约](../implementation/0029-ui-standardization-execution-and-plugin-ui-contract.md)

## 本次增量

- 新增 `ShellSurface`、`PaneSurface`、`CardSurface`、`ViewerSurface`，只负责结构语义、隔离和 token 化基础边界，不吞并领域状态。
- FolderCard、InspectorPanel、AssetPreviewModal 已通过 adapter 使用共享 surface；资产/文件夹/媒体的业务行为保持独立。
- 新增版本化 `contributes.ui` descriptor：settings group、menu/submenu、notice、activity、job；schema 拒绝函数、HTML、CSS、未知字段和超限节点。
- descriptor 解析提供字段级诊断；Host renderer 复用 `Field`、`Switch`、`Select`、`Slider`、`SettingsCard`、`MenuSurface`、`Notice`、`Activity`、`StatusBadge`。
- descriptor 已接入插件设置页的分组渲染和实际右键菜单：菜单命令解析到已注册 command contribution 后仍走现有 invocation/context/权限路径。

## 四列追溯

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 领域结构 surface 复用 | `src/renderer/ui/surfaces/index.tsx`；`FolderCard.tsx`；`InspectorPanel.tsx`；`AssetPreviewModal.tsx` | `tests/unit/ui-surfaces.test.ts` | 真实浏览/查看器视觉、Computer Use、packaged 未执行 |
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

最终合并状态已通过 `npm run lint`；`npm run test` 通过 326 个测试文件、跳过 3 个，2836 个测试通过、跳过 8 个。Electron E2E、packaged/Windows 和 Computer Use 尚未执行；本日志不把自动化通过写成完整视觉验收。

## 尚未覆盖

- descriptor 的运行时 notice/activity/job 需要接入统一 Host activity surface 和 Job 状态订阅；
- Canvas、Navigation、更多 Card/Viewer/媒体控制仍需按迁移矩阵继续收口；
- menu placement 的全量原生菜单树、真实焦点/键盘和多库 packaged 证据；
- 完整主题 profile 导入/导出和旧 CSS/class 清理。
