# 0015-THEME 开发日志 — 亮/暗/跟随系统主题（第一增量）

> 工单：`Serpent-bzk`（REQ-THEME-001/002）
> 分支：`codex/slice-002-asset-ingestion`
> 日期：2026-07-18
> 状态：基础设施已落地；默认偏好 interim=`dark`（澄清队列 #11 未裁决）；部分选择器仍有硬编码暗色 hex，亮色下可能局部不一致。

## 范围

- 新建 `src/renderer/theme/`：`theme-preferences`（localStorage `serpent.theme-prefs.v1`）+ `ThemeProvider` / `useTheme`。
- 解析：`light` / `dark` / `system` → 生效主题写入 `document.documentElement.dataset.theme` 与 `color-scheme`。
- `system` 订阅 `prefers-color-scheme` 变化。
- `styles.css`：`:root` 保留现有暗色语义 token；新增 `[data-theme="light"]` 语义 token 覆盖（不复制一套散落亮色硬编码）。
- 资源库菜单增加「主题」三选项（暗色 / 亮色 / 跟随系统），文案走 i18n `shell.theme*`。

## 验证

- `npx tsc --noEmit`：通过
- `npm run test:unit`：`54 files / 620 tests passed`（含 `theme-preferences` 5 例）

## 已知债

- `styles.css` 仍有约百处硬编码暗色 hex（Inspector 等）；亮色主题依赖 token 的面可用，未 token 化选择器需后续迁入语义变量。
- Computer Use / 亮暗截图未执行。
- 默认主题策略待澄清队列 #11。

## 人类验收

| ID | 步骤 | 预期 |
| --- | --- | --- |
| THEME-002 | 资源库菜单 → 主题 → 亮色；再切暗色；再切跟随系统 | 壳层/画布/菜单随 token 切换；重启后偏好保持 |
