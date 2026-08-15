# 设置中心 QA 报告

> 工单：`Serpent-cr8h`
>
> 代码基线：当前 `HEAD`（相对 `f59914e`）
>
> 环境：macOS 开发态，Node `v24.15.0`，npm `11.12.1`
>
> 日期：2026-07-23

## 自动化结果

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| 设置分类、工具栏路由、Escape、AI UI、删除确认、导入冲突、画布、主题、强调色、投影定向测试 | 10 files / 82 tests 通过 |
| 新增设置模块定向 ESLint | 通过 |
| `npm run lint` | 未通过：既有 9 errors / 2 warnings；设置中心新增模块无诊断 |
| `git diff --check` | 通过 |

定向测试命令：

```text
npm exec vitest run tests/unit/app-settings-sections.test.ts tests/unit/toolbar-commands.test.ts tests/unit/dialog-escape-stack.test.ts tests/unit/ai-ui-preferences.test.ts tests/unit/disk-delete-confirm-preferences.test.ts tests/unit/import-conflict-preferences.test.ts tests/unit/canvas-preferences.test.ts tests/unit/theme-preferences.test.ts tests/unit/accent-preferences.test.ts tests/unit/shadow-preferences.test.ts
```

## 未执行

- 真实 Electron / Computer Use：当前会话没有可调用的 `node_repl` / Computer Use runtime；未截取设置中心的亮暗主题、中英文、窄窗口和键盘 tab 焦点截图。
- 全量 `npm run lint`：当前 9 errors / 2 warnings，涉及既有的 `AiConfigDialog.tsx`、`App.tsx`、`ScopeBreadcrumbs.tsx`、`trash-folder-groups.ts`、`use-ai-connection-failure.ts`、`use-browser-session-restore.ts`、`library-service.ts` 和 `tests/worker/trash-relink.test.ts`；本轮新增设置中心模块的定向 lint 通过。
- packaged app、Windows 与 E2E：本轮仅改 Renderer 设置界面，未执行；不将历史结果作为当前证据。

## 人类验收

已新增 [SETTINGS-003](human-acceptance-checklist.md)；请按该条检查分类切换、AI 跳转、即时保存和窄窗口布局。

## 结论

**有条件通过自动化验证，待人类视觉验收。**
