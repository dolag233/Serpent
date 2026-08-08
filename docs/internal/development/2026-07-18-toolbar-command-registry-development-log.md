# 2026-07-18 工具栏视图/工具接入命令注册表（Serpent-2rk）

## 范围

Serpent-ak0 收尾：把工作区常驻画布控件与「更多工具」溢出项接入 `toolbar-commands` 注册表，与菜单表面同一套 `CommandDefinition` / `createCommandRegistry` 模式。导入/导出仍只在资源库菜单（Serpent-2d0），本轮不迁回工具栏。

## 实现

- 新模块 `src/renderer/commands/toolbar-commands.ts`
  - 常驻：`canvas.refresh` / `canvas.view.grid` / `canvas.view.masonry` / `canvas.field.{name,size,date}`
  - 溢出：`workspace.browser-extension` / `workspace.background-jobs` / `workspace.ai-settings`
  - `run` 经 `ToolbarCommandActions` 回调包委托 App；无库时隐藏后台任务与 AI；刷新在无库/busy 时 `disabledReason`
- 新组件 `src/renderer/CanvasToolbarControls.tsx`：按钮 label/disabled/onClick 均按 id 解析注册表；导出 `runToolbarCommand` / `toolbarCommandRegistry` 供后续命令盘或快捷键路径复用
- `App.tsx` 去掉内联视图/字段/溢出 handler，改为注入 actions
- 标题复用既有 `toolbar.*` i18n；新增 `command.reason.noLibrary` / `busy`

## 未做

- 未为视图/字段/溢出项分配快捷键（产品未指定；命令盘 UI 尚不存在）
- 缩略图尺寸滑块仍为连续控件，不进离散命令表
- 导入类命令不注册进工具栏表（避免回退 2d0）

## 测试

- `tests/unit/toolbar-commands.test.ts`：可见性、禁用、双语标题、run 委托、`runToolbarCommand` 守卫

## 验收

COMMAND-003

## 关联

- Serpent-ak0（F2 / COMMAND-002）
- Serpent-2d0（导入迁出 / CANVAS-013）
