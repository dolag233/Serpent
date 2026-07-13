# 切片 0007 开发日志：回收站、手动找回与批量重新定位

> 状态：部分实现，fixing
> 日期：2026-07-13

## 依据

- 规格：`docs/implementation/0007-trash-relink-batch-relocate-vertical-slice.md`
- 实现提交：`cd19485`、`825ebf0`
- 固定复审范围：`8dc2470...cdc2247`

## 实现摘要

- schema v7 增加软删除来源字段和 `relink` revision origin。
- Worker 实现托管资产软删除、恢复、永久删除、30 天清理、单项找回与批量重新定位。
- Renderer 提供回收站、删除确认、恢复、找回与批量重新定位流程。
- 公共 UI E2E 补充托管资产从正常视图进入回收站并恢复的端到端证据。
- 链接资产删除支持“仅移除记录”或“将源文件移入系统回收站并移除”；每项失败返回稳定资产
  ID 和具体安全原因，完整原因链写入日志。
- 系统回收站操作使用 `trash@10.1.1` 随包的 macOS/Windows native helper，以参数数组调用；
  helper 在 ASAR 外打包并由 package verifier 校验。
- 外部回收站移动以 `file_operations` v2 manifest 持久记录。若源文件已移动但 SQLite 提交失败，
  下次打开资源库自动对账；链接根离线时不会以“文件不存在”为依据误删记录。
- helper 即使在移动源文件后才抛错，也会核验在线根并进入对账；根离线导致状态不确定时，
  操作保持 `applying`，待根恢复后再次打开资源库继续判定，并写入带 operation ID 的日志。
- 单次链接源删除最多 20 项，单项 helper 截止 15 秒，Main 总等待 6 分钟；协议与 Worker
  双层拒绝重复 ID。
- 修复 managed 单项/批量重新定位的“假 available”：外部候选现在复制回原托管相对路径，
  原目录缺失时重建，外部源保留；新 revision、artifact 失效和缩略图 job 在同一数据库事务
  登记。刷新、关闭重开和 `resolveAssetPath` 都读取到新字节。
- linked 单项重新定位在既有链接根内更新相对路径与 portable path identity，避免刷新后再次
  missing；整根迁移仍使用 linked-folder relink 流程。

## 流程偏差与重建证据

本日志由提交、Worker 测试和本轮 E2E 事后重建；实现阶段没有同步完成开发日志、双轴审查与
QA，属于流程偏差。固定提交审查与当前 working-tree 复审分别保留，不把未提交修复写成历史。

## 验证

- 公共 UI E2E `organization-search-trash`：1/1 通过，覆盖托管资产删除、回收站浏览、恢复、
  返回所有资产后可见。
- 最终全局自动门禁：unit 144/144、Worker 430/430、Electron E2E 10/10；lint、typecheck、
  package/verify 通过。
- `SERPENT_TEST_REAL_SYSTEM_TRASH=1` 的 macOS 真实系统回收站 Worker 测试 49/49 通过；
  Electron E2E 也实际移动临时链接源文件。Windows 未验证。

## 遗留风险

- 公共 UI 尚未覆盖永久删除、名称冲突恢复、30 天自动清理、单项找回与批量重新定位完整交互。
- 系统回收站及文件占用行为具有平台差异，Windows 必须单独验证。
