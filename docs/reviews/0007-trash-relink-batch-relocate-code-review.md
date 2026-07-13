# 切片 0007 双轴代码审查

> 状态：Spec 未通过；托管资产最小主线已验证
> 日期：2026-07-13

## 审查范围

- 固定范围：`8dc2470...cdc2247`
- 规格：`docs/implementation/0007-trash-relink-batch-relocate-vertical-slice.md`
- 补充复审：当前 working tree 的公共 UI E2E

## Standards 轴

- 通过：托管文件操作和 SQLite 状态变更由 Worker 所有；Renderer 不接收物理回收站路径。
- 通过：软删除保留资产身份和组织/元数据关系，恢复清理删除状态。
- 通过：永久删除逐项处理占用错误，自动清理不会因单项失败阻断整批。
- 通过：E2E 使用公共 UI 与系统选择器接缝，不直接修改数据库。
- 通过：链接源删除用持久化 applying journal 记录 in-flight/trashed 状态，数据库失败后可恢复；
  离线根不会触发推断删除。
- 通过：批次上限、重复 ID 拒绝、helper 与 Main 截止时间避免 Worker 在调用方超时后长期继续。
- 通过：managed 单项/批量重新定位把候选复制回托管空间，刷新与重开后仍可解析真实新字节；
  linked 单项重新定位更新相对路径和 portable identity，不再产生假 available。
- 非阻断风险：过程文档事后重建；Windows 系统回收站语义尚未验证。

## Spec 轴

- 通过：公共 UI 已验证托管资产删除、回收站查看和原位恢复主线。
- Worker 测试覆盖永久删除、自动清理、元数据保留、单项找回与批量重新定位的核心路径。
- Worker 回归额外覆盖重新定位后的 `resolveAssetPath`、实际字节、刷新、关闭重开与 artifact 失效。
- 通过：macOS 真实 helper 与 Electron 公共 UI 已验证链接资产同步删除至系统回收站；失败原因
  仅暴露稳定 ID/枚举，物理路径留在日志。
- 待验证：恢复冲突策略、文件占用、`keepMetadata=false`、
  批量重新定位完整公共 UI 和平台行为。

## 结论

托管资产删除/回收站/原位恢复主线通过，但 Spec 仍缺多选与指定位置恢复、恢复冲突交互、完整
批量重新定位 UI。链接源文件移入系统回收站子目标已完成，但整个切片仍为 Spec 未通过。
macOS 人工视觉 QA 与 Windows 平台行为仍未验证。
