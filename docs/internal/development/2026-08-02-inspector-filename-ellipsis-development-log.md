# 2026-08-02 Inspector 长文件名省略开发记录

## 范围

右侧 Inspector 单选资产的文件名沿用资产卡片的中间省略策略：前缀可压缩并显示省略号，保留文件名末尾三个字符和完整扩展名；多选标题继续使用原有整体标题逻辑。

## 实施

- 新增 `filename-display.ts` 统一拆分文件名，资产卡片与 Inspector 共用同一规则。
- Inspector 标题改为可压缩前缀、固定尾部和固定扩展名的三段布局。
- 前缀仅允许收缩、不主动拉伸，完整文件名时扩展名与主文件名自然相邻，避免出现中间空洞。
- 保留标题 `title` 属性，悬停仍可查看完整文件名。

## 验证

- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npx vitest run --config vitest.config.ts tests/unit/filename-display.test.ts`：3 个测试通过，覆盖长扩展名文件、无扩展名文件和短文件名。

## 人工验收

INSPECT-013 待产品负责人在窄/宽 Inspector、亮/暗主题下确认长文件名的中间省略与扩展名可读性。
