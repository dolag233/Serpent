# 切片 0005 双轴代码审查

> 状态：Standards / Spec 自动化通过；平台与人工证据待补
> 日期：2026-07-13

## 审查范围

- 固定范围：`8dc2470...cdc2247`
- 规格：`docs/implementation/0005-search-filter-sort-smart-collections-vertical-slice.md`
- 补充复审：当前 working tree 的搜索/过滤/智能合集 UI 与跨切片 E2E

## Standards 轴

- 通过：Renderer 只提交结构化查询；SQL 与 FTS5 由 Worker 构建和执行。
- 通过：MATCH 表达式整体绑参，结构化过滤值使用参数绑定，未发现 Renderer 获得 SQL/数据库能力。
- 通过：bm25 使用显式列权重；FTS 删除触发器使用 external-content 的 `delete` 命令。
- 通过：搜索、过滤和智能合集执行复用同一 Worker 查询路径。
- 通过：查询 schema 对 clause/value/filter 数量、值长度和智能合集 JSON 总长度设置上限；
  智能合集 create/update/execute 共用 strict definition schema。

## Spec 轴

- 通过：公共 UI 可执行字段限定、短语、NOT/OR、实时关键词、格式/标签/评分/喜欢/源链接/
  可用性过滤、多字段排序、安全高亮和分页；可保存、执行、更新、重命名、删除智能合集。
- Worker 测试为中文分词、权重、过滤、排序、分页、注入防护及 FTS 同步提供实现证据。
- 通过：搜索与当前文件夹/合集 scope 在 Worker 取交集；软删除资产不进入普通发现结果；
  纯排除与排除先行输入不会生成非法 FTS5。
- 通过：10 万资产关键词中位数 50.4 ms、组合过滤排序 114.0 ms，WAL 写事务期间读取不阻塞。

## 结论

本轮报告的相关性排序、混合/纯排除、清空条件、智能合集分页、NOCASE、计数污染和输入上限
问题均已修复并回归。snippet 使用 FTS5 最佳命中列，仍未拆成独立二次查询，但性能门禁满足
目标，记为非阻断实现差异。结论为自动化层有条件通过；macOS 人工视觉 QA 与 Windows 待补。
