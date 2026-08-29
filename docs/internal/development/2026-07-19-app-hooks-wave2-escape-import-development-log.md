# 2026-07-19 App 拆分 Wave 2（Escape + 外部导入）开发日志

工单：`Serpent-uye`（仍 `in_progress`）

## 范围

继续拆 `App.tsx`：Escape 对话框栈、桌面拖入/剪贴板导入执行器，并抽出可单测的纯优先级与共享 transfer 工具。

## 实现

1. `dialog-escape-stack.ts` + `use-dialog-escape-dismiss.ts`：Escape 关闭优先级纯函数 + document 监听。
2. `use-external-import-handlers.ts`：`importDropped` / `pasteClipboardImage` 与 canvas 外部 drop chrome。
3. `import-summary.ts`、`external-import-transfer.ts`：从 App 底部抽出；`NavigationSidebar` 改为共用 transfer 助手。
4. `tests/unit/dialog-escape-stack.test.ts`：优先级与 abandon-import 分支。

## 度量

| 项 | Wave 1 后 | Wave 2 后 |
| --- | --- | --- |
| `App.tsx` 行数 | 7237 | 6986 |

## 测试

```bash
npm run typecheck
npx eslint src/renderer/App.tsx src/renderer/NavigationSidebar.tsx \
  src/renderer/dialog-escape-stack.ts \
  src/renderer/use-dialog-escape-dismiss.ts \
  src/renderer/use-external-import-handlers.ts \
  src/renderer/import-summary.ts \
  src/renderer/external-import-transfer.ts --max-warnings 0
node scripts/run-vitest-with-electron.mjs \
  tests/unit/dialog-escape-stack.test.ts \
  tests/unit/asset-drag-drop.test.ts
```

Computer Use：未执行（架构拆分，无新用户可见路径）。

## 人类验收

无新增 HA 项。

## 残留

- `Serpent-uye`：metadata multi-edit、workspace restore、selection Escape 等仍在 App。
- Ready 可编码：`Serpent-vpk`（真隔离 E2E，需副屏/CI/独立会话）；澄清 `hrw`/`w3b` 跳过。
