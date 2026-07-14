# 0012 代码审查报告 — 资产画布视图与卡片信息配置

> 审查基点:`HEAD` = `60d3515`(feat: consolidate MVP implementation checkpoint)
> Diff 范围:工作树未提交改动 —— `git diff HEAD -- src/renderer/App.tsx`(+62/-40)+ 新文件 `src/renderer/canvas-preferences.ts`、`tests/unit/canvas-preferences.test.ts`、`tests/e2e/browsing-preferences.test.ts`
> 双轴:Standards(仓库规范/架构边界/代码异味)+ Spec(规格符合度)
> Spec 来源:`docs/implementation/0012-asset-canvas-views-and-card-display-vertical-slice.md` + `docs/implementation/0012-design-decisions-2026-07-14.md`
> 日期:2026-07-14

## Standards 轴

### 架构不变量(AGENTS.md)— 全部满足,无 hard violation

- **Renderer 永不接收原始路径/SQL**:`canvas-preferences.ts` 是纯 renderer localStorage 模块,无路径/SQL 暴露。
- **Library Worker 是 DB 唯一所有者**:未新增 DB 表/IPC;画布偏好是客户端状态(localStorage),不进资源库库。
- **跨进程 I/O 经 Zod 校验**:`canvasPreferencesSchema.safeParse` 守卫加载边界,损坏 JSON/未知 version 回退 `DEFAULT_CANVAS_PREFERENCES`。
- 单个 `useEffect(() => saveCanvasPreferences(canvasPrefs), [canvasPrefs])` 取代散落的 `setItem` 调用 —— **消除了既有的 Shotgun Surgery**(此前 view-mode 与 card-size 分散在多处 localStorage 读写)。

### S1 — Duplicated Code(judgement,已修)

3 个字段开关 `ToolButton`(文件名/文件大小/修改日期)结构同形,仅 icon/label/field-key 不同。
→ **修复**:抽 field-descriptor 数组 + `.map`(`src/renderer/App.tsx` ~5101),契合规格"后续字段沿相同 schema 扩展"。计算键 `[field]` 经局部变量 + `as boolean` 满足 readonly 字段约束。状态:**已修**(行为保持:同 icon/label/pressed/onClick)。

### S2 — Duplicated Code / 假通过风险(judgement,已修)

`tests/unit/canvas-preferences.test.ts` 重声明 `const PREF_KEY = 'serpent.canvas-prefs.v1'` 而非从模块 import —— 模块改 key 名时测试用旧值,**假通过**。
→ **修复**:从 `../../src/renderer/canvas-preferences` import `PREF_KEY`,删本地声明。遗留 key 常量保留为测试 arrange 契约。状态:**已修**。

### Standards 小结

0 hard violation;2 judgement-level Duplicated Code,均已修。

## Spec 轴

### P1 — #3 实际卡片宽度未断言(partial → 已修)

规格验收#3:"96/160/320 三档及 Ctrl+Wheel/pinch 的**实际卡片宽度**、上下限与方向有自动化验证。" 原测试只断言**滑块值**,未断言实际渲染宽度。
→ **修复**:E2E 加 `getComputedStyle(assetGrid).gridTemplateColumns` 含 `${cardSize}px` 断言(切 grid 模式后,96→含"96px"、320→含"320px")。状态:**已修**。

### P2 — #7 全范围一致性仅 folder+trash(partial → 部分修)

规格#2:"对所有文件夹、标签、合集、智能合集和回收站一致生效。" 原测试仅 folder+trash。
→ **修复**:扩展 tag scope + collection scope 导航与断言(创建标签/合集、右键分配、侧栏进入、断言开关态不变);smart-collection scope **延迟**(注释:global canvasPrefs 被所有 scope 渲染同读,构造一致;search-then-save setup 重,延迟)。状态:**部分修**(tag/collection 已加;smart 延迟,by-construction)。

### P3 — #4(b) 锚点资产仍可见无自动化测试(missing → 记录不修)

规格#4:"缩放后原视口锚点资产仍可见。" 无自动化测试。rAF/视口断言 flaky;行为是预存在 `resizeAssetCards`(`App.tsx:759-802`,本切片未改,仅 card-size 写入路由经 setCanvasPrefs)。状态:**记录不修**,留 Computer Use / 人工 QA 视觉验收(按 `CLAUDE.md` 不宣称通过)。

### P4 — #6 帧率部分(partial → 记录不修)

规格#6:"不显著降低滚动帧率。" no-requery(IPC)已覆盖(切换字段前后 `.asset-card[data-asset-id]` 集合不变);帧率无可靠自动化。状态:**记录**,留人工/性能 QA。

### P5 — #3 三档(RECORDED 偏离,用户确认,非待办)

规格"三档"实现为连续滑块(96–320 step 8)而非离散三档。用户 Q3 已选"测试参考点"。状态:**用户确认决策**,记录于设计决策文档,非审查待办。

### Spec 已核实正确

- #1 字段独立开关 + 默认密度(name/size/date 全 true)+ 重启恢复。
- #2 共享 `canvasPrefs` state + 无 per-card IPC(批量 `asset.search` 不变)。
- #4(a) 普通滚轮不缩放。
- #5 瀑布流 scrollTop=0 首项完整 + 滚到底末项完整。
- #7 可访问名:条件化 `aria-label`(name 隐藏时设,可见时不设→可访问名来自文本内容)。
- 实施边界:迁移/回退(单元测试覆盖)、不新增后端字段(复用既有 AssetSummary)。

## 修复后复审

- `npm run typecheck`:GREEN。
- `npm run lint`:GREEN。
- `npx vitest run tests/unit/canvas-preferences.test.ts`:17 passed。
- `node scripts/run-e2e.mjs tests/e2e/browsing-preferences.test.ts`:2 passed(含实际宽度断言 + tag/collection scope)。
- S1/S2/P1 已修;P2 部分修;P3/P4 记录不修(Computer Use/人工 QA);P5 用户确认。
- 回归 E2E(media-preview + organization-search-trash + browsing-preferences)重跑结果见 QA 报告(确认 App.tsx descriptor 改动无回归)。

## 待处理(非阻断,记录移交)

- **Computer Use UX 门禁未执行**:当前 agent 环境无 Computer Use,按 `development-process.md`/`CLAUDE.md` 不可标 `accepted`,移交具备能力的主 agent / 人工 QA。
- **process-lifecycle 2/2 预存在失败**:baseline `60d3515` 同样失败,非本切片引入;疑似默认 userData 陈旧 `recent-library.json` 导致非-e2e 模式启动自动恢复陈旧库→不开窗→`firstWindow` 超时。移交单独排查。
