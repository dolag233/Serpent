# 0012 开发日志 — 资产画布视图与卡片信息配置

> 切片规格:`docs/implementation/0012-asset-canvas-views-and-card-display-vertical-slice.md`
> 设计决策:`docs/implementation/0012-design-decisions-2026-07-14.md`
> 审查报告:`docs/reviews/0012-asset-canvas-views-and-card-display-code-review.md`(待写)
> QA 报告:`docs/qa/0012-asset-canvas-views-and-card-display-qa-report.md`(待写)

## 基线与状态

- 分支:`codex/slice-002-asset-ingestion`
- 基线 SHA:`60d3515`(feat: consolidate MVP implementation checkpoint)
- 当前提交:本切片提交(见 `git log --oneline -1`;基线 `60d3515`)
- 开始:2026-07-14;最后更新:2026-07-14
- 状态:`automated-verification`(slice 自身范围全绿)→ `code-review`(双轴完成)→ 审查修复已应用 + 复审绿 → `qa` 待办(Computer Use UX 门禁未执行 → 不可 `accepted`)

## 已完成的垂直行为

- **版本化画布偏好模块** `src/renderer/canvas-preferences.ts`:Zod 4.4.3 校验的 `CanvasPreferences`(version/viewMode/cardSize/fields),`DEFAULT_CANVAS_PREFERENCES`(grid/160/全 true),`loadCanvasPreferences(storage?)` / `saveCanvasPreferences(p, storage?)` / `migrateLegacy(storage)`,localStorage key `serpent.canvas-prefs.v1`。损坏/未知 version 回退默认;从遗留 key `serpent.asset-view-mode` / `serpent.asset-card-size` 迁移后清除。`CanvasPreferencesStorage` 可注入接口(测试缝,node 环境 vitest 用 Map stub)。
- **App.tsx 集成**:统一 `canvasPrefs` state + 派生 `assetViewMode`/`assetCardSize`(最小爆炸半径);card-size/视图模式经 `setCanvasPrefs` 路由;`saveCanvasPreferences` useEffect 取代散落 `setItem`;3 个工具栏内联 `ToolButton`(可访问名 `文件名`/`文件大小`/`修改日期`,aria-pressed 表达开关态);卡片 caption 按 `fields.*` 条件渲染(复用 `formatBytes`/`formatDate`/`displayName`);**条件化** `aria-label`(仅 `fields.name===false` 时设,可见时不设→可访问名来自文本内容)。
- **瀑布流首/尾完整**:调查确认**已满足**(`styles.css` padding 14px 顶/40px 底 + overflow:visible + break-inside:avoid + `.workspace-canvas` overflow:auto),无需修复。
- 大部分 0012 行为(普通滚轮滚动、Ctrl+wheel 缩放、macOS pinch、缩放锚点保持、连续加载、grid/masonry 同根、AssetSummary 21 字段批量返回无 N+1)**在上一切片已存在**——本次只补字段开关 + 版本化对象 + 测试。

## 公共测试缝

- `CanvasPreferencesStorage` 可注入接口(node 环境 vitest 无 localStorage → 注入 Map stub)。
- 重启 E2E:`SERPENT_E2E_USER_DATA_PATH` 稳定 profile + `SERPENT_E2E_RESTORE_RECENT=1`,使 localStorage 跨 `application.close()`→再 `launch()` 存活(对齐 `library-lifecycle.test.ts`)。
- no-requery:preload bridge 经 `contextBridge.exposeInMainWorld` + `Object.freeze` 不可写→无法装 IPC spy→回退为"切换字段前后 `.asset-card[data-asset-id]` 集合不变"的行为断言。

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
- **#4(b) 锚点无自动化测试**:rAF/视口断言 flaky;行为是预存在 `resizeAssetCards`(本切片未改);按项目规则属视觉行为,留 Computer Use/人工 QA,**不宣称通过**。
- **#6 帧率部分留人工 QA**:无可靠自动化;no-requery(IPC)部分已覆盖。
- **#7 smart-collection scope E2E 延迟**:global canvasPrefs 被所有 scope 渲染同读(构造一致);folder/trash/tag/collection 已覆盖,smart 留 by-construction 注释。

## 执行过的关键命令及结果摘要

- `npm run typecheck`:GREEN(tsc --noEmit + tsconfig.extension.json,0 新错误)。
- `npm run test:unit`:26 files / 259 passed。
- `npm run test:worker`:24 files / 536 passed + 1 skipped(platform skip,与交接一致)。
- `npm run lint`:GREEN(初次 3 个 unused-vars 错误——`existsSync`/`cardLocator`/`beforeEach`——已修;现 0 错误)。
- 回归 E2E(`media-preview` + `organization-search-trash`):4/4 通过(两处回归修复后)。
- 新 E2E `browsing-preferences`:2/2 通过。
- 全量 E2E(`npm run test:e2e`):15 passed / 2 failed——2 个失败均在 `process-lifecycle.test.ts`,`firstWindow()` 30s 超时。
- `git stash -u` + baseline 跑 `process-lifecycle`:baseline `60d3515` **同样 2/2 失败** → 预存在,非 slice 0012 引入。

## 遇到的失败、根因和解决方式

1. **`getByLabel('名称')` strict mode 冲突(4 个 E2E 失败)**:首版开关 label `显示名称` 含子串 `名称`,与 22 处 `getByLabel('名称')`(资源库/文件夹名输入框)子串匹配命中两元素。根因:子串 getByLabel 脆弱 + 新增含"名称"的可访问名。解决:改用纯字段名 `文件名`/`文件大小`/`修改日期`(零测试改动)。
2. **media-preview:48 `getByRole button /^automatic\.png\s/` 失败**:首版给卡片 button **始终**设 `aria-label={displayName}`,覆盖文本内容,可访问名从 `filename size · date` 变纯 `filename`。解决:条件化——仅 `fields.name===false` 时设。
3. **lint 3 个 unused-vars**:agent 写的测试含未用 import/var(`existsSync`/`cardLocator`/`beforeEach`)。解决:移除。
4. **process-lifecycle 2/2 失败(预存在)**:baseline `60d3515` 同样失败;清 stale 单实例锁文件(`SingletonLock`/`Socket`/`Cookie`)后仍失败 → 非 stale-lock。疑似默认 userData(`~/Library/Application Support/Serpent/`)的 `recent-library.json` 指向已删临时库,而 process-lifecycle 不设 `SERPENT_E2E`(非 e2e 模式)→ 启动自动恢复陈旧库→不开窗→`firstWindow` 超时。**非 slice 0012 引入,移交单独排查**(不阻塞本切片)。

## 当前已知问题、技术债和后续工作

- **Computer Use UX 门禁未执行**:本切片是 UI 切片,按 `development-process.md`/`CLAUDE.md` 必须主 agent 用 Computer Use 操作真实桌面 + 截图验收。当前环境无 Computer Use → 记为未执行 → slice **不可标 `accepted`**,移交具备能力的 agent/人工 QA。需验收:工具栏 3 开关可见/可点/pressed 态、卡片字段显隐、隐藏名称仍可访问、缩放锚点保持(对应 #4b)、窗口缩放布局。
- **#4(b) 锚点资产仍可见**:无自动化测试(flaky);待 Computer Use 视觉验收。
- **#6 帧率**:待人工/性能 QA。
- **process-lifecycle 预存在失败**:移交单独排查(默认 userData 陈旧 `recent-library.json` 疑似根因;或测试应自备 temp userData)。
- **Windows 平台**:完全未验证(无 runner)。
- **代码审查 4 项修复已应用**(agent `a913…`)+ 复审绿:descriptor 数组(App.tsx,行为保持)、PREF_KEY import(单元测试,消除假通过风险)、实际卡片宽度断言(E2E,`getComputedStyle(grid).gridTemplateColumns` 含 `${cardSize}px`)、tag/collection scope 扩展(E2E,smart 延迟 by-construction)。验证:typecheck/lint 绿、单元 17 passed、browsing-preferences 2 passed、回归+新 E2E 6/6 passed(exit 0)。

## 重要文件入口

- `src/renderer/canvas-preferences.ts` — 偏好模块(type/schema/DEFAULT/load/save/migrate)。
- `src/renderer/App.tsx` — 集成点(~5100 字段开关、~5470 卡片 button+条件 aria-label、~690 canvasPrefs state、~825 save effect)。
- `tests/unit/canvas-preferences.test.ts` — 17 单元测试(load/save/迁移/回退/clamp)。
- `tests/e2e/browsing-preferences.test.ts` — 2 E2E(重启持久化 + 可访问名/缩放/瀑布流/no-requery/全范围)。
- `docs/implementation/0012-design-decisions-2026-07-14.md` — 决策 + 实施笔记 + 回归修复记录。
