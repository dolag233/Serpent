# 2026-08-01 对话框默认焦点开发记录

> 工单：`Serpent-sxk3`。本记录只覆盖确认/操作对话框的默认焦点行为，不代表 Windows/macOS 人工验收通过。

## 需求与实现

对话框打开后，如果存在可用的主操作按钮，应将焦点放在该按钮，而不是标题栏关闭按钮；因此按 Enter 会立即执行默认操作，Esc 仍由既有对话框关闭栈处理。输入型对话框已有 `autoFocus` 时保留输入框焦点；主按钮禁用时回退到第一个可用控件。

实现位置：`src/renderer/use-dialog-focus-trap.ts`。焦点陷阱在模态范围内优先寻找可用的 `.primary-button` 或提交按钮，再回退到通用可聚焦控件。永久删除 E2E 增加焦点断言，避免只验证按钮存在。

## 当次验证

- `npm run typecheck`：通过。
- `npm run lint -- --quiet`：通过。
- 后台 Electron：`node scripts/run-e2e.mjs tests/e2e/organization-search-trash.test.ts --grep "confirmation dialogs focus their primary action"`：1/1 通过，真实打开回收站永久删除确认窗并断言主按钮获得焦点，Escape 关闭窗口。
- 同文件全量 3 条旧用例复跑：1/3 通过、2 条在既有恢复选择器/标签视图断言处失败；这些失败发生在新增焦点断言之前，未作为本工单通过证据。

## 已知范围

- 真实 Windows/macOS 人工操作、所有对话框逐一验收尚未执行；验收清单保持“待人类验收”。
- 无可用默认操作的纯信息对话框仍按原有第一个可用控件规则聚焦。
