# UI 标准化阶段 2：Primitive、Theme Profile 与 Feedback Pattern 开发日志

> 日期：2026-08-04
> 工单：`Serpent-ex46.3`、`Serpent-ex46.4`
> 设计基线：[0029 UI 标准化执行方案与插件原生 UI 契约](../implementation/0029-ui-standardization-execution-and-plugin-ui-contract.md)

## 本次增量

- 新增共享 `Slider` primitive，复用 Field/ARIA/禁用/加载/错误/主题状态；应用设置的阴影与亚克力滑块、画布卡片尺寸和序列查看器 scrubber 已迁移到该 primitive。
- 插件设置新增 `slider` 类型，贯通 Manifest 校验、默认值/范围/step、设置存储、贡献注册、IPC、Renderer Host 和开发文档。
- 新增 `PopoverSurface`、`SettingsCard`、`Notice`、`Activity`、`StatusBadge` patterns；所有 pattern 使用语义 token、ARIA/live region 和命名 UI layer。
- 全局通知和插件 Job 活动条改用共享 feedback pattern，保留现有业务回调与退出动画，并将状态色、层级、进度显示收口到 UI 契约。
- 新增用户自定义主题 profile v1：只允许有界 `--ui-*` 颜色 token，切换 mode 会先清理旧 inline override，不能改变布局、字体或 z-index；外观设置已提供常用颜色覆盖编辑器与清除入口。

## 四列追溯

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| Slider 统一控件状态与 ARIA | `src/renderer/ui/primitives/Slider.tsx`；`src/renderer/ui/ui.css` | `tests/unit/ui-primitives.test.ts` | 设置页、画布、序列查看器真实视觉未执行 |
| 插件 slider 设置 | `src/plugins/plugin-manifest.ts`；`src/main/plugin-package-ipc.ts`；`src/renderer/plugin-host-settings-fields.tsx` | `tests/unit/plugin-contract.test.ts`；`tests/unit/plugin-manager-response-parse.test.ts`；插件 settings 回归集合 | 真实插件设置页视觉未执行 |
| Notice/Activity/Popover/Settings patterns | `src/renderer/ui/patterns/` | `tests/unit/ui-feedback-patterns.test.ts`；`tests/unit/ui-patterns.test.ts` | Computer Use、真实焦点/层级未执行 |
| 用户主题 profile v1 | `src/renderer/theme/custom-theme.ts`；`src/renderer/theme/ThemeProvider.tsx`；`src/renderer/AppSettingsPages.tsx` | `tests/unit/custom-theme.test.ts` | 真实亮暗切换未执行 |

## 验证

```bash
npx vitest run tests/unit/ui-patterns.test.ts tests/unit/ui-feedback-patterns.test.ts tests/unit/custom-theme.test.ts --reporter=dot
npx vitest run tests/unit/plugin-contract.test.ts tests/unit/plugin-contributions.test.ts tests/unit/plugin-settings-sections.test.ts tests/unit/plugin-manager-response-parse.test.ts tests/unit/ui-primitives.test.ts --reporter=dot
npm run typecheck
npx eslint <changed renderer/plugin files>
git diff --check
```

结果：本阶段定向测试通过；`npm run typecheck`、`npm run lint` 和 `git diff --check` 通过。首次全量测试因 `better-sqlite3` 原生模块 ABI 与当前 Node 不匹配而失败，按仓库规定执行 `npx @electron/rebuild -f -w better-sqlite3` 后重跑 `npm run test` 成功：324 个测试文件通过、3 个跳过；2827 个测试通过、8 个跳过。Electron E2E、packaged/Windows/Computer Use 尚未执行。

## 仍未覆盖

- 全量领域 UI 迁移与旧 CSS/class 审计；
- 用户主题 profile 的完整 token 导入/导出界面；
- Settings/Menu/Notice/Activity 的插件 descriptor v1 与 SDK；
- 独立最终审查、Computer Use 和 packaged QA。
