# 工作区标签页 QA

> 日期：2026-09-13
> 工单：`Serpent-738426`、`Serpent-bb3ce7`、`Serpent-83d71f`、`Serpent-d2bbe3`
> 结论：两项指定竞态修复、定向自动化与 Luna High 复审完成；冷标签取消恢复缓存竞态另开 `Serpent-d2bbe3` 并阻塞父工单；TABS-001–004 等待人类验收。

此前的人工复验发现切换标签白闪；算法实现后，Luna High 独立审阅发现缓存页面首帧可能
仍带有离开标签的滚动位置，且 Back/Forward 读取期间的新导航可能覆盖目标历史位置。
本轮修复这两条竞态并补充真实 Electron 回归断言。此前的跨标签异步提交、关闭非活动标签
误取消活动查询等路径也保留在测试中。本轮按
[导航算法](../implementation/2026-09-12-workspace-tab-navigation-algorithm.md)
完成协调器、快照缓存、App 接入和 E2E 收口。自动化通过不替代人类验收；此前的
“人类验收不通过”反馈已修复，现回到“待人类验收”。

Luna High 最终复审通过缓存首帧 viewport 原子恢复和 Back/Forward pending replay 防止旧位置
污染目标 entry 两项修复。另发现冷标签无快照恢复被切回取消时，旧画布可能被保存为冷标签
快照；此路径还没有自动化证据，已登记后续工单 `Serpent-d2bbe3`，父工单保持进行中。

## 自动化结果

| 范围 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `npm run typecheck` | 通过 |
| 导航协调器、快照缓存、标签控制器、视口恢复 | `npx vitest run --config vitest.config.ts tests/unit/workspace-navigation-coordinator.test.ts tests/unit/workspace-render-snapshot-cache.test.ts tests/unit/use-workspace-tabs.test.tsx tests/unit/workspace-scroll-position.test.ts` | 4 文件 / 21 项通过 |
| 改动文件 ESLint | `npx eslint src/preload/index.ts src/renderer/App.tsx src/renderer/use-workspace-tabs.ts src/renderer/workspace-scroll-position.ts src/renderer/workspace-navigation-coordinator.ts src/renderer/workspace-render-snapshot-cache.ts tests/e2e/workspace-tabs.test.ts tests/unit/use-workspace-tabs.test.tsx tests/unit/workspace-scroll-position.test.ts tests/unit/workspace-navigation-coordinator.test.ts tests/unit/workspace-render-snapshot-cache.test.ts` | 通过 |
| 隔离 userData 的 Windows 开发态 Electron 用户旅程 | `node scripts/run-e2e-isolated.mjs tests/e2e/workspace-tabs.test.ts` | 1 项通过 |

E2E 在隔离的临时目录、资源库与 `SERPENT_E2E_USER_DATA_PATH` 中运行，并在应用完整
退出后删除目录。仅当 `SERPENT_E2E=1` 时，Preload 的诊断接口允许对指定的下一次
文件夹或智能合集 browse session 延迟；正常应用不暴露该接口，也不改变请求时序。

E2E 覆盖：

1. 普通文件夹导航保持当前标签；加号新建“所有资产”页，关闭非活动旧页后仍显示新页。
2. 根目录滚动到 73%、文件夹滚动到 41%；缓存切换的首个 busy 帧和历史后退/前进均恢复视口。
3. 搜索和选择随标签恢复；防抖搜索提交后选择仍保留。
4. 人工延迟 A 的文件夹查询，快速执行 A/B/A；最后页面、资产和选择都属于 A。
5. 延迟目标标签的缓存刷新，逐帧核对首个目标画面仍在已保存的 41% 位置；Back 回放等待时转到另一文件夹，再 Back 回 A，仍恢复 A 的 41%。
6. 人工延迟智能合集查询时关闭非活动标签，活动查询仍完成并提交。
7. 在页面切换过程中逐帧检查已提交画布；无未遮挡空画布帧。
8. 文件夹与合集右键菜单只显示各自适用的菜单项；不提供“关闭右侧标签页”。
9. 在非活动文件夹标签上执行“在文件夹中显示”，焦点跳到侧栏目标且活动标签不变。

## 四列追溯

| 需求条目 | 实现位置 | 自动化证据 | 人工 / 平台证据 |
| --- | --- | --- | --- |
| 慢响应不得跨标签或跨资源库提交；关闭非活动标签不得取消活动请求 | `src/renderer/workspace-navigation-coordinator.ts:28`；`src/renderer/use-workspace-tabs.ts:129`；`src/renderer/App.tsx:4507` | `tests/unit/workspace-navigation-coordinator.test.ts:6`；`tests/unit/use-workspace-tabs.test.tsx:91`；`tests/e2e/workspace-tabs.test.ts:272` | Windows 开发态隔离 userData Electron E2E 通过；Computer Use 未执行 |
| 标签快照有界、按标签与资源库隔离，关闭标签或资源库时释放 | `src/renderer/workspace-render-snapshot-cache.ts:215`；`src/renderer/App.tsx:4730` | `tests/unit/workspace-render-snapshot-cache.test.ts:33`；`:61`；`:101` | 仅内存快照，无持久化；Computer Use 未执行 |
| 标签切换、普通导航和历史回放使用 token 校验与准备后提交 | `src/renderer/App.tsx:4511`；`:4755`；`:4785`；`:5414`；`:5505` | `tests/unit/use-workspace-tabs.test.tsx:130`；`tests/e2e/workspace-tabs.test.ts:272` | Windows 开发态 E2E 通过；macOS / packaged 未执行 |
| 缓存画面首次呈现前应用目标标签保存的视口 | `src/renderer/App.tsx:4825` | `tests/e2e/workspace-tabs.test.ts:381`；`:392` | 延迟 browse session 的首个 busy 目标帧断言为 41%；Computer Use 未执行 |
| Back/Forward 未完成时，新 push 不得把旧画布位置写进目标 entry | `src/renderer/App.tsx:3349`；`:4632`；`:4864`；`:4949`；`:4985` | `tests/unit/use-workspace-tabs.test.tsx:130`；`tests/e2e/workspace-tabs.test.ts:425`；`:440` | Windows 开发态 E2E 在延迟回放中切入另一文件夹，再回 A 仍恢复 41%；macOS / packaged 未执行 |
| 每个历史条目保存精确位置；同布局用 scrollTop，布局变化用进度比例 | `src/renderer/workspace-scroll-position.ts:3`；`:18`；`:35` | `tests/unit/workspace-scroll-position.test.ts:63`；`:75`；`:85`；`tests/e2e/workspace-tabs.test.ts:272` | E2E 证明后退回根目录恢复 73%、前进回文件夹恢复 41%；2 万资产长列表与不同 DPI 未执行 |
| 仅加号创建标签；右键菜单关闭、定位、复制等动作按页面类型提供 | `src/renderer/use-workspace-tabs.ts:143`；`:160`；`src/renderer/App.tsx:11680`；`src/renderer/AssetContextMenu.tsx:712` | `tests/unit/workspace-tab-presentation.test.ts:30`；`tests/unit/workspace-tabs-ui.test.tsx:76`；`tests/e2e/workspace-tabs.test.ts:272` | 菜单与侧栏焦点已由 Electron E2E 检查；复制剪贴板和外部文件浏览器未实测 |
| 切换期间保留前一已提交画面，不能白闪或展示空白帧 | `src/renderer/App.tsx:12308`；`:13212`；`src/renderer/styles.css:8971` | `tests/unit/workspace-scroll-position.test.ts:85`；`tests/e2e/workspace-tabs.test.ts:94`；`:272` | 自动逐帧 E2E 通过；仍等待用户本人验收 |

## 人工验收步骤

### TABS-001 基本导航与关闭

打开资源库，确认只有初始标签；点击文件夹、合集、回收站时标签数不增加；点击加号新增
“所有资产”；滚动、搜索、选择后切换标签，并用前进/后退恢复页面与位置；用关闭按钮、
右键关闭和“关闭其他标签页”，最后关闭仅剩标签。

预期：普通导航只替换当前标签；每个标签保留自己的页面、历史、搜索/筛选、选择和精确
位置；最后一个标签关闭后复位到“所有资产”；切换无白闪、空帧或从顶部跳回目标位置。

### TABS-002 文件夹与合集菜单

打开深层文件夹并切到其他标签，右键原标签，试“在文件夹中显示”“复制名称”“复制路径”
和“在 Finder / 文件浏览器中打开”；再检查合集的“在合集中显示”和“复制名称”。

预期：侧栏展开父级并聚焦目标而不切换活动标签；复制内容正确；文件夹可由系统文件浏览器
打开；合集不显示路径动作。

### TABS-003 视觉与可访问性

在亮/暗主题、中英文和窄窗口下创建多个标签；测试 ArrowLeft/ArrowRight、Home/End、Delete、
Shift+F10、窗口缩放和层级投影 0–3。

预期：页签呈连续圆滑文件夹轮廓并接入内容区；活动态清楚；加号始终可用；键盘与鼠标操作
一致；页签与范围栏无缝，顶栏控件垂直对齐；阴影跟随层级投影；相邻标签无竖线。

### TABS-004 溢出滑动

创建足够多的标签使标签条溢出，在标签条上使用鼠标滚轮；macOS 再试触控板双指左右和上下滑动。

预期：标签条左右移动而画布不滚动；加号留在末尾；pinch / Ctrl+滚轮不带动标签条。

## 未验证边界

- Luna High 已复查两项指定修复并通过；另有冷标签取消恢复时误缓存旧画布的 P2（`Serpent-d2bbe3`）尚未实现或验证。Computer Use 不可用（`getState()` 返回 `apps: []`，且没有 `cua.listApps()`），因此没有人眼验收证据，四项仍待人工验收。
- packaged、macOS Finder、多个 DPI、2 万资产滚动位置恢复未执行。
- E2E 验证文件浏览器菜单项存在，没有实际启动外部程序；复制菜单项也未读取系统剪贴板核验。
- 全量 lint 与全量 test 本轮未重新运行；此前开发日志记录了既有 lint 失败与一次挂起后终止的全量 test，不计为通过。
