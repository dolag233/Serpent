# Serpent-103059 定向 QA（2026-11-05）

结论：2026-11-06 用户反馈标签表达式入口未作为默认主输入，已将 SEARCH-EXPR-001 标记为“人类验收不通过”。默认单输入修改后的隔离隐藏 Electron 短旅程已通过；独立审查提出的协议、Worker 查询与工作区恢复缺陷已修正并完成相应定向测试。原有长组织 E2E 另有未关闭的 metadata 时序失败，不据此宣称全文件通过。实现过程和 ABI 说明见[开发记录](../development/2026-11-05-unified-search-expression-development-log.md)。本报告不表示工单已验收或关闭。

## 四列追溯

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 空格 AND、`|` OR、前缀 `-` NOT、引号、分组、诊断位置与预算 | `src/shared/search-expression.ts`；`src/shared/asset-types.ts` | `tests/unit/search-expression.test.ts`；`tests/unit/normalize-automation-asset-search-input.test.ts` | 隔离隐藏 Electron E2E 中两入口实际输入；人类验收仍待清单 SEARCH-EXPR-001 |
| `tag=` 完整标签名、`tag:` 子串；标签表达式与搜索表达式共享 AST | `src/worker/catalog-read.ts`；`src/worker/library-service.ts` | `tests/worker/search.test.ts` 五资产 truth table 与 tag_expression 过滤器测试 | 隔离 Worker 与隐藏离屏 Electron E2E 通过；packaged 与跨平台未执行 |
| scope、仅负条件、AI 标签过滤、旧 clauses/groups 查询兼容 | `src/worker/library-service.ts`；`src/worker/catalog-read.ts`；`src/shared/asset-types.ts` | `tests/worker/search.test.ts`（旧搜索、folder scope、negative-only、AI tags）；library availability 套件 | Windows/macOS 用户库验证未执行 |
| 默认唯一标签表达式主输入、建议替换词项、Shift OR/排除累积、旧工作区迁移、最后有效结果 | `src/renderer/FilterTagPicker.tsx`；`src/renderer/tag-expression-editor.ts`；`src/renderer/App.tsx`；`src/renderer/workspace-tabs.ts` | `tests/unit/filter-tag-picker.test.tsx`；`tests/unit/tag-expression-editor.test.ts`；`tests/unit/workspace-tabs.test.ts`；独立隐藏 Electron 短旅程 | 用户此前反馈默认标签入口不通过；修订后后台 Electron 实测通过，人类复验仍未进行 |
| 文件夹搜索布尔语义、智能合集与自动化输入一致性 | `src/renderer/search-folder-results.ts`；`src/shared/smart-collection-query.ts`；`src/main/normalize-automation-asset-search-input.ts` | `tests/unit/search-folder-results.test.ts`；`tests/unit/normalize-automation-asset-search-input.test.ts`；`tests/worker/search.test.ts` 智能合集 AST 路径 | 独立搜索/标签 E2E 通过；自动化脚本外部宿主验证未执行 |
| 浏览范围、分页、排序与最新请求不退化 | `src/worker/library-service.ts`；`src/worker/catalog-read.ts`；`src/renderer/App.tsx` | Worker 搜索定向套件含 AST 相关度、FTS 候选与复杂 OR 真值；最新请求 UI 竞态未由新增 E2E 覆盖 | 20,000 资产性能基线未执行；独立表达式 Electron E2E 通过 |

## 命令与结果

- `npm run typecheck`：通过。
- `npx vitest run --config vitest.config.ts tests/unit/search-folder-results.test.ts tests/unit/search-expression.test.ts tests/unit/filter-tag-picker.test.tsx tests/unit/normalize-automation-asset-search-input.test.ts`：4 files，36 passed。
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/search.test.ts tests/worker/catalog-read.test.ts`：2 files，105 passed。
- `$env:SERPENT_E2E_HIDE_WINDOW='1'; $env:SERPENT_E2E_PERF_OFFSCREEN='1'; $env:SERPENT_E2E_SHOW_INACTIVE='0'; node scripts/run-e2e-isolated.mjs tests/e2e/organization-search-trash.test.ts --grep 'uses the shared search' --reporter=dot`：1 passed / 6.9s，exit 0；隔离 userData。长组织旅程的 metadata `versionDelta` 失败未关闭，详见开发记录。
- `npm run test:library-availability`：9 files，238 passed / 1 skipped。
- Electron ABI 原生重建与 FTS5 probe 通过。普通 Node runner 曾因 ABI 137/148 不匹配无法加载 better-sqlite3；Worker 测试改由 Electron runner 执行后通过。
- 2026-11-06 标签默认入口修订：`npx vitest run --config vitest.config.ts tests/unit/tag-expression-editor.test.ts tests/unit/filter-tag-picker.test.tsx` 为 2 files / 9 passed；`npm run typecheck` 通过；定向 ESLint 0 errors、App.tsx 有 2 条既有 hook 依赖 warning。
- 新默认入口的独立短旅程首跑发现部分词项点建议后缺少尾随分隔、后续右键会覆盖原标签；修复并补连续操作测试后隐藏 Electron E2E 1 passed / 11.0s、退出码 0。Worker 修正后的同一旅程再次复跑，结果见下方补充。
- 独立审查发现的 AST FTS 候选与相关度回归已修复；20,000 资产性能基线仍未执行，实际首屏预算未验证。

## 独立审查后补充验证（2026-11-06）

- `npx vitest run --config vitest.config.ts tests/unit/tag-expression-editor.test.ts tests/unit/filter-tag-picker.test.tsx`：2 files / 9 passed；`npx vitest run --config vitest.config.ts tests/unit/search-expression.test.ts tests/unit/workspace-tabs.test.ts tests/unit/search-folder-results.test.ts`：3 files / 42 passed。
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/search.test.ts tests/worker/catalog-read.test.ts`：2 files / 109 passed；增加复杂 OR 候选后单跑 `tests/worker/search.test.ts`：1 file / 98 passed。
- `npm run typecheck`：退出码 0。`npm run test:library-availability`：9 files / 238 passed / 1 skipped，退出码 0。
- Worker 修正后运行 `$env:SERPENT_E2E_HIDE_WINDOW='1'; $env:SERPENT_E2E_PERF_OFFSCREEN='1'; $env:SERPENT_E2E_SHOW_INACTIVE='0'; node scripts/run-e2e-isolated.mjs tests/e2e/organization-search-trash.test.ts --grep 'uses the shared search' --reporter=dot`：1 passed / 9.5s，退出码 0；隔离 userData、隐藏离屏窗口。
- 智能合集表达式原文已纳入保存结构；Worker 测试完整关闭并重开资源库后验证执行与原文。自动化外部宿主、packaged、20,000 资产性能、真实窗口 Computer Use 均未执行。用户明确暂不授权前台观察，维持未执行。
- 独立审查修正：`npx vitest run --config vitest.config.ts tests/unit/workspace-tabs.test.ts tests/unit/search-folder-results.test.ts`：2 files / 23 passed；定向 ESLint 0 errors，App.tsx 有 2 条既有 hook 依赖 warning。`npm run typecheck` 受主 agent 同时修改的 `src/worker/library-service.ts:32537` 阻断（`NetworkMetadataCacheDatabase` 缺少 `DatabaseConnection.function`），本轮未改 Worker。

测试临时数据由套件清理；E2E 隔离数据由 runner/测试清理。没有运行完整 `npm test`、主线或发布门禁。

## 2026-11-06 标签帮助与搜索历史键盘补充

标签表达式说明已收进输入框旁问号，复用搜索语法帮助的浮层样式；输入框下方不再常驻说明。搜索历史打开时，上下键仍切换历史项；左右键交给文本输入框移动光标，并退出此前高亮的历史项。

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 标签语法问号 | `src/renderer/FilterTagPicker.tsx`；`src/renderer/styles.css`；中英目录 | `tests/unit/filter-tag-picker.test.tsx`；隔离隐藏 Electron 表达式短旅程 | 用户请求改动；真实前台观察未执行，SEARCH-EXPR-001 维持人类验收不通过 |
| 历史弹层打开时左右键编辑 | `src/renderer/App.tsx`；`src/renderer/search-history.ts` | `tests/unit/search-history.test.ts`；隔离隐藏 Electron 表达式短旅程实际检查光标位置与高亮状态 | 真实前台观察未执行，SEARCH-HISTORY-002 待人类验收 |

`npx vitest run tests/unit/filter-tag-picker.test.tsx tests/unit/search-history.test.ts`：2 files / 11 passed；`npm run typecheck` 退出码 0；定向 ESLint 0 errors（App.tsx 两条既有 warning）；隐藏离屏 `node scripts/run-e2e-isolated.mjs tests/e2e/organization-search-trash.test.ts --grep 'uses the shared search' --reporter=dot`：1 passed / 8.1s。未运行 Worker/资源库可用性套件，因为本轮未改这些层。测试临时库由套件清理。
