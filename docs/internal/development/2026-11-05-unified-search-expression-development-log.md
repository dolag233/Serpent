# Serpent-103059：统一搜索与标签表达式开发记录

## 目标

搜索框与标签组合编辑器使用同一套表达式语法和 AST：空格表示 AND，`|` 表示 OR，前缀 `-` 表示 NOT，双引号表示连续内容，括号用于分组。`tag:` 保留标签名子串匹配；`tag=` 匹配完整标签名。旧查询中的 `clauses` / `groups` 及点选标签筛选保持原有读取语义。

## 实现

- `src/shared/search-expression.ts` 和 `src/shared/asset-types.ts` 提供共享词法分析、递归下降解析、AST 与协议 schema；限制表达式长度、词项数和嵌套层数，错误带有字符位置和诊断码。
- `src/worker/library-service.ts` 与 `src/worker/catalog-read.ts` 将 AST 编译成带参数的 SQL 树，不展开 DNF。精确标签通过标签成员关系表匹配；标签过滤器中的 `tag:` 子串走成员关系表，并调用与搜索索引相同的 Unicode 规范化函数。表达式查询从 AST 提取必要的正向 FTS 候选：AND 可忽略不安全分支，OR 只有各分支都有候选才收窄；相关度排序从正向文本项计算，纯精确标签仍按浏览排序。
- 标签编辑器由受控模式状态驱动；点选切换为表达式时序列化现有筛选，简单的精确标签表达式可转换回点选；复杂表达式先要求明确替换。非法部分输入沿用同一库、同一工作区标签内的最后有效筛选，并显示错误原因与上次结果提示。
- 文件夹搜索结果读取 AST，并按 name/path 条件的 AND/OR/NOT 结构匹配。字段不适用于文件夹时不影响文件夹候选；非法输入沿用当前库与标签范围内最后有效的文件夹搜索。
- 智能合集 query definition 与自动化搜索输入使用共享 AST；自动化非法表达式明确拒绝。搜索高亮仅处理正向文本词项，标签完整匹配条件不作为文本高亮。

## 当次验证

- `npm run typecheck`：通过（`tsc --noEmit` 与 extension typecheck）。
- `npx vitest run --config vitest.config.ts tests/unit/search-folder-results.test.ts tests/unit/search-expression.test.ts tests/unit/filter-tag-picker.test.tsx tests/unit/normalize-automation-asset-search-input.test.ts`：4 files，36 passed。
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/search.test.ts tests/worker/catalog-read.test.ts`：2 files，105 passed；含五资产真值表、当前文件夹范围、仅负条件分页、标签表达式过滤与 AI 标签开关、智能合集 AST 存取执行。
- `npm run test:library-availability`：9 files，238 passed / 1 skipped。
- `$env:SERPENT_E2E_HIDE_WINDOW='1'; $env:SERPENT_E2E_PERF_OFFSCREEN='1'; $env:SERPENT_E2E_SHOW_INACTIVE='0'; node scripts/run-e2e-isolated.mjs tests/e2e/organization-search-trash.test.ts --grep 'uses the shared search' --reporter=dot`：新建的独立短旅程 1 passed（6.9s），隔离 userData、隐藏离屏 Electron；验证真实卡片对搜索框与标签组合表达式的显隐，以及切回点选模式。
- 同一测试文件原有长组织旅程曾在约 296 行失败：快速连续修改元数据时 `versionDelta` 期望 2、实际 3，无版本冲突且描述/评分断言正确。该时序问题未定位，记为疑似 flaky、未关闭；未因表达式短用例通过而把全文件记绿。
- 原生模块首次重建因文件锁返回 EPERM；再次执行 `npm run rebuild:native` 成功，Electron FTS5 probe OK。直接用 Node ABI 运行 Worker 测试不匹配（better-sqlite3 编译 ABI 148、Node 测试运行 ABI 137）；改用仓库 Electron Vitest runner 后测试通过。这是执行器 ABI 差异，不作为功能失败证据。
- 未运行 Computer Use、packaged、macOS/Windows 人工验证或大库性能基线。真实窗口人类验收仍在清单中。

## 验收边界与后续审查

自动化覆盖不等于完整产品验收。切换两种标签编辑模式、错误提示本地化、旧工作区查询恢复、真实搜索范围与分页排序须由独立审查和人工验收确认。特别复核复杂 AST 的 SQL 参数顺序、否定表达式候选集、无搜索索引行的纯标签查询，以及工作区切换时最后有效结果是否隔离。

## 2026-11-06 用户反馈与标签输入调整

用户实际验收指出：标签弹层默认显示旧的“搜索并添加标签”输入，表达式能力藏在“组合标签”按钮后，因而标签入口验收不通过。交互已调整为标签面板默认直接显示唯一表达式输入框；建议项根据光标处词项过滤，左键以完整转义标签替换词项，右键替换为排除项。Shift+左键在当前词项处累积 OR，Shift+右键在现有表达式后累积一个排除项。旧点选视图仍保留作兼容，旧工作区点选状态恢复时会序列化成等价表达式，点选数据与 AI 标签开关仍保留。

非法搜索或标签表达式现在在 Renderer debounce 阶段停止，不向 Worker 重发旧 AST；屏幕保留当前结果，输入修正后才继续搜索。表达式视图没有独立的建议搜索框，避免两个可输入控件产生歧义。

本轮新增/更新 `tests/unit/tag-expression-editor.test.ts`、`tests/unit/filter-tag-picker.test.tsx`，覆盖词项替换、引号内标签、空白处排除插入、Shift OR/排除累积及默认单输入。旧隐藏 Electron E2E 曾通过，但它在此前需要手动切换组合模式的界面上执行，不能证明本次默认入口；待定向测试与主 agent 串行运行新的隐藏 E2E 后补充当次证据。`SEARCH-EXPR-001` 已按用户报告标记“人类验收不通过”，不得由自动化改回通过。

- `npx vitest run --config vitest.config.ts tests/unit/tag-expression-editor.test.ts tests/unit/filter-tag-picker.test.tsx`：2 files，9 passed。
- `npx eslint src/renderer/FilterTagPicker.tsx src/renderer/DimensionFilterBar.tsx src/renderer/tag-expression-editor.ts src/renderer/App.tsx tests/unit/tag-expression-editor.test.ts tests/unit/filter-tag-picker.test.tsx`：0 errors；App.tsx 有 2 条既有 hook 依赖 warning。
- `npm run typecheck`：通过（退出码 0），覆盖本轮单输入、迁移与无效输入拦截改动。

独立审查发现了表达式搜索绕过 FTS、相关度排序退化、协议允许矛盾字段、标签子串 Unicode 不一致、文件夹 OR 不适用分支泄出，以及旧工作区清空表达式后回灌。这些路径已逐项修正并增加定向测试；测试命令与结果见下方补充。FTS 候选的安全性使用不展开 DNF 的 AST 规则；20,000 资产性能基线仍未执行，不能据此宣称大型库性能目标已达到。

## 独立审查后的修正与当次证据（2026-11-06）

- 工作区恢复区分显式 expression 空串与旧 selection 状态；文件夹搜索用三态判定不适用字段，混合字段 OR 不再展示全部文件夹。`npx vitest run --config vitest.config.ts tests/unit/workspace-tabs.test.ts tests/unit/search-folder-results.test.ts`：2 files / 23 passed。
- 清空表达式后，空状态与发现输入判断也只看当前标签模式，避免遗留点选值显示成仍有筛选；`npx vitest run --config vitest.config.ts tests/unit/active-discovery-filters.test.ts`：1 file / 5 passed。
- Worker 从 AST 提取安全 FTS 候选与正向文本相关度；`tag:` 标签关系查询使用与搜索索引一致的 Unicode 规范化；协议拒绝 `exact_tag` 搭配非标签字段。智能合集查询保存表达式原文，并以完整关闭、重开资源库验证 AST 和原文仍可用。
- `npx vitest run --config vitest.config.ts tests/unit/search-expression.test.ts tests/unit/workspace-tabs.test.ts tests/unit/search-folder-results.test.ts`：3 files / 42 passed；`node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/search.test.ts tests/worker/catalog-read.test.ts`：2 files / 109 passed。随后新增复杂 OR 候选真实查询测试，`node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/search.test.ts`：1 file / 98 passed。
- `npm run typecheck`：退出码 0。`npm run test:library-availability`：9 files / 238 passed / 1 skipped，退出码 0。隐藏 Electron 短旅程在标签建议替换尾部留白修复后 1 passed；Worker 修正后的最终复跑结果见 QA 记录。
- Computer Use 前台观察按用户选择未执行；packaged、真实大库性能、Windows/macOS 人工验证未执行。SEARCH-EXPR-001 仍为人类验收不通过，等待用户复验。

### 独立审查后续修正

- 工作区恢复用 `resolveWorkspaceTagExpression` 统一转换：显式 `expression` 模式尊重空字符串；旧 `selection` 状态才由 legacy include/exclude 及任一/全部设置迁移。补了旧选择迁移和“清空表达式后重开不回灌 legacy 值”的单测。
- 文件夹结果布尔求值把不适用字段作为三态 `null`：AND 中忽略，OR 中不命中，NOT 保持不适用；避免 `name:maps | tag=red` 因 tag 分支被当作 true 而泄出所有文件夹。补充混合字段 OR 与 NOT 用例。
- 本次只改 Renderer helper/App 与定向测试；未改 Worker、协议或智能合集，故不运行 Worker/availability。
- `npx vitest run --config vitest.config.ts tests/unit/workspace-tabs.test.ts tests/unit/search-folder-results.test.ts`：2 files / 23 passed。定向 ESLint：0 errors，App.tsx 有 2 条既有 hook 依赖 warning。
- `npm run typecheck` 本轮未通过：`src/worker/library-service.ts:32537` 的 `NetworkMetadataCacheDatabase` 缺少 `DatabaseConnection.function`。该 Worker 文件由主 agent 同时修改，本轮未触碰；Renderer 定向测试与 ESLint 通过。

## 2026-11-06 标签语法帮助与搜索历史键盘修正

用户希望标签表达式的常驻说明改成与搜索栏一致的问号提示，并报告搜索输入框左右方向键被历史列表截获。标签输入旁复用现有 `search-syntax-help` 与 HoverTipHost 的 `search-syntax` 提示样式，说明改为中英双语分行文本；搜索历史仅用上下方向键导航，左右键恢复输入框原生光标移动，并清除已有历史高亮。

- `npx vitest run tests/unit/filter-tag-picker.test.tsx tests/unit/search-history.test.ts`：2 files / 11 passed。
- `npm run typecheck`：退出码 0。
- 定向 ESLint：0 errors；`App.tsx` 仍有 2 条既有 hook 依赖 warning。
- 隔离隐藏 Electron 短旅程：`node scripts/run-e2e-isolated.mjs tests/e2e/organization-search-trash.test.ts --grep 'uses the shared search' --reporter=dot`，1 passed / 8.1s。实际验证匹配历史打开时左右键移动光标、上下键选择历史、左右键退出历史高亮、标签问号存在。测试使用隔离 userData，临时库由测试清理。
- 只改 Renderer 与对应 E2E 断言，未运行 Worker、资源库可用性或全量测试。前台 Computer Use 按用户此前选择未执行；真实窗口仍待人类复验。
