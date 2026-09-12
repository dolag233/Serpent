# 工作区标签页

日期：2026-09-12。状态：功能候选，等待人类验收。

## 需求与设计

- 顶部原面包屑位置放置浏览器式标签栏；普通导航替换当前标签，仅加号新增。
- 新标签进入所有资产；关闭最后标签保留一个所有资产页。
- 各标签保存独立浏览上下文与历史；现有页面入口均纳入范围。
- 文件夹支持侧栏定位、复制路径、复制名称、系统打开；合集支持侧栏定位、复制名称。
- 复用 Icons、主题 token、标准 hover tip、菜单体系和导航能力，保留面包屑父路径导航。
- 用户指定 Luna high 处理状态和测试，主 agent 负责 UI；最终审查模型已询问。

## 实现摘要

- 新增独立标签状态模型与控制器，每个标签持有导航历史、搜索/筛选/排序、
  递归开关、滚动和选择上下文；每条历史单独保存精确偏移、滚动范围与百分比，
  切换标签及前进/后退都在布局稳定后恢复。
- 顶部原面包屑区域改为连续的文件夹页签轮廓；活动页签以圆滑肩部接入内容区，
  面包屑保留在内容标题中，父路径导航能力不丢失。
- 右键菜单复用统一菜单体系；文件夹复用既有路径复制和系统文件浏览器命令，合集
  只显示适用动作。
- 侧栏定位会展开父级、滚动并聚焦目标行，且不切换当前活动标签。
- 关闭/切换资源库时重置标签，避免跨库保存失效实体 ID。
- 既有 Electron E2E 中使用 `/所有资产/` 的宽泛按钮定位已改为精确名称，
  避免匹配新增的“关闭标签页：所有资产”按钮。
- 活动页签与范围栏之间的缝：页签列表 `overflow-x: auto` 会把另一轴裁成
  `hidden`，负 margin 和 1px canvas 阴影盖不住顶栏 `border-bottom`；该 1px
  即使改成透明仍占用边框盒并把 `--pane` 露在 canvas 页签和工作区之间。
  有页签时去掉顶栏底边和 elevation 阴影，侧栏改用顶部发丝线。
- 顶栏前进/后退、设置、资源库、搜索未垂直居中：`.toolbar-cluster` 的
  `line-height: 1.35` 给 28px 控件加了 inline strut。改为 `line-height: 1`，
  控件锁 28px 并 `align-self: center`；页签背景仍拉满工具栏，标题行与加号
  走同一条中线。
- 页签图标与标题竖直未齐：12.5px 标题曾锁 16px 行高，字面偏上；图标
  `translate: 0 -1px` 不够。改为标题 `line-height: 1`（与关闭按钮同一中线），
  图标上移 2px。选择区与关闭按钮都 `align-self: flex-start`。
- 页签顶部不要抵满窗口、轮廓更圆：先用 8px 空隙和 16px 肩部；用户要求空隙
  改小、圆角减 2px 后，改为 `--ui-space-1`（4px）空隙、曲线
  `calc(var(--ui-space-4) - 2px)`（14px）。标题行仍对齐顶栏 28px 中线。
- 多标签横向浏览：纵向鼠标滚轮和触控板两指滑动都改写标签条 `scrollLeft`。
  pinch / Ctrl+滚轮不拦截。横向手势复用 `isPrimarilyHorizontalWheel`。
- 顶栏两侧贴齐侧栏列：前进/菜单/资源库的左缘对齐左栏右缘，搜索框右缘对齐
  Inspector 左缘（去掉中间列 14/12px 内边距，不把控件拉进侧栏列）。搜索在
  有标签时由 240px 收到 216px。侧栏收起时仍预留折叠开关。
- 活动页签投下阴影：复用设置里的层级投影（`--elev-size` / `--elev-intensity`，
  0 级 `:not([data-elevation="0"])` 不绘制）。新增 `--shadow-workspace-tab`，
  亮/暗各一套底 alpha。顶栏本身仍无 elevation 阴影；页签列表 `overflow-y`
  裁掉落向画布的分量，避免活动页签与范围栏之间再夹缝。
- 相邻页签之间的竖向发丝线：非活动页签 `::after` 1px `--divider-soft`。已去掉，
  只保留活动页签自身轮廓。
- 加号离末标签过远：列表 `padding-inline` 为右肩部留了曲线宽，外加 4px gap。
  已去掉 gap，加号负 margin 收进肩部沟槽，与末标签相隔 `--ui-space-1`。

## 验证

- `npm run typecheck`：通过。
- 定向 ESLint：通过。
- `npx vitest run tests/unit/workspace-tabs-css.test.ts tests/unit/theme-css-tokens.test.ts tests/unit/workspace-tabs-ui.test.tsx tests/unit/workspace-tab-strip-scroll.test.ts`：4 文件、17 项通过。新增 token 检查暴露的 `asset-sync-status` mask 裸 `#000` 已改用主题 token。
- `node scripts/run-e2e-isolated.mjs tests/e2e/workspace-tabs.test.ts`：1 项通过，Windows 开发态真实 Electron；覆盖防抖搜索结果提交后的选择恢复；临时资源库与 userData 等待完整进程退出后删除。
- 亮色、暗色、760px 窄窗口、1300px 与 1600px 窗口做过临时视觉预览；发现并修复窗口缩放后活动标签可能离开可视区的问题。预览图片和源文件已删除。
- 扩展回归 `folder-context-menu.test.ts + shell-navigation.test.ts`：2 项通过、4 项失败。1 项是新增关闭按钮造成的宽泛 locator 歧义，已统一改成精确 locator；两项为既有行内子文件夹缩进断言（期望 21、实际 7），一项为既有 Windows 原生菜单项未启用超时。后两类与本次标签实现无代码路径交集，保持为未通过证据，不写成全绿。
- 全量 `npm run lint` 未通过：5 项均位于本轮未修改的同步模块/既有手工 WebDAV 测试（`use-sync-card-status.ts` 1 项、`sync-engine.ts` 3 项、`webdav-sync-e2e-manual.test.ts` 1 项）；本轮改动文件的定向 ESLint 通过。
- 全量 `npm run test` 运行约 9 分钟后无新输出且 Worker 持续占用，已终止本次测试进程；不能记为通过。定向单测与真实 Electron 标签旅程分别有完整通过证据。

Luna high 已在隔离 userData 与临时资源库上启动 Computer Use，并取得首个应用窗口
状态；随后 CUA 无法再次激活该目标窗口，恢复与重新枚举后仍相同，因此没有形成完整
交互证据。隔离进程和临时目录已清理。packaged、macOS Finder 实际打开和 2 万资产
长列表滚动恢复未执行，不得标为通过。

| 需求 | 实现 | 自动化 | 人工/平台证据 |
| --- | --- | --- | --- |
| 显式新建、切换、关闭 | 已实现 | 单测 + Electron E2E 通过 | 待人类验收 |
| 独立导航上下文 | 已实现 | 单测 + Electron E2E 验证页面/搜索、搜索提交后的选择及 73% 标签/历史恢复 | 待人类验收 |
| 文件夹/合集右键操作 | 已实现 | 单测 + Electron E2E 通过 | 系统文件浏览器实际打开未点击 |
| 亮暗主题、溢出、键盘操作 | 已实现 | 键盘单测通过 | 临时预览已检查；独立 Computer Use 因窗口无法再次激活而未完成 |

## 临时文件

本轮 Playwright 失败 trace、临时视觉预览、E2E 资源库与 userData 均已清理。

## 2026-09-12 导航算法重设计

用户确认当前 UI 方向可继续，同时报告切换标签会白闪。独立复核还确认：当前异步
页面读取只按资源库或全局 generation 过滤，旧结果仍可能写入新标签；关闭非活动
标签会推进全局 generation，从而误取消活动智能合集或防抖搜索。

本轮停止继续打补丁，业务逻辑回到提交 `83ee70f8`，保留后续 UI 调整。新算法写入
[导航与无闪烁切换算法](../implementation/2026-09-12-workspace-tab-navigation-algorithm.md)：
按标签 generation 的 token、prepare/commit 两阶段导航、有界 render snapshot、
显示前恢复 viewport。实现拆为 `Serpent-ea5c9c`、`Serpent-58467e`、
`Serpent-bb3ce7`、`Serpent-83d71f`，按两项纯模型并行、`App.tsx` 单人集成、E2E
收口的顺序执行。
