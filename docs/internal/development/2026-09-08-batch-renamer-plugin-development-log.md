# 2026-09-08 批量重命名插件开发日志

> 覆盖工单 `Serpent-0da7b7`。实现官方插件仓库 `Serpent-Plugin-Renamer`，并为插件对话框补充可复用的 Host 标准多列列表控件。当前状态：自动化测试完成，等待用户验收。

## 实现

- 插件在资产右键菜单注册“批量重命名”，只在选中资产时显示，并使用 `assets.renameFiles` 写回文件名。
- 命名规则包括前缀、后缀、关键词替换、正则匹配替换；扩展名保持不变，文件名冲突由 Host 返回并以 warning 通知。
- 对话框通过 `serpent.ui.openDialog` 组合 Host widget，输入变化会实时重建预览；预览超过 500 项时只展示前 500 项，提交仍处理全部选中资产。
- Host 新增 `ui.list({ columns, rows, emptyText })`，提供可滚动、交替行背景、长文本省略与悬停完整内容的统一列表样式，插件不携带自有 CSS。

## 验证

- `Serpent-Plugin-Renamer`: `npm test`（7/7）、`npm run check`（通过）。
- Serpent: `npx vitest run --config vitest.config.ts tests/unit/plugin-widget-dialog.test.ts`（11/11）、`npm run typecheck`（通过）、`npm run lint`（通过）。
- `npm run package:release` 已验证可生成平台无关 ZIP；验证后删除了本次生成的 `out/` 临时产物。
- 全量 `npm test` 复跑未作为本功能绿灯：沿用的 `desktop-ingestion` Windows 路径断言与 `reconciliation-performance` 事件循环门禁各有失败，随后还有无关测试 worker 超时；本次改动以定向 Host 测试为准，未修改这些基线问题。

## 待验收

- 真实 Serpent 窗口中的右键入口、输入联动预览、长文件名悬停和冲突提示需用户验收；本次未执行 packaged/Windows 视觉验收。
