# 切片 0004 开发日志：标签、合集与资产元数据

> 状态：部分实现，fixing
> 日期：2026-07-13

## 依据

- 规格：`docs/implementation/0004-tags-collections-metadata-vertical-slice.md`
- 分支：`codex/slice-002-asset-ingestion`
- 实现提交：`3179fe4`、`b8bc0b7`、`ca49d57`
- 固定复审范围：`8dc2470...cdc2247`

## 实现摘要

- schema v5 引入标签、人工/AI 标签关系、资产元数据、树状合集、合集成员和智能合集定义。
- Worker 实现标签/合集/元数据 CRUD、递归合集汇总、成员排序和 `entity_version` 乐观锁。
- Renderer 提供标签与合集创建、资产分配、元数据 Label/评分/喜欢编辑和版本冲突反馈。
- 当前工作树补齐右键分配标签、加入合集、标签/合集重命名与删除、从合集移除资产的公共 UI
  入口，并新增跨切片 E2E。
- `AssetSummary.locationKind` 作为公共事实随列表、合集和搜索结果返回；Renderer 按资产本身
  判断托管/链接删除语义，不再按当前侧栏范围推断。
- 首次元数据写入必须使用 `expectedVersion = 0`；本轮 E2E 发现共享请求/响应 schema
  错误限制为 1，现已统一为允许 0。

## 流程偏差与重建证据

本切片由另一 agent 在未逐步维护开发日志、审查和 QA 文档的情况下分批提交。本文不是
实时开发记录，而是根据上述提交、当前实现、Worker 测试及本轮公共 UI E2E 重建。该偏差
不影响代码事实，但降低了过程证据的可追溯性，因此结论只能是条件性通过。

## 验证

- 公共 UI E2E `organization-search-trash`：1/1 通过，覆盖标签创建/分配、合集创建/加入、
  Label/评分/喜欢编辑及三次版本递增。
- 最终全局自动门禁：unit 141/141、Worker 418/418、Electron E2E 10/10；lint、typecheck、
  package/verify 通过。
- Windows 未验证；macOS 人工视觉 QA 待执行。

## 遗留风险

- 公共 UI E2E 已覆盖标签/合集重命名删除和成员移除；尚未覆盖合集树拖拽/重排、重启持久化
  和真实并发冲突。
- 标签重命名与删除会在同一事务内重建受影响资产的 FTS 内容，旧标签词不会残留。
- 人工色卡的完整编辑交互仍需按规格在视觉 QA 中确认。
