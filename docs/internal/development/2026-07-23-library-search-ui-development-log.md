# 资源库搜索栏收敛

> 工单：`Serpent-45io`
>
> 状态：qa / 待人类复验
>
> 日期：2026-07-23

## 目标

产品反馈右上角同时出现 AI 搜索、长占位提示、提交按钮、搜索状态 chip 与 AI 计划摘要，难以辨认主要搜索入口。将其收敛为一个标准搜索框，同时保留普通搜索、AI 搜索与一键清除的既有行为。

## 实现

- 输入框左侧使用放大镜，普通模式提示缩短为「搜索资源库…」。
- AI 模式移入输入框右侧的星芒图标；启用后提示为「描述想找的内容…」，其用途仍可通过悬停提示读取。
- 输入框使用原生 `search` 类型，按 Enter 提交；有输入时保留框内 × 清除。
- 移除重复显示当前查询的状态 chip 与技术性的 AI 搜索计划摘要，并清理其不再需要的状态、生成逻辑与翻译文案。

## 自动化记录

- `npm run typecheck`：通过。
- `npm exec vitest run tests/unit/ai-search-planner.test.ts tests/unit/search-expression.test.ts tests/unit/toolbar-commands.test.ts`：3 files / 30 tests 通过。
- 设置改动相关的 ESLint 无新增问题；全仓 `App.tsx` 仍有既有的 1 error / 2 warnings，位于 AI 连接心跳 effect 和两个既有 hook 依赖项，未归因于本增量。
- `git diff --check`：通过。

## 人工 UX 证据

当前会话没有可调用的桌面 Computer Use runtime，未对 Electron 实例进行视觉操作。`SEARCH-005` 保持人类验收不通过，等待产品负责人按清单复验。

## 四列可追溯

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 单一标准搜索框与短占位 | `App.tsx`、`styles.css`、中英文 catalog | typecheck、搜索相关 30 tests | SEARCH-005 人类复验待定 |
| AI 模式与清除行为保留 | `App.tsx` | `ai-search-planner.test.ts`、`search-expression.test.ts` | SEARCH-005 人类复验待定 |
