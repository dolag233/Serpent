# 2026-09-08 批量重命名插件开发日志

> 覆盖工单 `Serpent-0da7b7`。实现官方插件仓库 `Serpent-Plugin-Renamer`，并为插件对话框补充可复用的 Host 标准多列列表控件。当前状态：自动化测试完成，等待用户验收。

## 实现

- 插件在资产右键菜单注册“批量重命名”，只在选中资产时显示，并使用 `assets.renameFiles` 写回文件名。
- 命名规则包括前缀、后缀、字符串替换；字符串替换可切换区分大小写和正则匹配，扩展名保持不变，文件名冲突由 Host 返回并以 warning 通知。
- 对话框通过 `serpent.ui.openDialog` 组合 Host widget，输入变化会实时重建预览；预览超过 500 项时只展示前 500 项，提交仍处理全部选中资产。提交按钮文案为“应用”。
- Host 的 `ui.list` 支持可滚动、交替行背景、长文本换行和匹配/改动高亮；`ui.toggle` 提供紧凑的二态按钮，插件不携带自有 CSS。
- 命令触发快照携带 `invocation.app.locale`，插件按中文或英文显示对话框、通知和操作说明；菜单按同一 locale 显示中文/英文标题，使用 Host 的 `edit` 图标并紧跟在原生重命名菜单项后。

## 验证

- `Serpent-Plugin-Renamer`: `npm test`（9/9）、`npm run check`（通过）。
- Serpent: `npx vitest run --config vitest.config.ts tests/unit/plugin-widget-dialog.test.ts tests/unit/plugin-contract.test.ts tests/unit/plugin-context.test.ts tests/unit/plugin-menu-contributions.test.ts`（66/66）、`npm run typecheck`（通过）。
- `npm run package:release` 已验证可生成平台无关 ZIP；验证后删除了本次生成的 `out/` 临时产物。
- 全量 `npm test` 复跑未作为本功能绿灯：沿用的 `desktop-ingestion` Windows 路径断言与 `reconciliation-performance` 事件循环门禁各有失败，随后还有无关测试 worker 超时；本次改动以定向 Host 测试为准，未修改这些基线问题。

## 待验收

- 真实 Serpent 窗口中的右键入口、双语切换、替换高亮、长文件名换行和冲突提示需用户验收；本次未执行 packaged/Windows 视觉验收。
