# 0012 代码审查报告 — 资产画布视图与卡片信息配置

> 审查基点:`60d3515`(feat: consolidate MVP implementation checkpoint)
> Diff 范围:`60d3515...75019d9` + 本轮验收修复；最终提交 SHA 见开发日志
> 双轴:Standards(仓库规范/架构边界/代码异味)+ Spec(规格符合度)
> Spec 来源:`docs/implementation/0012-asset-canvas-views-and-card-display-vertical-slice.md` + `docs/implementation/0012-design-decisions-2026-07-14.md`
> 日期:2026-07-14

## 最终复审（覆盖下方首轮审查中的过时结论）

- Standards：共享 `CARD_SIZE_MIN/MAX` 消除 App/schema 常量漂移；遗留卡片尺寸改用严格 `Number()`，拒绝 `200px` 等宽松解析；仅 E2E 模式暴露只读请求计数，不向生产 renderer 增加 Main/Worker/DB 能力。
- Spec：损坏/未知 v1 会尝试有效遗留对；重启覆盖三个字段；96/160/320 对 grid 与 masonry 均测真实 card bbox；no-requery 直接检查 `asset.search.request` 计数；folder/tag/collection/smart/root/all/trash 均验证真实字段呈现。
- Computer Use：真实 Electron 创建库并导入 5 张不同比例图片，验证字段开关、平铺/瀑布流、96–320、首尾、锚点及窄窗。捕获并修复空 caption 与工具栏逐字换行/设置被裁掉的问题。
- 仍未闭合：10 万资产交互帧率没有专门性能证据；Windows 没有 runner。两项属于平台/性能风险，不构成已验证 macOS 行为的代码阻断。

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

### P2 — #7 全范围一致性（首轮 partial → 最终已修）

规格#2:"对所有文件夹、标签、合集、智能合集和回收站一致生效。" 原测试仅 folder+trash。
→ **最终修复**:扩展到 tag/collection/smart/root/all/trash，并断言卡片实际字段显隐、可访问名和日期，而非只检查工具栏状态。状态:**已修**。

### P3 — #4(b) 锚点资产仍可见（最终以自动化 + Computer Use 补证）

73 资产连续浏览 E2E 已覆盖锚点；本轮 Computer Use 在滚动后以 03-player 为中心从 320 缩到 96，03-player 仍处于可见首行。截图见 QA evidence。状态:**已补证**。

### P4 — #6 帧率部分(partial → 记录不修)

规格#6:"不显著降低滚动帧率。" no-requery 已由 preload E2E-only 请求计数直接证明；旧的 card-ID 集合断言是假阳性，已删除。10 万资产帧率仍无可靠证据。状态:**部分通过，性能项保留**。

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
- `npx vitest run tests/unit/canvas-preferences.test.ts`:20 passed。
- `node scripts/run-e2e.mjs tests/e2e/browsing-preferences.test.ts`:2 passed(含真实 bbox、请求计数、全 scope 与窄窗布局)。
- S1/S2/P1/P2 已修；P3 自动化 + Computer Use 补证；P4 的 no-requery 已修、10 万帧率保留；P5 用户确认。
- 回归 E2E(media-preview + organization-search-trash + browsing-preferences)重跑结果见 QA 报告(确认 App.tsx descriptor 改动无回归)。

## 待处理(非阻断,记录移交)

- **10 万资产帧率**：no-requery 已有直接证据，但需要专门规模/帧率测试。
- **Windows**：无 runner，未执行真实平台 QA。
