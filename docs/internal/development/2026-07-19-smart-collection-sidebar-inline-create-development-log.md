# 2026-07-19 SMART-007 复验：智能合集侧栏原地创建

## 范围

- `Serpent-san`：人类验收 SMART-007 不通过后的复验修复。
- 侧栏「智能合集」旁「+」在列表内打开名称编辑行（对齐文件夹 inline create）。
- 删除发现栏/顶栏智能合集名称输入与保存按钮；创建不再跳转到右上角。

## 实现

- `inline-smart-collection-edit.ts`：create 状态机（blank→cancel、submit、submitting、fail）。
- `use-inline-smart-collection-edit.ts`：提交时快照当前 discovery 定义；无有效条件时行内报错；成功后刷新列表。
- `NavigationSidebar`：智能合集区渲染 inline 行；空列表时创建中不显示 empty hint。
- `App.tsx`：移除 `smartCollectionName` / 顶栏 input+save；`onAddSmartCollection` 打开侧栏会话。

## 验证

- `npx vitest run tests/unit/inline-smart-collection-edit.test.ts`
- `npm run typecheck`

## 验收 ID

- SMART-007 → 待人类验收（见 `docs/internal/qa/human-acceptance-checklist.md`）。

## Serpent-era（2026-07-19 复验不通过后）

人类反馈：应先创建智能合集，再打开设置；不应因缺条件行内报错阻断创建。

### 变更

- Worker `createSmartCollection`：允许草稿查询 `{}`；`updateSmartCollection` 仍要求有意义条件。
- `use-inline-smart-collection-edit`：无搜索/过滤时写入 `EMPTY_SMART_COLLECTION_QUERY_JSON`（`"{}"`）；成功后 `onCreated`。
- 新增 `SmartCollectionSettingsDialog`：改名 / 保存当前条件；创建成功后由 `App` 打开并选中该合集。

### 验证

- `npx vitest run tests/unit/inline-smart-collection-edit.test.ts`
- `npm run typecheck`
