延续 Serpent-n5iu。Renderer error-utils toMessage 双轨处理导致部分 PublicError 丢 reason；7 个公开码缺 zh-CN：FOLDER_NOT_EMPTY、AUTOMATION_UNDO_*（3）、PLUGIN_HOOK_BLOCKED、HISTORY_TOO_LARGE、SYNC_IN_PROGRESS。

Worker classifyUnknownFailure 仍漏 ETIMEDOUT、EXDEV、SQLITE_CONSTRAINT 等 → INTERNAL。

## 要求

- 统一 toMessage：PublicError code + reason + i18n fallback 链。
- 补齐上述 7 码 zh-CN（及 en 若缺失）。
- 扩展 classifyUnknownFailure / publicErrorForWorkerFailure；Worker 高频裸 throw new Error 路径改已有公开码。

## 验收

- 单元测试覆盖 messageForCode 新码与 LibraryOperationError/PublicError 双路径。
- 详见 docs/internal/reviews/2026-08-21-error-handling-deep-review.md
