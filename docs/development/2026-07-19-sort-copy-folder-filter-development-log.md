# 2026-07-19 排序去相关性 / 括注复查 / 删除文件夹过滤

## 范围

- `Serpent-96i` REQ-SORT-003：排序 UI 去掉「相关性」；默认改为名称升序；查询始终带显式 sort。
- `Serpent-d45` REQ-SHELL-018：去掉「相关性（默认）」与英文 `Width (px)` 等单位括注；语言占位改为「跟随系统」。
- `Serpent-ckx` REQ-FILTER-022：维度过滤条移除「文件夹」维度（范围仍用侧栏/面包屑）。

## 验证

- `npx tsc --noEmit` 通过
- `vitest run tests/unit/sort-mode-control.test.ts tests/unit/i18n-translate.test.ts` 7/7

## 验收 ID

- SORT-005（复验：无相关性项，默认名称）
- SHELL-017（复验：无相关性括注 / 宽度高度无括注单位）
- FILTER-013（复验：无文件夹维度按钮）

Computer Use 未执行；移交人工 QA。
