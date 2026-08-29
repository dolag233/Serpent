# 可用/不可用表现 — 仅不可用显示断联图标

> 工单：`Serpent-6nb`
> 分支：`codex/slice-002-asset-ingestion`
> 日期：2026-07-18

## 变更

- 链接文件夹在线时与托管文件夹相同使用 `folder` 图标，不再显示有色 `link` 图标。
- 离线链接文件夹仅显示灰色 `link-off`（`--tertiary`），悬停文案仍说明离线可重定位。
- 丢失资产：缩略图灰度变淡，中央灰色断联图标（移除角落「文件丢失」警告条）。

## 验证

- `npm run test:unit` → 含 `availability-affordance`，全量绿
