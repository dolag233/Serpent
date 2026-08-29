Composer 2.5 深审：INVALID_IMPORT_DECISION（用户文案「导入冲突处理选项无效」）被用于非导入非法状态——典型包括已在回收站再 trash、恢复已恢复资产、重复非法状态转换。

## 要求

- 审计 Worker library-service 与 Main 所有 throw/createPublicError('INVALID_IMPORT_DECISION') 调用点。
- 非导入场景改用专用码（如 ASSET_NOT_FOUND、ASSET_ALREADY_TRASHED、INVALID_STATE_TRANSITION 等已有或新增码）与匹配 zh-CN i18n。
- Renderer/MCP 不得把该码当作通用失败兜底。

## 验收

- 回收站/恢复/移动等路径不再出现「导入冲突」文案。
- 每类非法状态有单测断言 public code + messageForCode。
- 详见 docs/internal/reviews/2026-08-21-error-handling-deep-review.md
