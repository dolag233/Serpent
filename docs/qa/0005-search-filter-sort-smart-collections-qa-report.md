# 切片 0005 QA 报告

> 状态：自动化与性能通过；macOS 人工视觉 / Windows 平台待补
> 日期：2026-07-13

## Build under test

- 固定提交范围：`8dc2470...cdc2247`
- 补充对象：当前 working tree 的搜索/喜欢过滤/智能合集公共 UI

## 自动化结果

| 门禁 | 结果 |
| --- | --- |
| 公共 UI E2E `organization-search-trash` | 1/1 通过 |
| Unit | 144/144 通过 |
| Worker（当前集成工作树） | 含 10 万资产性能门禁 4/4；普通浏览首屏固定返回 50 项 |
| Electron `asset-pagination` | 1/1 通过；73 项资源库分两页渲染 50 + 23 张卡片 |
| 全量 Electron E2E | 10/10 通过 |
| Package/verify/packaged smoke | 通过（packaged 1/1） |
| Lint | 通过 |
| Typecheck | 通过 |

公共 UI E2E 在真实 Electron 窗口中覆盖 Label 关键词、favorite、标签过滤、安全 snippet、
人工色卡和智能合集保存/执行/更新/重命名；测试未直连数据库。

## 10 万资产性能门禁补充（2026-07-13）

新增 `tests/worker/search-performance.test.ts`，可独立运行：

```bash
npm run test:perf:search -- --reporter=verbose
```

门禁通过真实 v10 数据库、真实 `asset_search_index` 触发器和
`LibraryService.searchAssets` 公共入口执行。造数使用单个事务写入 100,000 个资产、修订、
元数据和搜索索引；计时不含造数，先做一次非计时预热，再取 5 次热查询中位数。每个查询均
执行真实 total count、首屏 50 项读取和结果断言，而不是只运行 `EXPLAIN`。

本机结果：

| 场景 | 目标 | 中位数 | 结果 |
| --- | ---: | ---: | --- |
| 普通资源库浏览（100,000 项，首屏仅返回 50） | 观测项，不设脆弱 CI 阈值 | 103.2 ms | 通过 |
| FTS5 关键词 `needle`（10,000 命中，含 snippet，首屏 50） | < 1,000 ms | 51.7 ms | 通过 |
| 格式 + 评分 + 喜欢 + 可用性过滤，按字节数倒序（1,667 命中，首屏 50） | < 1,000 ms | 114.4 ms | 通过 |
| 独立写连接保持未提交模拟导入事务时，公共搜索读取旧快照；提交后看见新资产 | 不阻塞且快照正确 | 正确 | 通过 |

测试环境：Apple M1 / 8 GiB / macOS arm64（Darwin 25.5.0），Node 24.15.0，
Electron 43.1.0；基线提交 `0e5d44d` 加当前未提交的 0005 收口改动。单文件总耗时约
7.80 秒（其中大部分为 10 万行 fixture 建库），因此保留在默认 Worker 测试集合中，
同时提供独立脚本用于复测和跨平台采样。

该证据证明当前 macOS arm64 本机的已打开资源库热查询满足 1 秒目标，并证明 WAL 下读取
不受一个保持中的模拟导入写事务阻塞；它不外推为冷启动、NAS、低配 Windows 或完整导入
流水线持续竞争下的吞吐结论。Windows 数据仍需真实 runner 补齐。

## 平台与未完成项

- macOS：自动化通过；人工视觉 QA 待执行。
- Windows：无 runner，未验证。
- 10 万资产热搜索与过滤+排序性能目标已在 macOS arm64 本机通过；人工视觉 QA 仍需继续。

## AI 查询转换专项（2026-07-13）

- Unit 48/48 通过（AI planner + 搜索表达式 + IPC 协议）。
- 三家供应商均通过 injected fetch 验证结构化请求与解析；测试不使用真实 API Key 或网络。
- strict schema 拒绝模型附加的 SQL 字段、路径能力和不匹配的 numeric/categorical filter；
  验证后的值仍由普通 FTS/SQL 绑参搜索执行。
- 未配置、供应商拒绝和供应商错误的 Renderer 自动普通搜索 fallback 已完成代码级覆盖；真实
  供应商账号、人工交互与 Windows Electron QA 仍待最终平台轮次。

## 结论

搜索/过滤/排序/分页/snippet/智能合集的自动门禁与 10 万资产热查询性能门禁通过；macOS
人工视觉 QA 和 Windows 验证尚未完成，因此维持有条件通过，不写成最终 accepted。
