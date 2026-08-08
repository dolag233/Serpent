# 2026-07-18 CU-D3/U2 搜索高亮去重与单行（Serpent-mdi）

## 问题

搜索命中卡片第二行 FTS snippet 最多约 3 行（`max-height: 30px`），导致网格卡片高度不一；文件名命中时 snippet 常为分词后的索引文本（如 `wide red png`），与主行 `displayName` 视觉重复。

## 实现

- 新增纯函数 `resolveSearchSnippetCaption`（`src/renderer/search-snippet-caption.ts`）：去掉 `<b>`/省略号后规范化比较，若与 `displayName` 等价（含分隔符折叠）则不展示第二行。
- 卡片 caption 仅在 helper 返回非 null 时渲染 `.search-snippet`。
- CSS：`.search-snippet` 改为单行 `white-space: nowrap` + ellipsis，去掉多行 `max-height`。
- E2E：组织搜索用例改为搜描述词，断言非文件名重复的高亮 snippet。

## 验收

人类清单 **SEARCH-006**。操作：文件名搜索应无重复第二行；描述/标签命中仍显示单行高亮。

## 自动化

```bash
npx vitest run tests/unit/search-snippet-caption.test.ts
```
