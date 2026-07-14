# 切片 0005 开发日志：搜索、过滤、排序与智能合集

> 状态：功能收口完成，平台/人工 QA 待补
> 日期：2026-07-13

## 依据

- 规格：`docs/implementation/0005-search-filter-sort-smart-collections-vertical-slice.md`
- 实现提交：`a16f310`
- 固定复审范围：`8dc2470...cdc2247`

## 实现摘要

- schema v6 建立 external-content FTS5 内容表、虚表和同步触发器。
- 搜索构造器使用单个 MATCH 绑参；结构化过滤、排序、分页、snippet 和显式加权 bm25
  由 Worker 统一执行。
- 智能合集保存查询定义并在执行时重新查询当前数据库。
- 当前工作树补齐实时搜索、完整结构化过滤、多字段排序、分页、安全 snippet、智能合集
  保存/执行/重命名/更新/删除的公共 UI 入口。

## 2026-07-13 收口轮次

- 基线：`0e5d44d`。
- 目标：把 Worker 已有的格式、标签、评分、喜欢、来源 URL、可用性过滤，多字段排序、分页和
  snippet 能力接到公共 Renderer；补齐智能合集重命名、更新查询与删除入口。
- 测试接缝：扩展 `organization-search-trash` 公共 UI E2E；保留 Worker 查询构造器和智能合集
  集成测试；新增 10 万资产搜索/过滤/排序性能门禁。
- 验收要求：所有搜索输入仍只通过现有 Zod 协议进入 Library Worker，Renderer 不接收 SQL
  或绝对路径；snippet 不能通过不受信任的 HTML 注入渲染。

## 流程偏差与重建证据

本日志由提交、当前实现、Worker 测试及本轮公共 UI E2E 事后重建；实现期间未同步维护切片日志、
双轴审查和 QA，属于流程偏差。固定复审范围与 working-tree 复审在文档中分开记录。

## 验证

- 公共 UI E2E `organization-search-trash`：1/1 通过，覆盖 Label 关键词、喜欢过滤、智能合集
  保存与重新执行。
- 最终全局自动门禁：unit 139/139、Worker 408/408、Electron E2E 10/10；lint、typecheck、package/verify 通过; packaged smoke 对旧 build 验证见下。
- packaged 搜索冒烟（2026-07-14）：新增 `tests/e2e/packaged-startup.test.ts` 第二个测试用例，
  对 7月13日旧 packaged build 验证 2/2 (非当前 HEAD — `npm run package` 被 0006 media:verify 阻断, 无法基于当前提交重新打包);
  按验收纪律#4(当前 HEAD 必须当前构建),对当前 HEAD 的 packaged 搜索冒烟 = 未执行。
  测试内容：在旧 packaged .app 中导入 real PNG、使用 `getByLabel('搜索资源库')` 填充关键词，确认 FTS5 命中后资产卡片可见；再用不匹配关键词确认卡片消失。
  FTS5 search 在 ASAR + better-sqlite3 native-module 打包上下文中端到端概念验证通过（基于旧包，非当前 HEAD 重新打包验证）。
- 10 万资产性能门禁 4/4 通过：普通浏览首屏中位数 103.2 ms、仅返回 50/100,000 条；
  热关键词搜索中位数 51.7 ms，组合过滤+排序中位数 114.4 ms，均执行 total count 与
  首屏 50 项；独立 WAL 写连接保持未提交模拟导入
  事务时，公共搜索仍能读取旧快照并在提交后看见新资产。独立命令为
  `npm run test:perf:search -- --reporter=verbose`，完整环境与边界见 QA 报告。
- Electron `asset-pagination`：1/1 通过；73 项资源库首屏只创建 50 张资产卡片，第二页
  创建剩余 23 张，并能稳定返回第一页。
- 当前集成工作树全量 Unit：144/144；Worker：430/430，1 个真实系统回收站环境门禁跳过；性能门禁保留
  在默认 Worker 集合内。
- 全量 Electron E2E 10/10 通过。Windows 未验证；macOS 人工视觉 QA 仍待最终确认。

## 遗留风险

- 当前性能证据只覆盖 macOS arm64 本机、已打开资源库的预热查询；不能外推到冷启动、NAS、
  Windows 或并发写入场景。
- snippet 使用 FTS5 最佳命中列并受 LIMIT 约束；尚未拆成独立二次查询，但 10 万资产实测满足
  当前性能目标。

## 2026-07-13 AI 自然语言查询转换

- 新增 Main-only `ai-search-planner`：从现有 safeStorage 配置解密 BYOK Key，并分别使用
  OpenAI JSON Schema、Gemini responseSchema、Anthropic forced tool-use 获取结构化结果。
- 模型输出只允许 bounded keywords/synonyms/exclusions、现有 typed filters 与 sort；Zod
  strict schema 拒绝额外 SQL、路径、运算符和错误 filter kind。Main 只把验证后的计划返回
  Renderer，Library Worker 仍只执行既有参数化 `searchAssets`。
- Renderer 增加明确的 AI 搜索开关；只在用户提交时调用模型，不随键入自动产生云端请求。
  计划支持分页和保存为智能合集。未配置、认证、权限、额度、限流、网络、超时、拒绝、无效
  输出均显示中文原因；失败会记录应用日志，并自动退回普通关键词搜索，不静默丢弃查询。
- 专项验证：`ai-search-planner`、`search-expression`、`protocol` 共 48/48 通过；覆盖三家请求/
  解析、恶意额外字段、错误 typed filter、拒绝与错误分类、超时、IPC 上限和普通搜索定义转换。
