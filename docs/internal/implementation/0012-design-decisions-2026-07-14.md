# 0012 设计决策 — 2026-07-14

> 配套文档:`docs/internal/implementation/0012-asset-canvas-views-and-card-display-vertical-slice.md`。
> 记录 brainstorming 阶段敲定的设计决策 + 实施/测试计划。双轴审查的 Spec 轴以切片规格 + 本文档为准。
> 用户指示(`/implement` +「不要阻挡开发」)优先于 brainstorming 的 HARD-GATE:设计不再单独等待审批,直接据此实施;待定产品需求写入 `docs/pending-requirements.md` 并在 `mvp-roadmap.md` / `CLAUDE.md` 记录。

## 现状(understand workflow `wkw501bdd` 带行号引用)

slice 0012 的多数行为**已存在**(印证交接文档「foundations present」):

- 普通滚轮只滚动不缩放(`App.tsx:836` guard);Ctrl+wheel 调整卡片尺寸(`App.tsx:835-852`);macOS 触控板 pinch 经 Chromium `ctrlKey` 合成已工作。
- **缩放锚点保持**已在 `resizeAssetCards`(`App.tsx:759-802`)完整实现(记录锚点 ratio,双 rAF 后补偿 scroll)。
- 卡片尺寸滑块 96–320 step 8 + 视图模式 grid/masonry,均持久化到 localStorage,**共享同一滚动根**。
- 连续加载(IntersectionObserver + onScroll fallback)。
- AssetSummary 21 个字段(含 `displayName`/`byteSize`/`modifiedAt`)在**单次批量** `asset.search` 返回(`worker/index.ts:424`)——无 N+1。

真正缺口:(1) 名称/大小/日期字段开关——卡片 caption 当前硬编码;(2) 散落的 localStorage key → 收敛成**一个**带 version + 迁移的对象;(3) 持久化/全范围一致性/可访问名称/缩放/锚点/规模/瀑布流首尾的**测试**全无。

## 已敲定决策(2026-07-14,与用户)

1. **偏好范围 = 全局。** 一个版本化对象 `serpent.canvas-prefs.v1` 跨资源库共享,保留今天 view-mode/card-size 的全局行为。按资源库 = 未来选项,不在本次。
2. **开关 UI = 工具栏内联切换按钮。** 在 grid/masonry 切换旁加三个 pressed/unpressed `ToolButton`,可访问名(aria-label+title)用**纯字段名** `文件名`/`文件大小`/`修改日期`(而非 `显示名称` 等)——避免与现有 `getByLabel('名称')`(资源库/文件夹名输入框,22 处)子串碰撞;这三个纯字段名不含 `名称`/裸`大小`/裸`日期` 子串,也不与 `资产缩略图大小` 等互为子串。aria-pressed 表达开关态。
3. **96/160/320 = 测试参考点。** 保留连续滑块;测试在 small/medium/large 参考点上断言实际宽度 + 边界 `[96,320]` + 缩放方向(符号),不做离散三档吸附。

## 延迟(不阻塞,非本切片)

- 按资源库的画布偏好。
- pinch 灵敏度系数调优、显式手势检测、预览模态框 zoom 去重 → slice 0013。
- 10 万帧率:可自动化部分 = 字段开关不触发后端重查(IPC 计数不变);帧率部分留作人工 QA(无可靠自动化)。

## 架构

- 新纯模块 `src/renderer/canvas-preferences.ts`:
  - `CanvasPreferences = { version: 1, viewMode: 'grid'|'masonry', cardSize: number, fields: { name: boolean; size: boolean; date: boolean } }` + Zod schema(若 renderer 不可 import zod 则手动校验,实施时确认)。
  - `DEFAULT_CANVAS_PREFERENCES` = viewMode `'grid'`、cardSize `160`、fields 全 `true`(当前信息密度)。
  - `loadCanvasPreferences()`:读 `serpent.canvas-prefs.v1`;校验;缺失/损坏/未知 version → 从遗留 key `serpent.asset-view-mode`/`serpent.asset-card-size` 迁移(若有)否则默认;迁移成功后清除遗留 key。
  - `saveCanvasPreferences(p)`:写 JSON。
- App.tsx 集成:
  - 用单个 `canvasPrefs` state(load on mount、save on change)替换散落的 view-mode/card-size localStorage 读写。
  - 工具栏加 3 个内联 `ToolButton`(名称/大小/日期),带 `aria-label` + `aria-pressed`,切换 `fields.*`。
  - 卡片 caption:按 `fields.*` 条件渲染 name/size/date(复用 `formatBytes`/`formatDate`/`displayName`)。可访问名**条件化**:`fields.name===true` 时不设 `aria-label`,可访问名来自文本内容(含 size/date,保留 `filename size · date` 形式);`fields.name===false` 时设 `aria-label={displayName}`(`title` 始终保留)——满足规格「隐藏名称时仍保留可访问名」,且不破坏基于文本的可访问名断言。
  - 瀑布流首/尾完整:调查确认**已满足**(`styles.css` padding 14px 顶/40px 底 + `overflow:visible` + `break-inside:avoid` + `.workspace-canvas` `overflow:auto`),无需修复;E2E 仅做断言。
- **无** protocol/IPC/Worker/DB 变更(偏好是客户端状态;AssetSummary 已批量返回 → 无 N+1)。

## 测试

- 单元(vitest, TDD) `tests/unit/canvas-preferences.test.ts`:load/save、损坏→默认、未知 version→默认、遗留迁移、边界 clamp、round-trip。
- E2E(Playwright) `tests/e2e/browsing-preferences.test.ts`(对齐 `library-lifecycle.test.ts` 重启模式):重启持久化;全范围一致性(folder→trash→back 保留);名称隐藏时可访问名;Ctrl+wheel 边界+方向+锚点;瀑布流 scrollTop=0 首项完整 + 滚到底末项完整;字段开关不触发新 `asset.search` IPC。

## 实施中发现并修复的回归

1. **开关 label 与 `getByLabel('名称')` 子串碰撞**:首版用 `显示名称`/`显示大小`/`显示日期`,其中 `显示名称` 含子串 `名称`,与现有 22 处 `getByLabel('名称')`(资源库/文件夹名输入框)在子串匹配下命中两个元素 → 4 个 E2E 严格模式失败。修复:改用纯字段名 `文件名`/`文件大小`/`修改日期`(不含碰撞子串),零测试改动。
2. **始终覆盖可访问名**:首版给卡片 `<button>` **始终**设 `aria-label={displayName}`,覆盖文本内容,使可访问名从 `filename size · date` 变成纯 `filename`,破坏 `getByRole('button',{name:/^filename\s/})` 类断言(media-preview:48)。修复:条件化——仅 `fields.name===false` 时设 `aria-label`。

两处均在回归 E2E(media-preview + organization-search-trash)中捕获并修复,4/4 回归通过。

## 待定产品需求

无阻塞项。若实施中浮现,写入 `docs/pending-requirements.md` 并在 `docs/internal/implementation/mvp-roadmap.md` + `CLAUDE.md` 加指针。
