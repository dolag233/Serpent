# 0012 开发日志 — 资产画布视图与卡片信息配置

> 切片规格:`docs/internal/implementation/0012-asset-canvas-views-and-card-display-vertical-slice.md`
> 设计决策:`docs/internal/implementation/0012-design-decisions-2026-07-14.md`
> 审查报告:`docs/internal/reviews/0012-asset-canvas-views-and-card-display-code-review.md`
> QA 报告:`docs/internal/qa/0012-asset-canvas-views-and-card-display-qa-report.md`

## 基线与状态

- 分支:`codex/slice-002-asset-ingestion`
- 基线 SHA:`60d3515`(feat: consolidate MVP implementation checkpoint)
- 当前提交:本切片提交(见 `git log --oneline -1`;基线 `60d3515`)
- 开始:2026-07-14;最后更新:2026-07-14
- 状态:`automated-verification` → `code-review` → `qa`；macOS 自动化与 Computer Use 门禁完成，Windows 与 10 万资产帧率仍为平台/性能风险，因此结论为有条件通过。

## 已完成的垂直行为

- **版本化画布偏好模块** `src/renderer/canvas-preferences.ts`:Zod 4.4.3 校验的 `CanvasPreferences`(version/viewMode/cardSize/fields),`DEFAULT_CANVAS_PREFERENCES`(grid/160/全 true),`loadCanvasPreferences(storage?)` / `saveCanvasPreferences(p, storage?)`。v1 损坏/未知 version 时先尝试完整且有效的遗留 key 对，再回退默认；迁移成功后清除遗留 key。
- **App.tsx 集成**:统一 `canvasPrefs` state + 派生 `assetViewMode`/`assetCardSize`;3 个字段开关具有可访问名与 pressed 态；普通资产全部字段关闭时不再保留空 caption；画布控件归为优先工具组，窄窗仍可见；卡片名称隐藏时保留 `aria-label`。
- **瀑布流首/尾完整**:调查确认**已满足**(`styles.css` padding 14px 顶/40px 底 + overflow:visible + break-inside:avoid + `.workspace-canvas` overflow:auto),无需修复。
- 大部分 0012 行为(普通滚轮滚动、Ctrl+wheel 缩放、macOS pinch、缩放锚点保持、连续加载、grid/masonry 同根、AssetSummary 21 字段批量返回无 N+1)**在上一切片已存在**——本次只补字段开关 + 版本化对象 + 测试。

## 公共测试缝

- `CanvasPreferencesStorage` 可注入接口(node 环境 vitest 无 localStorage → 注入 Map stub)。
- 重启 E2E:`SERPENT_E2E_USER_DATA_PATH` 稳定 profile + `SERPENT_E2E_RESTORE_RECENT=1`,使 localStorage 跨 `application.close()`→再 `launch()` 存活(对齐 `library-lifecycle.test.ts`)。
- no-requery:仅在 `SERPENT_E2E=1` 时由 preload 对请求类型做只读计数并暴露 `serpent.e2e.getRequestCount()`；生产环境不暴露测试 API。E2E 直接证明字段切换前后 `asset.search.request` 数量不变。

## 重要实现决定及理由

1. **偏好范围 = 全局**(用户 Q1):一个 `serpent.canvas-prefs.v1` 跨库共享,保留今天 view-mode/card-size 全局行为;按库为未来选项。
2. **开关 UI = 工具栏内联切换按钮**(用户 Q2)。
3. **96/160/320 = 测试参考点**(用户 Q3):保留连续滑块,测试在 small/medium/large 参考点断言宽度/边界/方向,不做离散三档吸附。
4. **纯字段名 label** `文件名`/`文件大小`/`修改日期`:避免与现有 22 处 `getByLabel('名称')` 子串碰撞;不含 `名称`/裸`大小`/裸`日期` 子串,也不与 `资产缩略图大小` 互为子串。
5. **条件化 aria-label**:仅 name 隐藏时设——满足规格"隐藏名称时仍保留可访问名",且不破坏基于文本的可访问名断言。
6. **无 DB/IPC 改动**:偏好是客户端状态,Worker 不持有;AssetSummary 已批量返回 → 无 N+1(满足不变量"Library Worker 是 DB 唯一所有者")。

## 与规格的偏离、原因、是否获确认

- **三档→连续滑块**:Q3 用户确认(测试参考点),记录于设计决策文档。
- **按库→全局**:Q1 用户确认。
- **label `名称/大小/日期`→`文件名/文件大小/修改日期`**:规避 `getByLabel('名称')` 碰撞(回归发现),记录。
- **始终 aria-label→条件化**:回归发现(覆盖可访问名破坏 `getByRole button /^automatic\.png\s/`),修复,记录。
- **#4(b) 锚点**:自动化已有 73 资产锚点回归；本轮另以 Computer Use 在 320→96 缩放前后确认当前中心资产仍在视口。
- **#6 帧率部分留人工 QA**:无可靠自动化;no-requery(IPC)部分已覆盖。
- **#7 全范围**:E2E 覆盖 folder/tag/collection/smart collection/root/all/trash，并检查真实字段呈现而非只检查工具栏状态。

## 执行过的关键命令及结果摘要

- `npm run typecheck`:GREEN(tsc --noEmit + tsconfig.extension.json,0 新错误)。
- `npm run test:unit`:26 files / 262 passed。
- `npm run test:worker`:24 files / 536 passed + 1 skipped(platform skip,与交接一致)。
- `npm run lint`:GREEN(初次 3 个 unused-vars 错误——`existsSync`/`cardLocator`/`beforeEach`——已修;现 0 错误)。
- 回归 E2E(`media-preview` + `organization-search-trash`):4/4 通过(两处回归修复后)。
- 新 E2E `browsing-preferences`:2/2 通过。
- 最终 `npm run verify:mainline`:lint、typecheck、extension verify、50 files / 798 passed + 1 skipped、10 万搜索性能 4/4、全量 Electron E2E **20/20 passed**。其中 `browsing-preferences` 2/2，recent 路径不存在回退 1/1。
- `git stash -u` + baseline 跑 `process-lifecycle`:baseline `60d3515` **同样 2/2 失败** → 预存在,非 slice 0012 引入。

## 遇到的失败、根因和解决方式

1. **`getByLabel('名称')` strict mode 冲突(4 个 E2E 失败)**:首版开关 label `显示名称` 含子串 `名称`,与 22 处 `getByLabel('名称')`(资源库/文件夹名输入框)子串匹配命中两元素。根因:子串 getByLabel 脆弱 + 新增含"名称"的可访问名。解决:改用纯字段名 `文件名`/`文件大小`/`修改日期`(零测试改动)。
2. **media-preview:48 `getByRole button /^automatic\.png\s/` 失败**:首版给卡片 button **始终**设 `aria-label={displayName}`,覆盖文本内容,可访问名从 `filename size · date` 变纯 `filename`。解决:条件化——仅 `fields.name===false` 时设。
3. **lint 3 个 unused-vars**:agent 写的测试含未用 import/var(`existsSync`/`cardLocator`/`beforeEach`)。解决:移除。
4. **process-lifecycle 2/2 失败(预存在,已修测试隔离)**:baseline `60d3515` 同样失败；`5e01640` 为每个测试提供 fresh E2E profile，消除开发机默认 userData 污染。交接文档进一步推断“缺失 recent-library 会导致真实应用挂起”，本轮新增完整 Electron 重启回归后未复现：不存在的 recent 路径在约 0.8 秒内回到起始页。因此保留回归测试，不对生产恢复逻辑做无证据修改，也不再把该推断列为已知 bug。
5. **Computer Use 捕获两处视觉回归**:全部字段关闭后仍有空 caption padding；常规/窄窗下工具栏子项收缩导致中文逐字换行且画布设置被裁掉。修复为条件渲染 caption、工具项禁止收缩、标题不换行，并将画布控件组提升到工具栏视觉首位；新增窄窗 E2E 防回归。

## 当前已知问题、技术债和后续工作

- **#6 10 万资产帧率**:真实 `asset.search.request` no-requery 已自动化；10 万资产交互帧率仍待专门性能 QA，不能由 36 资产 E2E 外推。
- **Windows 平台**:完全未验证(无 runner)。
- **代码审查修复已应用**:共享 min/max 常量、严格遗留值解析、损坏 v1 的遗留迁移、真实请求计数、96/160/320 实际卡片 bbox、smart scope、字段真实呈现、字段全关无空 caption、窄窗工具栏布局。

## 重要文件入口

- `src/renderer/canvas-preferences.ts` — 偏好模块(type/schema/DEFAULT/load/save/migrate)。
- `src/renderer/App.tsx` — 集成点(~5100 字段开关、~5470 卡片 button+条件 aria-label、~690 canvasPrefs state、~825 save effect)。
- `tests/unit/canvas-preferences.test.ts` — 20 单元测试(load/save/迁移/回退/clamp/损坏 v1+legacy)。
- `tests/e2e/browsing-preferences.test.ts` — 2 E2E(重启持久化 + 可访问名/缩放/瀑布流/no-requery/全范围)。
- `docs/internal/implementation/0012-design-decisions-2026-07-14.md` — 决策 + 实施笔记 + 回归修复记录。
