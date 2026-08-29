# 2026-07-18 工具栏导入迁出与溢出（Serpent-2d0）

## 实现

- `LibrarySwitcher`「添加与传输」：导入文件/文件夹、粘贴图片、链接文件夹、导出库、导入库、导入 ZIP
- 工作区常驻栏仅保留刷新 + 视图/字段；扩展 / 后台任务 / AI 进入 `WorkspaceToolsOverflow`「更多工具」
- 去掉 `.workspace-tools` 的 `overflow-x: auto` 静默裁切

## 验收

CANVAS-013

## 关联

Serpent-ak0：F2 重命名快捷键（COMMAND-002）；剩余视图按钮注册表另开 P3。
