# asset-pagination E2E 规格同步开发日志

> 日期：2026-08-12
> 工单：Serpent-q6le

## 范围

同步 `tests/e2e/asset-pagination.test.ts` 与当前浏览/查看器模型，不修改产品实现：

- 资产画布通过滚动触发继续加载；测试滚动到尾部并轮询，确认 73 项最终全部可达，不依赖首屏卡片数量。
- 卡片尺寸控件使用离散档位索引；测试从运行时 `max` 读取档位上界，不再把像素宽度填入 range input。
- `.txt` 资产使用内置只读文本查看器；测试确认文本预览可见、文本框包含资产内容，并确认不显示不支持格式的“重试生成”入口。

## 验证

| 命令 | 结果 |
| --- | --- |
| `node scripts/run-e2e-isolated.mjs tests/e2e/asset-pagination.test.ts` | 1 passed，11.4s（macOS 开发态，当前工作树） |

Windows、packaged 应用和 Computer Use 证据本轮未执行。
