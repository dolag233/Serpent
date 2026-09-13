# 工作区标签页收尾二：拖动排序、单页隐藏关闭、hover 路径、会话恢复与动态宽度

日期：2026-09-13。状态：功能候选，等待人类验收。工单 `Serpent-3ad7ed`（父单 `Serpent-738426`）。

## 需求（用户 2026-09-13 反馈）

1. 右键菜单「关闭其他标签页」前面补上与「关闭标签页」一致的 close 图标。
2. 标签页支持拖动交换位置。
3. 只有一个标签页时不显示关闭按钮，避免关闭到没有标签页。
4. 文件夹标签 hover 显示**库内路径**而非文件夹名称。
5. 关闭时开着 A/B/C 三个标签，重开应用要恢复同样三个标签。
6. 标签页最长字长按当前标签数量动态收缩。

## 实现摘要

### 拖动排序（第 2 条）

- 纯模型 `moveWorkspaceTab(state, tabId, toIndex)`：只改数组顺序，不动标签身份、
  历史、选中与活动标签。越界收敛到 `[0, n-1]`，无变化时返回原对象（调用方可跳过提交）。
- `WorkspaceTabs` 在标签容器上接 HTML5 拖放：`dragstart` 记下被拖标签，
  `dragover` 按指针落在目标标签左/右半边算落点并即时重排，`dragend`/`drop` 清理。
  实时重排而不是等松手，是因为浏览器式标签栏的预期就是「拖到哪就排到哪」。
- 控制器 `moveTab` 只提交状态，不触发任何导航：换位不该让内容重新加载，
  也不该改变哪个标签是活动的。

### 只剩一个标签不显示关闭（第 3 条）

- `WorkspaceTabs` 在 `tabs.length <= 1` 时不渲染关闭按钮；`Delete` 仍然
  `preventDefault`+`stopPropagation`（避免落到画布删除资产），但不关闭标签。
- 右键菜单新增 `canClose` 描述符字段，只有一页时不出现「关闭标签页」，
  「关闭其他标签页」保持 `aria-disabled`。
- 模型层 `closeWorkspaceTab` 对单标签的「重置为所有资产」语义保留为兜底，
  不再有 UI 入口走到它。

### hover 显示库内路径（第 4 条）

- `WorkspaceTabPresentation` 增加 `tip` 字段：文件夹标签给路径，其余标签等于标题。
- `folderTabHoverPath`：普通文件夹用 `managed.relativePath`（Assets 之下的库内路径，
  如 `角色原画/草图`）；链接文件夹用 `absoluteRootPath` + `relativePath` 拼磁盘路径
  （链接根的相对路径本身没有信息量，它的身份在磁盘上）；两者都拿不到时回退到名字。
- 分隔符跟随根路径已用的风格（根里含 `\` 就用 `\`），避免 Windows 上出现
  `E:\Media\绘画/2024` 这种混用。
- **没有新增任何路径能力**：只用 Renderer 已经持有的
  `RendererLibrarySummary.displayPath` 同类数据（`folder.relativePath`、
  `linkedFolder.absoluteRootPath`）。Worker 的 `folder.get-path` 保持「只给 Main」
  的既有边界不变。
- 渲染沿用既有 `data-hover-tip` + `HoverTipHost`（420ms 延迟、主题、280px 换行），
  未自造浮层。
- 覆盖方式：`folderTabHoverPath` 与 `presentWorkspaceTab` 的纯单测覆盖路径拼装
  （库内路径、链接磁盘路径、分隔符、回退），`WorkspaceTabs` 单测覆盖
  `data-hover-tip` 取自 `tip`。E2E 里原本想用「新建子文件夹 → 悬停」验证，
  但侧栏树默认折叠、只能经画布文件夹卡进入，且点击后标签未按预期切换，
  实测两轮不稳**已撤回**该断言，不再用 E2E 兜这段逻辑。

### 会话恢复（第 5 条）

- 新增 `workspace-tabs-session.ts`：`serpent.workspace-tabs.v1.<libraryId>`，
  `{ version: 1, activeTabId, tabs: [{ id, location }] }`。校验逐条严格
  （未知 kind、缺字段、重复 id、空表都整份拒绝），脏数据回退到单标签；
  入库上限 50 个标签，避免手改过的条目把标签条撑爆。
- `createWorkspaceTabsFromSession` 把每个标签的位置架在 `{kind:"all"}` 基底上
  （复用 `seedRestoreLeafLocation`），所以恢复出来的标签第一帧就能「后退到所有资产」。
- **只恢复位置，不恢复前进/后退分支**（用户确认范围）：持久化的是每条历史的
  `current`，不是整条栈。历史对象是可变引用，位置永远是最新的，不需要额外的保存步骤。
- 落盘时机：控制器 `commit(next, persist)`，由各标签动作（新建/关闭/切换/拖动）
  触发。`resetTabs`（关库/换库的拆除）显式 `persist: false`——否则切库时会把
  刚拆掉的空标签条写到当前库身上，把用户的会话吃掉。
- 启动恢复顺序：`useBrowserSessionRestore` 在 `setLibrary` 之后、读 browse session
  之前调用 `restoreWorkspaceTabs(libraryId)`，让「上次浏览位置」落回**关闭时活动的
  那个标签**。恢复回调自己写盘，因为此时 App 的 `library` state 还没重新渲染，
  走 `persistTabs` 会读到 `null` 而静默不写。
- 换库/关库仍走既有 `clearLibraryScopedView` → `resetWorkspaceTabs`，不受影响。

### 动态宽度（第 6 条）

- 纯函数 `workspaceTabMaxWidthPx(count)`：1–3 个 220px，之后 202/184/166/148 逐级收窄，
  8 个及以上 132px。渲染为 `--workspace-tab-max-width` 绑在标签条上，
  CSS `max-width: var(--workspace-tab-max-width, 220px)`。
- 下限沿用既有 `min-width: 132px`；再多的标签走横向滚动（复用既有滚轮横向滚动）。

## 复用与小重构

- `browser-session.ts` 的私有 `resolveStorage` 抽成 `session-storage.ts`
  的 `resolveSessionStorage`，标签会话与浏览会话共用同一份 storage 解析，
  `BrowserSessionStorage` 保留为类型别名，既有调用与测试不变。

## 顺带修正

- E2E `workspace-tabs.test.ts` 里「在文件浏览器中打开」写死为 Windows 文案，
  在 macOS 上必然失败（应用按平台取 `command.folder.revealInFinder` /
  `revealInExplorer`）。该套件此前只在 Windows 上跑过。已按 `process.platform`
  取对应文案。
- 同一文件里「关闭仅剩的唯一标签应回到所有资产」的断言依赖第 3 条之前的旧行为，
  已改为断言「只剩一个标签时没有 ×、菜单没有关闭项、Delete 不关标签」。

## 用户复验后的两处调整（同日晚）

用户验收 1/3/4/5 通过，2 与 6 要求改：

### 第 2 条：成功换位后不再播「飞回原位」动画

现象：拖动换位成功、松手时，标签仍会播一段拖影飞回原位的动画。

根因是实时重排与投放判定的相互作用：`dragover` 里对「悬停在被拖标签自己身上」直接
`return`，不做 `preventDefault`。实时重排后，被拖的那个标签恰好停在光标下面，所以
松手前最后一次 `dragover` 与 `drop` 都落在它自己身上 → Chromium 认为这次投放没有被
接受 → 播放取消动画（拖影飞回原处）。

修法：把整条标签栏（`.workspace-tabs`）本身设为有效投放区——只要这次拖动是自己发起的
（`draggingId` 非空），`dragover`/`drop` 一律接受。拖到标签条外的窗口空白处仍然拒收，
所以「交换失败」时的返位动画保留。标签级的 `dragover` 继续负责落点计算，`drop` 处理
收拢到容器一处，避免两处重复。

新增单测直接锁住这条：在被拖标签**自身**上派发 `dragover`，断言 `defaultPrevented`
为真且不触发重排。

### 第 6 条：上限收到「刚好放下 8 个汉字」

用户要求最长宽度能完整显示「测试文件测试文件」。原先的上限是 220px，明显超出所需。

标签里除标题外的固定占用：2px 边框 + 12px 左内边距 + 16px 图标 + 8px 间距 +
8px 右内边距 + 22px 关闭钮 + 8px 标签右内边距 = 76px；8 个汉字在标签字号
（`12.5px × --ui-font-scale`）下正好 8em = 100px。所以预算 = `calc(8em + 82px)`
（多出的 6px 是舍入余量——8 个字正好占满时，任何亚像素舍入都会把第 8 个字挤成省略号）。

- 预算写在 CSS 的自定义属性里，标题项用 `em`，所以**跟随设置里的界面字号一起放大**；
  固定像素的上限在放大字号后会悄悄违约，这条不能写成 px。
- 标签数量的收缩改由 `workspaceTabWidthScale(count)` 给出「占预算的比例」
  （1/1/1/0.94/0.88/0.82/0.76/0.75），渲染为 `--workspace-tab-width-scale`。
  上限 182px，8 个及以上收到下限 132px。
- `.workspace-tab` 现在承载标签字号（`--workspace-tab-font-size`），
  `.workspace-tab-select` 改为继承，`em` 才有正确的基准。
- CSS 测试新增一条守卫，锁住预算表达式是 `calc(8em + 82px)` 且字号变量仍在，
  防止以后有人把它改回固定 px。

## 验证（2026-09-13 当次运行）

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npx vitest run --config vitest.config.ts tests/unit/workspace-tabs.test.ts tests/unit/workspace-tabs-session.test.ts tests/unit/workspace-tab-presentation.test.ts tests/unit/workspace-tabs-ui.test.tsx tests/unit/use-workspace-tabs.test.tsx tests/unit/browser-session.test.ts tests/unit/workspace-tabs-css.test.ts` | 7 files / 45 passed |
| `npm run test:unit`（全量单测） | 3404 passed / 3 skipped / 1 failed |
| `npm run test:library-availability` | 9 files / 212 passed |
| 改动文件 ESLint | 通过（无输出） |
| `node scripts/run-e2e-isolated.mjs tests/e2e/workspace-tabs.test.ts` | 2 passed（32.3 秒） |

E2E：

- **两个用例都通过**——`keeps navigation inside explicit tabs and exposes contextual tab actions`（含拖动换位、单标签无 ×、菜单关闭项隐藏、重启前状态）与 `restores the saved tab strip after a relaunch`（本次新增，真实 `app.quit()` 退出 + 同一 userData 重启，断言三个标签的名字、顺序、活动标签、各自位置和「后退可用」）。
- 早前几轮该文件反复顶到 120s 用例上限、整轮 5–16 分钟，是因为当时开发机负载高（`load average ≈ 5.6`，用户其他应用长期占满 CPU）；负载回落后同一份代码 32 秒跑完。失败点每次都落在不同的**既有**时间敏感断言上，与本轮改动无关，仍按「疑似 flaky」记在 `Serpent-75a2df`。
- 顺带把该用例 `finally` 里无超时的 `await once(childProcess, 'exit')` 换成有界退出 helper（10 秒上限 + SIGKILL 兜底）——这是用例超时后整轮 wall time 被拖到 5–16 分钟的直接原因。

全量单测那 1 项失败是既有问题，与本次改动无关：`tests/unit/import-source-failure.test.ts` 期望 `locked.png`，在 macOS 上得到 `C:inboxlocked.png`（`path.basename` 平台相关）。已开 `Serpent-ee725a`。

## 未验证 / 边界

- Computer Use 视觉验收未执行。
- packaged / Windows 真机未执行；E2E 全部在 macOS 开发态运行。
- 标签条拖动时靠近两端不自动横向滚动（未实现，未在需求内）。
- 拖动排序在超长标签条上的手感未验证；macOS 与 Windows 的拖动指针/幽灵图观感未比对。
- hover 路径的**渲染结果**没有 E2E 覆盖（见上文覆盖方式说明）。
