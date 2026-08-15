# 2026-07-18 移除人工色卡（Serpent-7pg）

## 范围

色卡仅为自动分析结果；删除自定义/人工色卡入口。

## 实现

- Inspector：去掉人工输入框；只读自动预览或「待提取」说明
- Worker：`resolvedPaletteFields` 忽略 DB 中手工色卡；`setAssetMetadata` 忽略 `palette` 写入
- 多选 Inspector 模型去掉 `palette` 字段
- META-006 撤回；META-008 自动色卡只读验收

## 保留

自动提取、预览条、点击复制 hex、按色排序。
