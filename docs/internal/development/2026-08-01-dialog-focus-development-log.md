# 对话框默认焦点与 Enter/Esc 开发记录

> 工单：`Serpent-sxk3`、`Serpent-xdmu`。本记录只覆盖确认/操作对话框的默认焦点与键盘契约，不代表 Windows/macOS 人工验收通过。

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

## 2026-08-04 Enter/Esc 批量审计（Serpent-xdmu）

### 统一契约

- 所有由 App 管理的 modal 继续由 `useDialogEscapeDismiss` 按栈顺序处理 Esc；最上层之外的对话框不会响应关闭键。
- `useDialogFocusTrap` 现在同时负责最上层 modal 的 Enter 默认操作：输入框中按 Enter 会点击第一个可用的显式默认按钮、`.primary-button` 或提交按钮。
- 多行文本、复选框/单选框、按钮、链接和 contenteditable 不会被宿主的默认动作抢键；单行输入、`select` 与滑块可以提交默认动作。没有可用默认按钮的纯信息窗口按 Enter 无动作。
- 标签管理的本地删除/合并确认窗也接入同一焦点与 Enter 处理；库设置的名称输入不再维护一套独立 Enter handler，避免重复提交。

### 盘点结果

已检查 `src/renderer` 中全部 `role="dialog"` / `aria-modal="true"` 表面：确认、导入冲突、移动/恢复、序列帧、设置、插件信任、脚本预览、任务、信息与标签管理窗口。默认操作均由显式 `primary-button` / submit 语义识别；App 栈已覆盖的 Esc 关闭路径保持不变，Smart Collection 与 Tag Management 的局部路径纳入统一焦点控制。

### 当次验证

- `npx eslint src/renderer/ui/patterns/dialog.tsx src/renderer/use-dialog-focus-trap.ts src/renderer/LibrarySettingsDialog.tsx src/renderer/TagManagementWorkspace.tsx tests/unit/ui-patterns.test.ts`：通过。
- `npm run typecheck -- --pretty false`：通过（主工程与 extension）。
- `npx vitest run tests/unit/ui-patterns.test.ts tests/unit/dialog-escape-stack.test.ts --reporter=dot`：2 个文件、19 个测试通过。
- Electron E2E：后台运行 `node scripts/run-e2e-isolated.mjs tests/e2e/organization-search-trash.test.ts --grep 'organizes, finds'`；测试已通过智能合集设置的输入框 Enter 路径，随后在既有回收站导航步骤 `organization-search-trash.test.ts:275` 等待「回收站」按钮超时，最终 1 条失败。该失败发生在新增键盘路径之后，不能作为整条旅程通过证据。

### 已知范围

- 真实 Windows/macOS 人工操作、所有对话框逐一验收尚未执行；验收清单仍保持「待人类验收」。
