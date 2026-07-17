# 0015-I18N 开发日志 — 渲染层本地化模块（第一增量）

> 工单：`Serpent-9cg`（REQ-I18N-001）
> 分支：`codex/slice-002-asset-ingestion`
> 日期：2026-07-18
> 状态：部分实现（基础设施 + 壳层 + 命令注册表）；其余 UI 文案仍硬编码，后续增量继续迁入 catalogs。

## 范围

- 新建独立模块 `src/renderer/i18n/`：`types` / `locale-preferences` / `LocaleProvider` / `catalogs/{zh-CN,en}`。
- 默认语言 **zh-CN**（澄清队列 #11 未裁决「跟随系统 vs 首次选择」；当前默认保持与既有中文 UI / E2E 一致）。
- 资源库菜单增加语言切换（简体中文 / English），偏好写入 `localStorage`（`serpent.locale-prefs.v1`）。
- 已迁入翻译键：`LibrarySwitcher`、`ScopeHistoryButtons`、`ScopeBreadcrumbs`、全部命令注册表标题与禁用原因（单资产 / 多资产 / 侧栏）。

## 验证

- `npm run typecheck`：通过
- 相关单测：`i18n-translate` + `scope-breadcrumbs` + `asset-commands` + `asset-multi-commands` + `sidebar-commands` + `command-registry` → **136 passed**

## 第二增量（2026-07-18 loop tick）

- 对话框面全部迁入 i18n：Create/Rename/Import/Export/Move/Restore/UndoMove/Conflicts/ConvertLinked/CollectionEditor/LinkedRules/MediaJobs/ExtensionPairing/AiConfig/PermanentDelete/DeleteLinked/RelinkPreview。
- NavigationSidebar、InspectorPanel、FilterTagPicker、TagPickerMenu、batch-tag-notice、error-utils、trashed-from-label、inline-folder-edit 用户文案迁入。
- 仍硬编码：`App.tsx`（大量 toast/工具栏）、`AssetPreviewModal`、`AssetContextMenu` 内联块、`useBatchActions` 等。
- 验证：typecheck / lint 通过；i18n 相关单测通过。


## 人类验收（待条目）

| 建议 ID | 步骤 | 预期 |
| --- | --- | --- |
| I18N-001 | 打开资源库菜单 → 语言 → English | 壳层按钮/面包屑/历史与右键命令标题变为英文；重启后保持 |
| I18N-002 | 切回简体中文 | 文案恢复中文；E2E 默认路径不受影响 |
