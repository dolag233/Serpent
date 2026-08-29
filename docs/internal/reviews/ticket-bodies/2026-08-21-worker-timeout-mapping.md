延续 Serpent-n5iu。Composer 2.5 深审发现：15s 默认超时仍覆盖大量破坏性/长时 Worker 命令；Main 将所有 WorkerRequestTimeoutError 映射为 INTERNAL_ERROR + LIBRARY_TRANSFER_TIMEOUT（开库专用 reason）。

## 范围

- asset.delete-permanent / asset.delete-from-disk / asset.purge-trash 等：与 asset.delete-linked 对齐，取消或显著拉长墙钟超时。
- Main index.ts:5193-5195：超时使用 OPERATION_TIMEOUT（或命令级专用码），reason 不得复用开库文案。
- worker-client：评估迟到响应策略（destructive 命令是否允许晚到成功/幂等结果入账）。
- 补 worker-client / protocol 单测。

## 验收

- 删除/清空回收站/从磁盘删除在大库+备份场景下不因 15s 误报 INTERNAL。
- 用户可见超时文案说明操作类型与建议（等待/重试/查日志），非「打开资源库超时」。
- 详见 docs/internal/reviews/2026-08-21-error-handling-deep-review.md
