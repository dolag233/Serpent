# Serpent 人类功能验收清单

> 状态：持续维护
>
> 首次建立：2026-07-14
>
> 当前功能代码基线：历史条目以各自证据提交为准；当前集成基线 `07d2f7e`（含 0015–0019 增量）
>
> 适用平台：macOS 开发态；Windows 与最终候选 packaged app 另列为未验证

本文件只回答一个问题：**现在有哪些已经具备功能性的能力，可以由产品负责人逐项实际操作并给出通过/不通过结论？**

“待人类验收”不等于切片完成、发布通过或产品已接受。自动化、代码审查和 Computer Use 负责证明条目已经值得交给人试用；只有用户本人可以把状态改为“人类验收通过”。

## 状态规则

| 状态 | 含义 | 谁可以设置 |
| --- | --- | --- |
| 待人类验收 | 功能路径和相关自动化已具备，等待用户操作 | agent |
| 验收中 | 用户正在检查，尚未给结论 | 用户或代用户记录的 agent |
| 人类验收通过 | 用户明确确认该条目满足预期 | 仅用户；agent 只能按原话记录 |
| 人类验收不通过 | 用户发现功能、交互或视觉问题 | 用户或收到反馈的 agent |
| 已撤回 | 新回归或证据失效，不再适合继续验收 | agent，必须写明原因 |

更新要求：每个 agent 在开发中一旦产生新的可验收增量，必须立即新增或更新条目，并与实现放在同一提交；阶段性汇报必须列出变化的 ID。用户反馈后在当前回合更新“结果/反馈”，修复完成后记录新基线并重新进入“待人类验收”，不得覆盖原反馈。

条目必须保持为最小可独立判定的用户行为；如果一项中的任一步骤可独立失败并需要单独定位，就拆成不同 ID。证据只表示该路径具备进入人工验收的资格，不替代用户结论。

## 当前待人类验收队列

> 2026-07-16 校准：0014 新增模块已进入 `f1330a7`；静态检查、相关 Electron E2E 和
> Computer Use 已完成，因此 H 节中仍符合目标产品的项目进入“待人类验收”。随后产品反馈
> 取消左侧标签菜单并新增完整文件菜单要求，受影响条目已单独撤回。最终集中
> `verify:mainline`、packaged 与 Windows 仍是发布条件，不冒充已完成。

> 2026-07-16 产品反馈校准：Label/资产显示别名已被产品负责人撤销，左侧标签列表和独立标签管理页也不再是目标交互；相关旧条目已撤回。部分壳层清理、菜单分组和已实现快捷键已进入 A0 验收队列；其余新增 UI/UX 与文件管理需求仍记录在 `../implementation/mvp-ui-ux-requirements-backlog.md` 和本文件“暂不可验收”区。

### A0. 应用壳层与导航增量

| ID | 功能 | 状态 | 人类操作 | 预期结果 | 证据 | 结果/反馈 |
| --- | --- | --- | --- | --- | --- | --- |
| SHELL-001 | 画布移除网格装饰 | 人类验收通过 | 打开任意资源库并观察资产浏览画布 | 背景为干净纯色，不再有一格一格的图案 | [进度同步](../development/0015-0016-progress-sync.md) / [实现](../../) | 2026-07-17 用户手动验收通过。 |
| SHELL-002 | 移除冗余应用装饰与状态文字 | 人类验收通过 | 查看右下角、左侧导航底部和左右面板顶部 | 不显示 `SERPENT / LOCAL WORKSPACE`、连接状态、资源导航/检查器标题 | [进度同步](../development/0015-0016-progress-sync.md) | 2026-07-17 用户手动验收通过。 |
| SHELL-003 | 滑块移除“缩略图大小”冗余文字 | 人类验收通过 | 查看资产浏览工具栏的卡片大小控制 | 只显示滑块；仍可通过无障碍名称和悬停提示理解用途 | [进度同步](../development/0015-0016-progress-sync.md) | 2026-07-17 用户手动验收通过。 |
| SHELL-004 | 左上角资源库名称下拉菜单 | 待人类验收 | 打开资源库后点击左上角名称，检查新建/打开/关闭与本机其他资源库列表 | 无 `S` 品牌字形；菜单可新建、打开、关闭资源库；并显示本机其他资源库供直接打开 | [0016-A 规格](../implementation/0016-a-shell-navigation-slice.md) / [壳层 E2E](../../tests/e2e/shell-navigation.test.ts) / [最近资源库 E2E](../../tests/e2e/library-recent.test.ts) | 2026-07-17 用户反馈：SHELL-004 需要能够显示本电脑的其他资源库，方便直接打开。修复后重新进入待验收。2026-07-17 修复：切换器新增“其他资源库”区（`cf0a494`），壳层与最近资源库 E2E 当次绿，重新进入待验收。2026-07-17 用户表示稍后验收。 |
| SHELL-005 | 截断文本省略号垂直对齐 | 人类验收通过 | 查看资产卡片文件名、面包屑等长文本被截断的位置 | 省略号贴文本基线（向下对齐），不悬空居中 | 修复提交 `171e25e` | 2026-07-17 用户反馈：字数太长用于省略的省略号需要向下对齐，现在是居中对齐。修复：省略号贴文本基线（`171e25e`）。2026-07-17 用户逐项回复“ok”验收通过。 |
| SHELL-006 | 左侧导航面板状态点清理 | 人类验收通过 | 查看左侧导航面板顶部与底部 | 不再显示任何表示状态的小点 | 修复提交 `171e25e` / [壳层 E2E](../../tests/e2e/shell-navigation.test.ts) | 2026-07-17 用户反馈：左侧面板上方和下方的表示状态的小点都是冗余的。修复：导航面板顶部/底部状态点已移除（`171e25e`）。2026-07-17 用户逐项回复“ok”验收通过。 |
| SHELL-013 | 纯图标控件悬停提示 | 人类验收通过 | 悬停侧栏加号/链接、浏览工具栏纯图标、缩略图滑块等，停约 0.4 秒 | 出现低调提示气泡（与右键菜单同层，非抢眼大框）；移开即消失 | [开发日志](../development/2026-07-18-icon-action-tooltips-development-log.md) / [HoverTipHost](../../src/renderer/hover-tip.tsx) | 2026-07-18 用户验收通过。 |
| SHELL-014 | 侧栏折叠成套图标且左折叠在历史按钮之前 | 待人类验收 | 观察顶栏最左：先侧栏折叠图标，再后退/前进；收起左栏后看浮现按钮；再试右栏折叠 | 左右使用同一套面板图标的开/关状态（带轨填充 + 关时带 chevron）；左折叠在前进/后退左侧，不再用汉堡菜单图标 | [开发日志](../development/2026-07-18-sidebar-panel-icons-development-log.md) / [壳层 E2E](../../tests/e2e/shell-navigation.test.ts) / 工单 Serpent-6ey | 2026-07-18 实现；与 NAV-002「历史在最左」冲突处以前者工单为准。 |
| SHELL-015 | macOS 红绿灯内嵌无边框顶栏 | 待人类验收 | macOS 上打开应用，看顶栏最左侧 | 系统红黄绿在应用工具行内、侧栏折叠按钮左侧；不与按钮重叠；顶栏空白可拖移窗口 | [开发日志](../development/2026-07-18-macos-traffic-lights-development-log.md) / 工单 Serpent-4ze | 2026-07-18 实现；Windows 保持系统标题栏。 |
| SHELL-016 | 创建资源库流程文案正式化 | 待人类验收 | 未打开资源库时看起始页标题与说明；再点「创建资源库」看对话框帮助文案 | 无口语化句子；起始页为「创建本地资源库」等书面语；对话框说明为「确认后将选择…」 | [开发日志](../development/2026-07-18-copy-formalization-development-log.md) / 工单 Serpent-rxx | 2026-07-18 实现。 |
| SHELL-017 | 清理中英括注冗余标签 | 待人类验收 | 简体中文下打开 AI 配置、Inspector 色卡/源链接、维度过滤宽度高度长边标签 | 不再出现「标签 (Tags)」「源链接 (URL)」「色卡 (Palette)」「宽度 (px)」等中英叠注 | [开发日志](../development/2026-07-18-copy-formalization-development-log.md) / 工单 Serpent-c1p | 2026-07-18 实现。 |
| SHELL-018 | 侧栏拖小自动隐藏并从边缘拖出 | 待人类验收 | 向内拖导航/检查器分隔条越过阈值；再从窗口左/右边缘向外拖 | 拖过窄阈值后面板收起；宽度偏好保留；从边缘拖出约 48px 后恢复；点击浮现按钮仍可用 | [开发日志](../development/2026-07-18-panel-auto-hide-development-log.md) / [单测](../../tests/unit/panel-auto-hide.test.ts) / 工单 Serpent-4gk | 2026-07-18 实现。 |
| CANVAS-013 | 导入/导出迁入资源库菜单 + 窄窗溢出 | 待人类验收 | 打开资源库菜单「添加与传输」；缩窄窗口看工作区栏右侧「更多工具」 | 导入文件/文件夹/粘贴/链接/库导入导出不在常驻浏览栏；窄窗下扩展/后台任务/AI 在「更多」中可点，不消失 | [开发日志](../development/2026-07-18-toolbar-transfer-overflow-development-log.md) / 工单 Serpent-2d0 | 2026-07-18 实现；空态仍保留导入 CTA。 |
| COMMAND-002 | 资产重命名 F2 快捷键 | 待人类验收 | 选中托管资产，按 F2（勿在输入框内） | 打开重命名对话框；菜单项亦显示 F2 | [shortcut 单测](../../tests/unit/shortcut-matcher.test.ts) / 工单 Serpent-ak0 | 2026-07-18 实现。 |
| SYNC-001 | 移出合集不误清空「所有资产」网格 | 待人类验收 | 在「所有资产」选中合集成员，右键移出合集（可移至合集为空） | 网格仍显示全部资产，不出现 0 项导入空态；侧栏「所有资产」计数合理 | [开发日志](../development/2026-07-18-state-sync-invalidation-development-log.md) / 工单 Serpent-eaf | 2026-07-18 CU-B1。 |
| SYNC-002 | 回收站恢复后全局计数立即刷新 | 待人类验收 | 移入回收站后看侧栏「所有资产」计数；在回收站恢复；不离开回收站观察计数 | 恢复后侧栏与 Inspector 的库级计数立即增加，无需先点「所有资产」 | [开发日志](../development/2026-07-18-state-sync-invalidation-development-log.md) / 工单 Serpent-eaf | 2026-07-18 CU-B2。 |
| SYNC-003 | 智能合集范围栏与侧栏选中一致 | 待人类验收 | 从「所有资产」点进智能合集 | 工作区标题为智能合集名；侧栏仅该智能合集高亮，「所有资产」不高亮 | [browse-nav 单测](../../tests/unit/browse-nav-active.test.ts) / 工单 Serpent-eaf | 2026-07-18 CU-B3。 |
| FOLDER-009 | 包含子文件夹显式开关 | 人类验收通过 | 进入父文件夹；看标题「平面设计参考」左侧双层文件夹图标；开启后退出再进入 | 图标在标题左侧（项数徽章旁）；开启后显示子级资产；再次进入同一文件夹仍保持开启 | [开发日志](../development/2026-07-18-folder-include-subfolders-development-log.md) / [偏好单测](../../tests/unit/folder-recursive-preferences.test.ts) | 2026-07-18 用户验收通过。 |
| NAV-001 | 无边框可点击面包屑 | 人类验收通过 | 进入嵌套托管文件夹，点击父级面包屑 | 不显示前缀“资源库 >”；父目录可跳转；当前段不可点 | [0016-A 规格](../implementation/0016-a-shell-navigation-slice.md) / [面包屑单测](../../tests/unit/scope-breadcrumbs.test.ts) | 2026-07-17 用户明确反馈“NAV-001已验收”。 |
| NAV-002 | 工作区后退/前进 | 人类验收通过 | 在文件夹与所有资产间切换后按后退再前进 | 恢复此前浏览范围；与查看页返回无关；按钮 icon 形似 < >，位于资产浏览页上方 bar 最左边、当前目录名称左边 | [0016-A 规格](../implementation/0016-a-shell-navigation-slice.md) / [历史单测](../../tests/unit/workspace-nav-history.test.ts) / [壳层 E2E](../../tests/e2e/shell-navigation.test.ts) | 2026-07-17 用户反馈：前进后退按钮的 icon 不对，需要形似 <>；位置需在 bar 最左边、当前目录名称左边。修复：chevron 图标置于 bar 最左（`171e25e`）。2026-07-17 用户逐项回复“ok”验收通过。 |
| NAV-003 | 托管与链接文件夹统一目录树 | 待人类验收 | 同时存在托管文件夹和链接文件夹时查看左侧“文件夹” | 无独立“链接文件夹”分区；在线链接与托管同为文件夹图标；离线为灰色断联图标并可悬停说明 | [0016-A 规格](../implementation/0016-a-shell-navigation-slice.md) / [统一树单测](../../tests/unit/unified-directory-nav.test.ts) / [可用性表现](../development/2026-07-18-availability-affordance-development-log.md) | 2026-07-18 按 Serpent-6nb 调整：可用不显示链接图标。 |
| AVAIL-001 | 仅不可用显示断联表现 | 人类验收通过 | 对比在线/离线链接文件夹与丢失资产卡片；选中可用资产看 Inspector | 在线链接无彩色链接图标；离线灰色断联；丢失资产灰度+中央断联图标；Inspector 对可用资产不显示「可用」行，仅 missing/回收站显示状态行 | [单测](../../tests/unit/availability-affordance.test.ts) / [开发日志](../development/2026-07-18-availability-affordance-development-log.md) | 2026-07-18 用户验收通过（含去掉 Inspector「可用」行）。 |
| MENU-014 | 资产右键菜单按语义分组 | 人类验收通过 | 选中资产打开右键菜单，检查“打开/组织/元数据/删除” | 同类操作在同一组，不同组之间有分隔，危险操作独立 | [进度同步](../development/0015-0016-progress-sync.md) / [菜单 E2E](../../tests/e2e/context-menu.test.ts) | 2026-07-17 用户手动验收通过；完整文件操作菜单仍在后续条目。 |
| COMMAND-001 | 菜单显示已实现命令的快捷键 | 人类验收通过 | 打开单资产菜单，查看外部打开和移入回收站条目 | 显示当前平台快捷键，且按对应快捷键执行同一动作 | [进度同步](../development/0015-0016-progress-sync.md) / [快捷键单测](../../tests/unit/shortcut-matcher.test.ts) | 2026-07-17 用户手动验收通过；完整命令注册表仍未完成。 |
| I18N-001 | 右键命令菜单随界面语言切换 | 人类验收通过 | 打开资源库菜单切到 English；右键资产与侧栏文件夹查看菜单标题；再切回简体中文 | English 下菜单为英文；简体中文下恢复原中文文案；无手动偏好时跟随系统语言 | [命令单测](../../tests/unit/asset-commands.test.ts) / [多选命令单测](../../tests/unit/asset-multi-commands.test.ts) / [侧栏命令单测](../../tests/unit/sidebar-commands.test.ts) / [i18n 单测](../../tests/unit/i18n-translate.test.ts) / [开发日志](../development/2026-07-18-i18n-foundation-development-log.md) | 2026-07-18 用户验收：UI 文案覆盖完整通过。默认语言已按反馈改为跟随系统。 |
| I18N-002 | 壳层语言切换与持久化 | 人类验收通过 | 资源库菜单 → 语言 → English；观察后退/前进、资源库菜单项；完全退出后重启 | 壳层相关文案为英文；重启后仍为 English；再切回简体中文恢复 | [i18n 单测](../../tests/unit/i18n-translate.test.ts) / [开发日志](../development/2026-07-18-i18n-foundation-development-log.md) | 2026-07-18 用户验收通过；默认改为跟随系统语言。 |
| I18N-003 | 查看页 / toast / 批量操作随语言切换 | 人类验收通过 | 切到 English；打开资产查看页；触发导入完成或复制色卡等通知；执行一项批量提示；再切回简体中文 | English 下查看页按钮与通知为英文；简体中文下恢复；无手动偏好时跟随系统语言 | [开发日志](../development/2026-07-18-i18n-foundation-development-log.md) / [单元 615](../../tests/unit/) | 2026-07-18 用户验收通过。 |

### A. 资源库与导入

| ID | 功能 | 状态 | 人类操作 | 预期结果 | 证据 | 结果/反馈 |
| --- | --- | --- | --- | --- | --- | --- |
| LIB-001 | 创建、关闭并重新打开资源库 | 待人类验收 | 创建临时资源库，关闭后从起始页重新打开 | 名称、目录和资产保持一致；失败时显示具体原因 | [0001 QA](0001-library-shell-qa-report.md) / [生命周期 E2E](../../tests/e2e/library-lifecycle.test.ts) | — |
| LIB-002 | 完整退出后恢复最近资源库 | 待人类验收 | 打开一个资源库，完全退出 Serpent 后重新启动 | 自动打开刚才使用的资源库 | [生命周期 E2E](../../tests/e2e/library-lifecycle.test.ts) | — |
| LIB-003 | 完整退出后恢复上次浏览资产 | 人类验收通过 | 选中一项资产，完全退出后重新启动 | 恢复到原浏览范围，并将原资产带回视野和焦点 | [生命周期 E2E](../../tests/e2e/library-lifecycle.test.ts) | 2026-07-17 用户手动验收：“LIB-003通过”。 |
| IMPORT-001 | 导入单个文件 | 待人类验收 | 在资源库根目录或指定文件夹执行“导入文件”并选择一个文件 | 文件复制到 `Assets/` 对应位置并出现在画布；原文件保留 | [0002 QA](0002-asset-ingestion-qa-report.md) / [导入 E2E](../../tests/e2e/asset-ingestion.test.ts) | — |
| IMPORT-002 | 一次导入多个文件 | 待人类验收 | 在“导入文件”中一次选择多个文件 | 所有选中文件均导入，且没有重复或遗漏 | [0002 QA](0002-asset-ingestion-qa-report.md) / [导入 E2E](../../tests/e2e/asset-ingestion.test.ts) | — |
| IMPORT-003 | 导入目录并保留层级 | 待人类验收 | 导入一个包含子目录的素材目录 | `Assets/` 和侧栏保留原目录层级，正常素材全部出现 | [0002 QA](0002-asset-ingestion-qa-report.md) / [桌面导入 E2E](../../tests/e2e/desktop-ingestion.test.ts) | — |
| IMPORT-004 | 托管资产被外部删除后显示 missing | 待人类验收 | 在外部删除一项托管资产，再执行“刷新磁盘变化” | 该资产显示文件丢失状态，不再表现为可用 | [0002 QA](0002-asset-ingestion-qa-report.md) / [导入 E2E](../../tests/e2e/asset-ingestion.test.ts) | — |

### B. 链接文件夹

| ID | 功能 | 状态 | 人类操作 | 预期结果 | 证据 | 结果/反馈 |
| --- | --- | --- | --- | --- | --- | --- |
| LINK-001 | 以链接方式导入外部文件夹 | 待人类验收 | 选择外部素材目录作为链接文件夹导入 | 文件不复制进资源库；资产可浏览，侧栏出现链接文件夹 | [0003 QA](0003-linked-folders-qa-report.md) / [链接 E2E](../../tests/e2e/linked-folders.test.ts) | — |
| LINK-002 | 默认忽略无用目录和文件 | 待人类验收 | 链接包含 `.git`、`node_modules`、`.DS_Store` 与正常素材的目录 | 无用项目不形成资产，正常素材可见 | [0003 QA](0003-linked-folders-qa-report.md) / [链接 E2E](../../tests/e2e/linked-folders.test.ts) | — |
| LINK-003 | 链接根离线后显示 offline | 待人类验收 | 暂时移走链接根并刷新磁盘变化 | 链接资产显示 offline/missing，身份和元数据不丢失 | [0003 QA](0003-linked-folders-qa-report.md) / [链接 E2E](../../tests/e2e/linked-folders.test.ts) | — |
| LINK-004 | 重新指定链接根 | 待人类验收 | 将离线链接文件夹重新指定到结构相同的新根 | 已存在文件恢复可用，资产 ID 和元数据保持不变 | [0003 QA](0003-linked-folders-qa-report.md) / [链接 E2E](../../tests/e2e/linked-folders.test.ts) | — |

### C. 元数据、标签与合集

| ID | 功能 | 状态 | 人类操作 | 预期结果 | 证据 | 结果/反馈 |
| --- | --- | --- | --- | --- | --- | --- |
| META-001 | 编辑和清空资产名称 | 已撤回 | — | — | [ADR 0022](../adr/0022-retire-asset-label.md) | 2026-07-16 用户明确删除 Label/显示别名设计；未来资产名称只是真实文件名，重命名走文件操作。 |
| META-002 | 编辑和清空资产描述 | 待人类验收 | 设置资产描述并保存，再清空并保存 | 设置值和空值均正确显示，不回弹为旧值 | [0004 QA](0004-tags-collections-metadata-qa-report.md) / [组织持久化 E2E](../../tests/e2e/organization-metadata-persistence.test.ts) | — |
| META-003 | 编辑和清空资产评分 | 待人类验收 | 设置非零评分并保存，再清除评分并保存 | 评分可设置为目标值，也可恢复为未评分 | [0004 QA](0004-tags-collections-metadata-qa-report.md) / [组织持久化 E2E](../../tests/e2e/organization-metadata-persistence.test.ts) | — |
| META-004 | 设置和取消喜欢 | 待人类验收 | 将资产标为喜欢，再取消喜欢 | 两种状态均立即正确显示 | [0004 QA](0004-tags-collections-metadata-qa-report.md) / [组织持久化 E2E](../../tests/e2e/organization-metadata-persistence.test.ts) | — |
| META-005 | 编辑和清空源链接 | 待人类验收 | 设置有效来源 URL 并保存，再清空并保存 | URL 可保存也可清空，不残留旧值 | [0004 QA](0004-tags-collections-metadata-qa-report.md) / [组织持久化 E2E](../../tests/e2e/organization-metadata-persistence.test.ts) | — |
| META-006 | 编辑和清空人工色卡 | 已撤回 | — | — | [0004 QA](0004-tags-collections-metadata-qa-report.md) | 2026-07-18 Serpent-7pg 移除人工/自定义色卡产品面；色卡仅保留自动提取，Inspector 不再提供人工色卡编辑入口。 |
| META-007 | 元数据跨完整重启持久化 | 待人类验收 | 保存一组元数据（描述/评分/喜欢/源链接），完全退出 Serpent 后重新启动 | 重启前保存的每个字段值均恢复（不含已撤回的人工色卡） | [0004 QA](0004-tags-collections-metadata-qa-report.md) / [组织持久化 E2E](../../tests/e2e/organization-metadata-persistence.test.ts) | — |
| META-008 | Inspector 仅显示自动色卡 | 待人类验收 | 选中已提取色卡的图片；确认无人工色卡输入；观察「色卡 · 自动」预览与待提取帮助文案 | 无人工色卡编辑框；有自动色卡时显示可复制色块；无色卡时显示待提取说明，不出现人工覆盖入口 | [palette worker](../../tests/worker/palette-artifact.test.ts) / 工单 Serpent-7pg | 2026-07-18 随 Serpent-7pg 进入待验收。 |
| TAG-001 | 创建标签 | 已撤回 | — | — | [MVP UX 需求池](../implementation/mvp-ui-ux-requirements-backlog.md) | 旧入口依赖左侧完整标签列表；新入口改为 Inspector tag chip 的搜索/输入创建，实施后用新步骤重新进入验收。 |
| TAG-002 | 重命名标签 | 已撤回 | — | — | [MVP UX 需求池](../implementation/mvp-ui-ux-requirements-backlog.md) | 用户确认不设标签管理页；全局重命名入口待集中确认后重新定义。 |
| TAG-003 | 删除标签 | 已撤回 | — | — | [MVP UX 需求池](../implementation/mvp-ui-ux-requirements-backlog.md) | 用户确认不设标签管理页；全局删除入口待集中确认后重新定义。 |
| TAG-004 | 给多项资产分配标签 | 人类验收不通过 | — | — | [MVP UX 需求池](../implementation/mvp-ui-ux-requirements-backlog.md) | 批量能力保留，但当前菜单直接枚举全部标签，不适合大量标签；改为可搜索选择器后重新验收。2026-07-17 已实现可搜索二级选择器（搜索/计数/键盘导航/滚动不关菜单），单测与 E2E 当次全绿（[开发日志](../development/0017-0018-searchable-tag-picker-and-file-commands-development-log.md)）；Computer Use 截图证据未执行（当前环境无桌面控制能力，移交人工 QA），补齐后重新进入待验收。2026-07-17 用户试用后反馈“有点难用”：需要能够过滤多个 tag；用户表示对该功能另有计划，后续再定义。在用户给出新方向前，agent 不得自行开发多标签过滤。2026-07-17 第二批反馈：用户已直接给出方向（多标签过滤 + 宽高比/分辨率预设），冻结解除，按需求池 REQ-TAG-002 / REQ-FILTER-009 / REQ-FILTER-010 排期实施。 |
| TAG-005 | 从多项资产移除标签 | 人类验收不通过 | — | — | [MVP UX 需求池](../implementation/mvp-ui-ux-requirements-backlog.md) | 批量能力保留，但当前入口随标签数量膨胀；改为可搜索选择器后重新验收。2026-07-17 同 TAG-004：可搜索移除选择器已实现并自动化全绿；Computer Use 证据未执行，补齐后重新进入待验收。2026-07-17 用户试用后反馈“有点难用”：需要能够过滤多个 tag；用户表示对该功能另有计划，后续再定义。在用户给出新方向前，agent 不得自行开发多标签过滤。2026-07-17 第二批反馈：用户已直接给出方向（多标签过滤 + 宽高比/分辨率预设），冻结解除，按需求池 REQ-TAG-002 / REQ-FILTER-009 / REQ-FILTER-010 排期实施。 |
| TAG-006 | Inspector 以 chip 显示和移除标签 | 人类验收通过 | 选中带标签的资产，点击 chip 内的移除按钮 | 标签立即消失，其他 Inspector 内容保持稳定 | [0018–0019 QA](0018-0019-ui-correctness-qa-report.md) / [标签 E2E](../../tests/e2e/organization-metadata-persistence.test.ts) | 2026-07-16 用户明确反馈“标签我也验收了，还不错”。 |
| TAG-007 | 从建议或搜索结果立即添加现有标签 | 人类验收通过 | 打开圆角标签输入；点击建议，或用上下键选择后按回车 | 标签立即添加，无需再按一次回车；输入关闭 | [0018–0019 QA](0018-0019-ui-correctness-qa-report.md) / [标签 E2E](../../tests/e2e/organization-metadata-persistence.test.ts) | 2026-07-16 用户明确反馈“标签我也验收了，还不错”。 |
| TAG-008 | 零使用标签不进入 Inspector 建议 | 人类验收通过 | 移除某标签的最后一次资产关联，再打开建议并搜索该名称 | 最近建议和搜索结果都不再显示该标签 | [0018–0019 QA](0018-0019-ui-correctness-qa-report.md) / [标签 E2E](../../tests/e2e/organization-metadata-persistence.test.ts) | 2026-07-16 用户明确反馈“标签我也验收了，还不错”。 |
| COLLECTION-001 | 创建父子合集 | 待人类验收 | 创建父合集，再在其中创建子合集 | 侧栏按正确层级显示两个合集 | [0004 QA](0004-tags-collections-metadata-qa-report.md) | — |
| COLLECTION-002 | 重命名合集 | 待人类验收 | 重命名已有合集 | 新名称立即出现，层级和成员保持 | [0004 QA](0004-tags-collections-metadata-qa-report.md) | — |
| COLLECTION-003 | 删除合集 | 待人类验收 | 删除一个包含资产的合集 | 合集消失，成员资产本身不被删除 | [0004 QA](0004-tags-collections-metadata-qa-report.md) | — |
| COLLECTION-004 | 添加合集成员 | 待人类验收 | 把多项资产加入一个合集 | 合集内容和成员计数准确增加 | [0004 QA](0004-tags-collections-metadata-qa-report.md) / [组织 E2E](../../tests/e2e/organization-search-trash.test.ts) | — |
| COLLECTION-005 | 移除合集成员 | 待人类验收 | 从合集中移除一项或多项资产 | 合集内容和成员计数准确减少，资产本身保留 | [0004 QA](0004-tags-collections-metadata-qa-report.md) / [组织 E2E](../../tests/e2e/organization-search-trash.test.ts) | — |
| COLLECTION-006 | 手动调整合集成员顺序 | 待人类验收 | 在合集内拖动资产改变顺序 | 松开后顺序保存，重新进入合集仍保持 | [0004 QA](0004-tags-collections-metadata-qa-report.md) | — |
| COLLECTION-007 | 切换“包含子合集”范围 | 待人类验收 | 在父合集中开关“包含子合集” | 开启时递归显示子合集资产，关闭时只显示直接成员 | [0004 QA](0004-tags-collections-metadata-qa-report.md) | — |
| MENU-020 | 多选时 Inspector 标签批量操作 | 人类验收通过 | 框选 ≥2 项资产，在右侧 Inspector 添加一个标签（搜索现有或新建）；再移除该标签 | 添加后所有选中资产都带上该标签（可逐项点击核对）；移除后全部消失；通知报告处理数量。展示模型已由 REQ-SELECT-004 改为共有标签交集，回归见 SELECT-010 | [批次 3 开发日志](../development/0015-0019-ux-feedback-batch3-development-log.md) / [决策单测](../../tests/unit/inspector-tag-target.test.ts) / [UE 多选开发日志](../development/2026-07-18-ue-multi-edit-inspector-development-log.md) | 2026-07-17 实现并人类验收通过（旧「将应用于 N 项」提示）。2026-07-18 REQ-SELECT-004 替换提示模型为交集/多个值；写路径仍批量，验收步骤以 SELECT-010 为准。 |
| MENU-021 | 多选时 Inspector 评分批量设置 | 待人类验收 | 框选 ≥2 项评分相同的资产，在 Inspector 点星级；再逐项核对。另框选评分不同的两项观察控件 | 评分相同时可设置，全部选中项一致变化；通知报告处理/跳过数量。评分不同时显示「多个值」且不可改；不再出现「将应用于 N 项」提示 | [0015 菜单接入开发日志](../development/0015-command-registry-menu-adoption-development-log.md) / [worker 测试](../../tests/worker/batch-rating.test.ts) / [UE 多选开发日志](../development/2026-07-18-ue-multi-edit-inspector-development-log.md) / SELECT-009 | 2026-07-17 实现（asset.rating.set）；2026-07-18 与 REQ-SELECT-004 对齐：去掉批量提示文案，改为 UE mixed/uniform。Computer Use 未执行。 |

### D. 搜索、排序与智能合集

| ID | 功能 | 状态 | 人类操作 | 预期结果 | 证据 | 结果/反馈 |
| --- | --- | --- | --- | --- | --- | --- |
| SEARCH-001 | 按文件名搜索 | 待人类验收 | 输入只存在于目标文件名中的关键词 | 只返回文件名命中的资产；清空后恢复当前范围 | [0005 QA](0005-search-filter-sort-smart-collections-qa-report.md) / [组织搜索 E2E](../../tests/e2e/organization-search-trash.test.ts) | — |
| SEARCH-002 | 按资产名称搜索 | 已撤回 | — | — | [ADR 0022](../adr/0022-retire-asset-label.md) | 该条目验证的是独立 Label/显示别名；产品已撤销此字段，文件名搜索仍由 SEARCH-001 验收。 |
| SEARCH-003 | 按标签搜索 | 待人类验收 | 输入只存在于目标标签名称中的关键词 | 返回带该标签的资产；清空后恢复当前范围 | [0005 QA](0005-search-filter-sort-smart-collections-qa-report.md) / [组织搜索 E2E](../../tests/e2e/organization-search-trash.test.ts) | — |
| FILTER-001 | 按文件格式过滤 | 人类验收不通过 | — | — | [MVP UX 需求池](../implementation/mvp-ui-ux-requirements-backlog.md) | 2026-07-16 用户确认当前长表单过滤不够美术友好；等待维度式过滤条后重新验收。 |
| FILTER-002 | 按标签过滤 | 人类验收不通过 | — | — | [MVP UX 需求池](../implementation/mvp-ui-ux-requirements-backlog.md) | 同上；新标签过滤入口需要支持大量标签搜索与计数。 |
| FILTER-003 | 按评分过滤 | 人类验收不通过 | — | — | [MVP UX 需求池](../implementation/mvp-ui-ux-requirements-backlog.md) | 同上。 |
| FILTER-004 | 按喜欢状态过滤 | 人类验收不通过 | — | — | [MVP UX 需求池](../implementation/mvp-ui-ux-requirements-backlog.md) | 同上。 |
| FILTER-005 | 按来源链接存在性过滤 | 人类验收不通过 | — | — | [MVP UX 需求池](../implementation/mvp-ui-ux-requirements-backlog.md) | 同上。 |
| FILTER-006 | 按可用性过滤 | 人类验收不通过 | — | — | [MVP UX 需求池](../implementation/mvp-ui-ux-requirements-backlog.md) | 同上。 |
| FILTER-007 | 不同过滤字段使用 AND | 人类验收不通过 | — | — | [MVP UX 需求池](../implementation/mvp-ui-ux-requirements-backlog.md) | 查询语义保留，但当前 UI 入口不通过产品验收。 |
| FILTER-008 | 同一过滤字段多值使用 OR | 人类验收不通过 | — | — | [MVP UX 需求池](../implementation/mvp-ui-ux-requirements-backlog.md) | 查询语义保留，但当前 UI 入口不通过产品验收。 |
| FILTER-009 | 多标签过滤（可搜索多选） | 待人类验收 | 在「筛选与排序」面板的标签区搜索并点击添加两个以上标签；移除其中一个 | 标签以 chip 展示使用计数并可逐个移除；结果命中任一所选标签（同字段 OR）；不铺开全部标签 | [Wave 2 开发日志](../development/0015-0019-ux-feedback-wave2-development-log.md) | 2026-07-17 Wave 2 T7 实现；Computer Use 未执行，移交人工 QA。 |
| FILTER-010 | 宽高比预设过滤 | 待人类验收 | 在过滤面板点击「16:9」；再点一次取消；改点「3:4」 | 选中预设后只显示对应横/竖比例的资产（±5% 容差）；再次点击清除；自定义 min/max 仍可用 | [Wave 2 开发日志](../development/0015-0019-ux-feedback-wave2-development-log.md) / [预设单测](../../tests/unit/filter-presets.test.ts) | 2026-07-17 Wave 2 T7 实现；Computer Use 未执行，移交人工 QA。 |
| FILTER-011 | 分辨率预设过滤 | 待人类验收 | 在过滤面板依次点击「1K」「2K」「4K」观察结果变化；用自定义长边范围验证边界 | 按长边分桶（1K<2240≤2K<3200≤4K）显示对应资产；无尺寸数据的资产不进入正向匹配 | [Wave 2 开发日志](../development/0015-0019-ux-feedback-wave2-development-log.md) / [worker 测试](../../tests/worker/search.test.ts) | 2026-07-17 Wave 2 T7 实现；Computer Use 未执行，移交人工 QA。2026-07-18 入口迁入维度条「更多」。 |
| FILTER-013 | Eagle 式维度过滤条替代大面板 | 待人类验收 | 打开资源库，观察工作区标题栏下方：应看到「颜色 / 标签 / 文件夹 / 形状 / 评分 / 格式 / 更多」与排序；顶栏不被撑乱；无大面板 | 点颜色选色块、点文件夹切范围、点其他维度过滤；外点或 Esc 关闭 | [开发日志](../development/2026-07-18-eagle-dimension-filter-bar-development-log.md) / 工单 Serpent-fqt | 2026-07-18 补齐颜色与文件夹维度；过滤条在工作区。 |
| FILTER-014 | 已启用过滤 chips 可逐项清除与全部清除 | 待人类验收 | 启用标签 + 形状 + 格式后，观察维度条下方 chips；点某个 chip 的 ×；再点「全部清除」 | chips 持续显示已启用条件；单项清除只去掉该条件；全部清除去掉所有过滤（搜索词可保留） | [开发日志](../development/2026-07-18-eagle-dimension-filter-bar-development-log.md) / [chips 单测](../../tests/unit/active-discovery-filters.test.ts) | 2026-07-18 实现。 |
| FILTER-015 | 主色调颜色维度过滤 | 待人类验收 | 点「颜色」选蓝（或红）；再勾排除；再清除 | 结果按主色 hue 桶过滤；无色板资产不进正向匹配；排除保留无色板 | [color presets 单测](../../tests/unit/color-filter-presets.test.ts) / 工单 Serpent-fqt | 2026-07-18 实现。 |
| SEARCH-005 | 搜索激活指示与一键清除 | 待人类验收 | 在搜索框输入关键词；观察「正在搜索：…」；点输入框内 × | 有搜索词时显示状态 chip；× 清空搜索词并恢复浏览（过滤条件可保留） | 工单 Serpent-kvz | 2026-07-18 实现。 |
| SORT-001 | 按名称排序 | 待人类验收 | 选择名称排序 | 结果按真实文件名稳定排列 | [0005 QA](0005-search-filter-sort-smart-collections-qa-report.md) | — |
| SORT-002 | 按日期排序 | 待人类验收 | 选择日期排序 | 结果按所示日期稳定排列 | [0005 QA](0005-search-filter-sort-smart-collections-qa-report.md) | — |
| SORT-003 | 按大小排序 | 待人类验收 | 选择文件大小排序 | 结果按文件大小稳定排列 | [0005 QA](0005-search-filter-sort-smart-collections-qa-report.md) | — |
| SORT-004 | 切换升序和降序 | 待人类验收 | 在同一排序字段下切换升序和降序 | 两次结果顺序互为反向，缺失值位置稳定 | [0005 QA](0005-search-filter-sort-smart-collections-qa-report.md) | — |
| SORT-005 | 排序一等工具栏控件（含分辨率） | 待人类验收 | 打开资源库，在维度过滤条右侧找到排序按钮；选「分辨率」；点 ↑/↓ 切换方向 | 排序不在「更多」过滤弹出层内；常用字段含名称/修改时间/大小/分辨率/时长；切换后网格顺序立即变化 | [开发日志](../development/2026-07-18-sort-first-class-toolbar-development-log.md) / [long_edge 排序 worker](../../tests/worker/search.test.ts) / 工单 Serpent-w4p | 2026-07-18 实现。 |
| SEARCH-004 | 超过 50 项时连续纵向浏览 | 待人类验收 | 在至少 60 项的范围中持续向下滚动到底 | 全部资产可到达，无分页按钮、重复或遗漏 | [0005 QA](0005-search-filter-sort-smart-collections-qa-report.md) / [连续浏览 E2E](../../tests/e2e/asset-pagination.test.ts) | — |
| SMART-001 | 保存智能合集 | 待人类验收 | 将当前搜索、过滤和排序条件保存为智能合集 | 新智能合集出现在侧栏 | [0005 QA](0005-search-filter-sort-smart-collections-qa-report.md) | — |
| SMART-002 | 执行智能合集 | 待人类验收 | 打开已保存的智能合集 | 按已保存条件查询当前数据并显示结果 | [0005 QA](0005-search-filter-sort-smart-collections-qa-report.md) | — |
| SMART-003 | 更新智能合集条件 | 待人类验收 | 修改一个智能合集的查询或排序条件后保存 | 再次打开时使用新条件 | [0005 QA](0005-search-filter-sort-smart-collections-qa-report.md) | — |
| SMART-004 | 重命名智能合集 | 待人类验收 | 重命名已有智能合集 | 新名称立即出现，查询条件保持 | [0005 QA](0005-search-filter-sort-smart-collections-qa-report.md) | — |
| SMART-005 | 删除智能合集 | 待人类验收 | 删除已有智能合集 | 智能合集消失，资产不受影响 | [0005 QA](0005-search-filter-sort-smart-collections-qa-report.md) | — |
| FOLDER-001 | 文件夹递归显示后代资产 | 已撤回 | — | — | — | 2026-07-17 人类验收不通过；需求改为 REQ-FOLDER-009 显式开关。由 FOLDER-009 承接验收。 |
| FOLDER-009 | 包含子文件夹显式开关 | 人类验收通过 | 进入父文件夹；看标题左侧双层文件夹图标；开启后退出再进入 | 图标在标题左侧；开启后显示子级资产；同一文件夹再次进入仍保持开启 | [开发日志](../development/2026-07-18-folder-include-subfolders-development-log.md) / [偏好单测](../../tests/unit/folder-recursive-preferences.test.ts) / [E2E](../../tests/e2e/folder-recursive-scope.test.ts) | 2026-07-18 用户验收通过（与 A0 同 ID）。 |
| FILTER-012 | 文件夹内搜索递归后代 | 人类验收通过 | 在含子文件夹的父文件夹范围内，搜索一个只存在于孙级文件夹资产的关键词 | 孙级文件夹中的资产被搜到；切到回收站或「所有资产」后搜索行为不变 | [批次 3 开发日志](../development/0015-0019-ux-feedback-batch3-development-log.md) / [worker 测试](../../tests/worker/search.test.ts) / [递归 E2E](../../tests/e2e/folder-recursive-scope.test.ts) | 2026-07-17 实现（孙级深度 worker 回归测试）；Computer Use 未执行，移交人工 QA。2026-07-17 用户手动验收：“递归搜索通过”。2026-07-18：递归搜索与「包含子文件夹」开关共用；默认关时不递归搜索。 |

### E. 资产画布与缩略图

| ID | 功能 | 状态 | 人类操作 | 预期结果 | 证据 | 结果/反馈 |
| --- | --- | --- | --- | --- | --- | --- |
| CANVAS-001 | 平铺视图完整到达首尾 | 待人类验收 | 切到平铺视图，分别滚动到最上和最下 | 所有资产均可到达，顶部和底部不裁剪，没有分页 | [0012 QA](0012-asset-canvas-views-and-card-display-qa-report.md) / [浏览偏好 E2E](../../tests/e2e/browsing-preferences.test.ts) | — |
| CANVAS-002 | 瀑布流视图完整到达首尾 | 待人类验收 | 切到瀑布流视图，分别滚动到最上和最下 | 所有资产均可到达，顶部和底部不裁剪，没有分页 | [0012 QA](0012-asset-canvas-views-and-card-display-qa-report.md) / [浏览偏好 E2E](../../tests/e2e/browsing-preferences.test.ts) | — |
| CANVAS-003 | 用滑块调整资产卡片大小 | 待人类验收 | 拖动卡片大小滑块缩小再放大 | 卡片尺寸连续变化，布局无重叠 | [0012 QA](0012-asset-canvas-views-and-card-display-qa-report.md) | — |
| CANVAS-004 | macOS 手势缩放卡片并保持视觉锚点 | 待人类验收 | 将鼠标放在某项资产附近，用 Ctrl+滚轮或触控板缩放卡片 | 指针附近的可见资产尽量保持在原视野 | [0012 QA](0012-asset-canvas-views-and-card-display-qa-report.md) / [浏览偏好 E2E](../../tests/e2e/browsing-preferences.test.ts) | — |
| CANVAS-005 | 控制卡片字段显示 | 待人类验收 | 分别关闭文件名、大小和修改日期 | 对应字段立即隐藏，其他字段不受影响 | [0012 QA](0012-asset-canvas-views-and-card-display-qa-report.md) | — |
| CANVAS-006 | 画布偏好跨完整重启保存 | 待人类验收 | 修改视图、卡片大小和字段开关，完全退出后重开 | 所有画布偏好恢复 | [0012 QA](0012-asset-canvas-views-and-card-display-qa-report.md) / [浏览偏好 E2E](../../tests/e2e/browsing-preferences.test.ts) | — |
| CANVAS-007 | 小卡片平铺用满横向宽度 | 待人类验收 | 切到平铺视图，把卡片缩至最小并改变窗口宽度 | 每行弹性铺满，不留下可再容纳一列的大空当 | [0018–0019 QA](0018-0019-ui-correctness-qa-report.md) / [浏览偏好 E2E](../../tests/e2e/browsing-preferences.test.ts) / [justified 单测](../../tests/unit/asset-grid-layout.test.ts) | 2026-07-18 平铺改为 justified 行布局（Serpent-8nj）；本条目语义与 CANVAS-010 重叠处以后者为准。 |
| CANVAS-008 | 修改日期开关使用时钟图标 | 待人类验收 | 查看浏览工具栏的修改日期显示开关 | 使用秒表/时钟语义图标，不再显示五角星 | [0018–0019 QA](0018-0019-ui-correctness-qa-report.md) | — |
| CANVAS-009 | 稀疏瀑布流横向优先且不留大空当 | 人类验收通过 | 在只有 3 项的范围切到瀑布流并缩小卡片 | 首三项从左到右位于第一行；后续按最短列布局，首尾可达 | [0018–0019 QA](0018-0019-ui-correctness-qa-report.md) / [浏览偏好 E2E](../../tests/e2e/browsing-preferences.test.ts) | 2026-07-16 用户明确反馈“瀑布流……验收了，还不错”。 |
| CANVAS-010 | 平铺 justified：等行高、保比例、显示尺寸 | 待人类验收 | 切到平铺视图，观察多比例素材；拖动卡片大小滑块 | 每行高度一致、缩略图保持宽高比、整行横向填满；卡片下方显示「宽 × 高」；瀑布流不受影响 | [开发日志](../development/2026-07-18-justified-tile-layout-development-log.md) / [justified 单测](../../tests/unit/asset-grid-layout.test.ts) / 工单 Serpent-8nj / 参考图 `docs/前端参考/2026-07-18-tile-layout-reference.png` | 2026-07-18 实现。 |
| CANVAS-012 | 视频/动图类型与时长角标 | 待人类验收 | 网格中同时有静图、GIF、视频；观察卡片预览角标 | 视频右下「VIDEO」、左下时长；GIF 右下「GIF」、有时长则左下显示；静图无类型角标；丢失/回收站时右下不盖类型角标 | [开发日志](../development/2026-07-18-asset-card-type-badges-development-log.md) / [角标单测](../../tests/unit/asset-card-badges.test.ts) / 工单 Serpent-lrt | 2026-07-18 实现。 |
| INSPECT-001 | Inspector 显示真实缩略图 | 待人类验收 | 依次选择支持预览的图片和视频 | Inspector 显示已成功解码的图片或视频封面，不是通用文件图标 | [0018–0019 QA](0018-0019-ui-correctness-qa-report.md) / [媒体 E2E](../../tests/e2e/media-preview.test.ts) | — |
| INSPECT-002 | 切换资产时 Inspector 不混态/不空闪 | 待人类验收 | 快速在两项具有不同元数据的资产间切换 | 不出现“连接中/加载中”，也不显示前后资产混合内容 | [0018–0019 QA](0018-0019-ui-correctness-qa-report.md) / [切换 E2E](../../tests/e2e/organization-metadata-persistence.test.ts) | — |
| INSPECT-003 | Inspector 图片等比、宽度优先且无统一外框 | 人类验收通过 | 依次选择横图和竖图观察右侧预览 | 图片完整不拉伸；横图使用可用宽度，竖图受最大高度限制；无包住留白的卡片边框，图片本身有轻微圆角 | [0018–0019 QA](0018-0019-ui-correctness-qa-report.md) / [真实应用截图](evidence/0018-0019-ui-correctness/01-inspector-proportional-preview.png) / [媒体 E2E](../../tests/e2e/media-preview.test.ts) | 2026-07-16 用户先确认预览测试通过，随后明确确认轻圆角没有问题。 |
| INSPECT-004 | Inspector 资产身份信息在分割线上方居中 | 待人类验收 | 选择任意带预览资产，观察右侧预览下方 | 文件名和大小/分辨率/修改日期均随居中的预览居中；分割线以下的状态、标签和元数据仍左对齐 | [0018–0019 QA](0018-0019-ui-correctness-qa-report.md) | 按 2026-07-16 最新反馈完成；用户要求自行查看，不再启动 Computer Use。 |
| INSPECT-006 | Inspector 不再显示资源库路径与关闭按钮 | 人类验收通过 | 打开资源库，不选资产与选中资产时各看一次右侧 Inspector；关闭资源库改走左上角菜单 | Inspector 无资源库绝对路径、无「关闭资源库」按钮；菜单内仍可关闭 | [开发日志](../development/2026-07-18-inspector-remove-library-path-close-development-log.md) | 2026-07-18 用户验收通过。 |
| THUMB-001 | 支持的图片自动生成缩略图 | 待人类验收 | 导入支持的图片，不点击任何“生成预览”操作 | 缩略图自动出现并成功解码 | [0006 QA](0006-thumbnails-preview-format-decoding-qa-report.md) / [媒体预览 E2E](../../tests/e2e/media-preview.test.ts) | — |
| THUMB-002 | 横图、竖图和方图等比完整显示 | 待人类验收 | 导入横图、竖图和方图并观察资产卡片 | 图片保持比例并完整显示，不裁剪、不拉伸 | [0006 QA](0006-thumbnails-preview-format-decoding-qa-report.md) / [媒体预览 E2E](../../tests/e2e/media-preview.test.ts) | — |
| THUMB-003 | 片头黑场 GIF 网格缩略图非纯黑 | 待人类验收 | 导入或打开含片头黑场的多帧 GIF；等待缩略图生成（可重开资源库触发重排队）；对比查看页动画 | 网格卡片显示有内容的帧，非纯黑；查看页仍可播原 GIF | [开发日志](../development/2026-07-18-gif-thumbnail-still-page-development-log.md) / [选帧单测](../../tests/unit/gif-thumbnail-page.test.ts) / 工单 Serpent-1wg | 2026-07-18 实现；旧 GIF 缩略图会在缩略图入队时失效重生成。 |

### F. 资产查看页面

| ID | 功能 | 状态 | 人类操作 | 预期结果 | 证据 | 结果/反馈 |
| --- | --- | --- | --- | --- | --- | --- |
| VIEWER-001 | 从深滚动位置双击查看且返回原位置 | 人类验收通过 | 在含较多资产的范围向下滚动至少数屏，双击当前可见图片；确认内容后按 Esc 退出查看 | 查看页占据中央工作区画布区域（不挡顶栏菜单）；图片成功显示；返回后仍在原滚动位置，原资产保持可见和选中 | [0013 QA](0013-asset-viewer-navigation-and-gestures-qa-report.md) / [连续浏览 E2E](../../tests/e2e/asset-pagination.test.ts) / [查看页开发日志](../development/2026-07-18-viewer-browse-affiliate-development-log.md) | 2026-07-18 用户验收通过（查看页批次一并确认）。 |
| VIEWER-002 | 查看页无顶栏文件名/工具条 | 人类验收通过 | 双击任意图片进入查看页，观察顶部 | 无文件名顶栏、无顶部工具条；仅有边缘上一/下一与底部缩放条 | [开发日志](../development/2026-07-18-viewer-browse-affiliate-development-log.md) | 2026-07-18 用户验收通过。 |
| VIEWER-003 | 查看页视频完整播放不提前重启 | 人类验收通过 | 打开约 5 秒可直出播放的视频进入查看页，不操作控件观看至少 3 秒 | 连续播放、进度前进，不会在约 2 秒处从头循环；时长显示接近真实时长 | [preview-poll 单测](../../tests/unit/preview-poll.test.ts) / [视频 E2E](../../tests/e2e/media-video-playback.test.ts) / [开发日志](../development/2026-07-18-bug-viewer-001-early-loop-development-log.md) | 2026-07-18 用户验收通过。 |
| VIEWER-004 | 查看页为浏览附属层（不挡壳层、切范围退出） | 人类验收通过 | 双击打开查看；打开左上角资源库菜单；再切到侧栏另一文件夹；查看中按后退 | 资源库菜单不被查看层挡住；切文件夹后查看关闭并显示新范围；后退先退出查看回到原浏览位置，不消耗浏览历史 | [开发日志](../development/2026-07-18-viewer-browse-affiliate-development-log.md) / 工单 Serpent-ts2 / 基线 `34442b0` | 2026-07-18 用户验收通过。 |
| VIEWER-005 | 打开即最长边适应；缩放滑块与 Fit | 人类验收通过 | 双击横图与竖图；拖动底部缩放滑块；点 Fit 图标 | 打开时整图可见（最长边贴窗）；底部为小条+滑块+Fit/全屏图标；无加减号 | [fit 单测](../../tests/unit/viewer-fit.test.ts) / [开发日志](../development/2026-07-18-viewer-browse-affiliate-development-log.md) / 工单 Serpent-3w8 / 基线 `34442b0` | 2026-07-18 用户验收通过。 |
| VIEWER-006 | 查看页控件可读、闲置渐隐、主题底色 | 人类验收通过 | 亮色主题下双击打开查看；停住鼠标约 2 秒；再移动；核对左右为 `<>` 形 chevron | 底色为亮色（非纯黑）；静止后控件渐隐，移动后恢复；`<>`/`x` 无底板、无阴影，hover 提亮；无焦点黄边 | [闲置单测](../../tests/unit/use-viewer-chrome-idle.test.ts) / [开发日志](../development/2026-07-18-viewer-browse-affiliate-development-log.md) / 基线 `34442b0` | 2026-07-18 用户验收通过。 |
| VIEWER-007 | 查看页回正、拖拽平移与触控板手势 | 人类验收通过 | 放大后拖拽/两指平移至边缘应停住；Fit 态两指左右切图，放大后两指左右改为平移；捏合缩放；空格或 F 回正；切图后回正；查看时工作区标题栏隐藏 | Fit 为最长边 contain；平移有边界；Fit/全屏为图标；手势逻辑见左列；浏览 toolbar 在查看时隐藏 | [viewer-fit 单测](../../tests/unit/viewer-fit.test.ts) / [ZoomableImage](../../src/renderer/zoomable-preview-image.tsx) / 基线 `34442b0` | 2026-07-18 用户验收通过（手势逻辑按确认保留）。 |
| VIEWER-008 | 双击与右键「查看」均可进入查看页 | 待人类验收 | 双击任一可用图片；再右键另一张选「查看」 | 两种入口均打开浏览附属查看页；右键「查看」在「打开」分组顶部，显示 Enter 快捷键提示 | [开发日志](../development/2026-07-18-viewer-discoverable-entry-development-log.md) / [命令单测](../../tests/unit/asset-commands.test.ts) / 工单 Serpent-tid | 2026-07-18 补右键「查看」命令（双击此前已可用）。 |

### G. 回收站与重新定位

| ID | 功能 | 状态 | 人类操作 | 预期结果 | 证据 | 结果/反馈 |
| --- | --- | --- | --- | --- | --- | --- |
| TRASH-001 | 托管资产移入回收站 | 待人类验收 | 删除一项或多项托管资产后进入回收站 | 正常视图移除这些资产，回收站中可见 | [0007 QA](0007-trash-relink-batch-relocate-qa-report.md) / [组织与回收站 E2E](../../tests/e2e/organization-search-trash.test.ts) | — |
| TRASH-002 | 从回收站恢复资产 | 待人类验收 | 恢复一项回收站资产 | 资产回到可浏览范围，ID、标签和元数据保持 | [0007 QA](0007-trash-relink-batch-relocate-qa-report.md) | — |
| TRASH-003 | 多选后永久删除并确认数量 | 待人类验收 | 在回收站多选两项，执行永久删除并确认 | 确认框显示准确数量；确认后两项消失 | [0007 QA](0007-trash-relink-batch-relocate-qa-report.md) / [组织与回收站 E2E](../../tests/e2e/organization-search-trash.test.ts) | — |
| RELINK-001 | 批量重新定位预览 | 待人类验收 | 让托管资产 missing，选择候选新根并发起预览 | 只显示相对路径和匹配/缺失数量，不泄露候选根绝对路径 | [0007 QA](0007-trash-relink-batch-relocate-qa-report.md) / [重新定位 E2E](../../tests/e2e/trash-relink-flow.test.ts) | — |
| RELINK-002 | 取消批量重新定位不修改资产 | 待人类验收 | 得到预览后取消 | 资产位置和状态不变 | [0007 QA](0007-trash-relink-batch-relocate-qa-report.md) / [重新定位 E2E](../../tests/e2e/trash-relink-flow.test.ts) | — |
| RELINK-003 | 重新预览后应用批量重新定位 | 待人类验收 | 取消一次预览后，重新选择候选根并应用新预览 | 匹配资产恢复可用，使用的是第二次预览结果 | [0007 QA](0007-trash-relink-batch-relocate-qa-report.md) / [重新定位 E2E](../../tests/e2e/trash-relink-flow.test.ts) | — |
| TRASH-004 | 回收站中资产保持可解码预览 | 待人类验收 | 将一项有缩略图的托管资产移入回收站并进入回收站查看；再恢复该资产 | 回收站内缩略图正常显示不丢失；恢复后预览保持不变 | [Wave 1 开发日志](../development/0015-0019-ux-feedback-wave1-development-log.md) / [worker 测试](../../tests/worker/trash-relink.test.ts) | 2026-07-17 根因修复（`39f134d`）；Computer Use 未执行（环境无桌面控制能力，移交人工 QA）。2026-07-17 Wave 3 截图复查通过（10-trash-view.png）。 |
| TRASH-005 | 回收站卡片原位置可读显示 | 待人类验收 | 把根目录的一项资产移入回收站查看卡片第二行；再把文件夹内的资产移入回收站对比 | 根目录资产第二行显示「资源库根目录」而非重复文件名；文件夹内资产显示所在目录路径 | [Wave 3 审查](../reviews/2026-07-17-wave3-ui-ux-audit.md) / [截图](evidence/wave3-ux-audit/10-trash-view.png) / [单测](../../tests/unit/trashed-from-label.test.ts) | 2026-07-17 P3 修复；截图确认。 |

### H. 资产选择与基础右键菜单

| ID | 功能 | 状态 | 人类操作 | 预期结果 | 证据 | 结果/反馈 |
| --- | --- | --- | --- | --- | --- | --- |
| SELECT-001 | 平铺视图框选 | 待人类验收 | 从画布空白处拖框跨越多张卡片 | 与选框相交的资产被选中，松开后选择稳定 | [0014 QA](0014-asset-selection-and-context-actions-qa-report.md) / [框选 E2E](../../tests/e2e/selection-marquee.test.ts) | — |
| SELECT-002 | 瀑布流框选和边缘自动滚动 | 待人类验收 | 在瀑布流中拖框并靠近画布边缘继续拖动 | 跨多屏后首项、中间项、末项均保持选中 | [0014 QA](0014-asset-selection-and-context-actions-qa-report.md) / [框选 E2E](../../tests/e2e/selection-marquee.test.ts) | — |
| SELECT-003 | Shift 连续范围选择 | 待人类验收 | 单击一项，再按住 Shift 单击另一项 | 两项之间的连续范围被选中 | [0014 QA](0014-asset-selection-and-context-actions-qa-report.md) / [框选 E2E](../../tests/e2e/selection-marquee.test.ts) | — |
| SELECT-004 | macOS Command 增减选择 | 待人类验收 | 按住 Command 依次点击未选和已选资产 | 未选资产加入，已选资产移出；其他选择保持 | [0014 QA](0014-asset-selection-and-context-actions-qa-report.md) / [框选 E2E](../../tests/e2e/selection-marquee.test.ts) | — |
| SELECT-005 | Command+Shift 向现有选择追加范围 | 待人类验收 | 已有离散选择时，按 Command+Shift 点击另一项 | 新范围追加到现有选择，不清空原选择 | [0014 QA](0014-asset-selection-and-context-actions-qa-report.md) / [框选 E2E](../../tests/e2e/selection-marquee.test.ts) | — |
| SELECT-006 | Esc 按层级关闭菜单再清空选择 | 待人类验收 | 多选并打开右键菜单，连续按两次 Esc | 第一次只关闭菜单，第二次清空选择 | [0014 QA](0014-asset-selection-and-context-actions-qa-report.md) / [菜单 E2E](../../tests/e2e/context-menu.test.ts) | — |
| SELECT-007 | 框选修饰键集合运算与导航焦点隔离 | 待人类验收 | 先选中资产，再分别用 Shift、Command 框选；观察左侧当前文件夹 | Shift 追加、Command 切换命中项；当前文件夹不因框选获得额外键盘焦点高亮 | [0018–0019 QA](0018-0019-ui-correctness-qa-report.md) / [框选 E2E](../../tests/e2e/selection-marquee.test.ts) | 用户此前报告 Shift 框选使文件夹高亮；已通过开始框选时释放导航焦点修复。 |
| MENU-001 | 外部点击关闭资产菜单 | 待人类验收 | 打开资产右键菜单后点击菜单外部 | 菜单可靠关闭 | [0014 QA](0014-asset-selection-and-context-actions-qa-report.md) / [菜单 E2E](../../tests/e2e/context-menu.test.ts) | — |
| MENU-002 | Esc 关闭资产菜单 | 待人类验收 | 打开资产右键菜单后按 Esc | 菜单可靠关闭 | [0014 QA](0014-asset-selection-and-context-actions-qa-report.md) / [菜单 E2E](../../tests/e2e/context-menu.test.ts) | — |
| MENU-003 | 标签使用统一右键菜单 | 已撤回 | — | — | [MVP UX 需求池](../implementation/mvp-ui-ux-requirements-backlog.md) | 左侧标签列表和独立管理页已取消，此入口不再属于目标产品。 |
| MENU-004 | 合集使用统一右键菜单 | 待人类验收 | 打开合集右键菜单，将指针移过各菜单项后按 Esc | 菜单项可获得悬停反馈，Esc 能关闭，不出现重复菜单 | [0014 QA](0014-asset-selection-and-context-actions-qa-report.md) / [菜单 E2E](../../tests/e2e/context-menu.test.ts) | — |
| MENU-005 | 智能合集使用统一右键菜单 | 待人类验收 | 打开智能合集右键菜单，将指针移过各菜单项后按 Esc | 菜单项可获得悬停反馈，Esc 能关闭，不出现重复菜单 | [0014 QA](0014-asset-selection-and-context-actions-qa-report.md) / [菜单 E2E](../../tests/e2e/context-menu.test.ts) | — |
| MENU-006 | 滚动画布时关闭菜单 | 待人类验收 | 打开菜单后滚动画布 | 菜单关闭，不残留悬浮层 | [0014 QA](0014-asset-selection-and-context-actions-qa-report.md) / [菜单 E2E](../../tests/e2e/context-menu.test.ts) | — |
| MENU-007 | 调整窗口尺寸时关闭菜单 | 待人类验收 | 打开菜单后调整窗口尺寸 | 菜单关闭，不停留在旧位置 | [0014 QA](0014-asset-selection-and-context-actions-qa-report.md) / [菜单 E2E](../../tests/e2e/context-menu.test.ts) | — |
| MENU-008 | 应用失焦时关闭菜单 | 待人类验收 | 打开菜单后切换到其他应用 | 菜单关闭，切回时不残留 | [0014 QA](0014-asset-selection-and-context-actions-qa-report.md) / [菜单 E2E](../../tests/e2e/context-menu.test.ts) | — |
| MENU-009 | 菜单保持窗口内 | 待人类验收 | 分别在窗口四角打开右键菜单 | 菜单自动调整位置，不越出窗口 | [0014 QA](0014-asset-selection-and-context-actions-qa-report.md) / [菜单 E2E](../../tests/e2e/context-menu.test.ts) | — |
| MENU-010 | 同时只显示一个右键菜单 | 待人类验收 | 连续对不同对象打开右键菜单 | 新菜单出现时旧菜单关闭，页面上只有一个菜单 | [0014 QA](0014-asset-selection-and-context-actions-qa-report.md) / [菜单 E2E](../../tests/e2e/context-menu.test.ts) | — |
| MENU-011 | 多选不显示顶部动作 | 待人类验收 | 选择多项资产并观察工作区顶部 | 顶部工具栏不因选择增加移动/删除等动作，不遮挡画布 | [0014 QA](0014-asset-selection-and-context-actions-qa-report.md) / [修复截图](evidence/0014-selection-context/03-all-selected-fixed.png) | — |
| MENU-012 | 多选菜单数量、混合说明与固定目标 | 待人类验收 | 混选 managed、linked、missing 后打开右键菜单 | 显示已选数量、处理/跳过数量和原因；动作只作用于菜单打开时的对象 | [0014 QA](0014-asset-selection-and-context-actions-qa-report.md) / [菜单 E2E](../../tests/e2e/context-menu.test.ts) | — |
| MENU-013 | 右键菜单按指针/键盘显示单一且克制的高亮 | 待人类验收 | 用鼠标依次悬停菜单项，再用方向键移动焦点 | 鼠标只有浅色 hover；键盘导航才显示焦点标记；任一时刻没有双重高亮 | [0018–0019 QA](0018-0019-ui-correctness-qa-report.md) / [菜单 E2E](../../tests/e2e/context-menu.test.ts) | — |
| MENU-015 | 单资产重命名真实文件 | 人类验收通过 | 右键单个可用资产选「重命名…」，输入新主名并确认；再用已存在的名字重试 | 对话框保留扩展名且不可编辑；确认后画布显示新文件名且磁盘真实文件改名；冲突时对话框内联提示且不关闭，可修正重试；资产保持选中 | [开发日志](../development/0017-rename-file-and-tag-nav-removal-development-log.md) / [重命名 E2E](../../tests/e2e/asset-rename.test.ts) / [worker 测试](../../tests/worker/asset-rename.test.ts) | 2026-07-17 实现；Computer Use 未执行（环境无桌面控制能力，移交人工 QA）。2026-07-17 用户逐项回复“ok”验收通过。2026-07-17 注：交互已由对话框改为原地编辑（MENU-019），本条目保留验收记录，后续回归以 MENU-019 步骤为准。 |
| MENU-016 | 从文件夹右键菜单新建子文件夹 | 人类验收通过 | 在左侧目录树右键一个托管文件夹选「新建子文件夹」，输入名称并创建 | 对话框提示将建在该文件夹内；创建后子文件夹嵌套显示在其下，磁盘出现真实目录；从侧栏「+」入口新建仍落在当前选中位置 | [开发日志](../development/0017-folder-context-menu-and-rename-development-log.md) / [文件夹菜单 E2E](../../tests/e2e/folder-context-menu.test.ts) | 2026-07-17 实现；Computer Use 未执行（环境无桌面控制能力，移交人工 QA）。2026-07-17 用户逐项回复“ok”验收通过。2026-07-17 注：交互已由对话框改为原地编辑（MENU-019），本条目保留验收记录，后续回归以 MENU-019 步骤为准。 |
| MENU-017 | 重命名托管文件夹真实目录 | 人类验收通过 | 右键托管文件夹选「重命名…」，输入新名确认；再用同级已存在的名字和含 `?` 的名字各重试一次 | 对话框预填当前名；确认后侧栏与面包屑显示新名、磁盘真实目录改名、文件夹内资产保持可见；同名冲突与非法名均内联提示且对话框不关闭，可修正重试 | [开发日志](../development/0017-folder-context-menu-and-rename-development-log.md) / [文件夹菜单 E2E](../../tests/e2e/folder-context-menu.test.ts) / [worker 测试](../../tests/worker/folder-rename.test.ts) | 2026-07-17 实现；Computer Use 未执行（环境无桌面控制能力，移交人工 QA）。2026-07-17 用户逐项回复“ok”验收通过。2026-07-17 注：交互已由对话框改为原地编辑（MENU-019），本条目保留验收记录，后续回归以 MENU-019 步骤为准。 |
| MENU-018 | 文件夹右键「在 Finder 中打开」与「复制文件夹路径」 | 待人类验收 | 分别右键托管文件夹与链接文件夹：执行「在 Finder 中打开」；执行「复制文件夹路径」后粘贴核对；离线链接文件夹查看菜单 | 访达打开对应真实目录；剪贴板内容为该目录绝对路径；离线链接两项禁用并说明原因 | [Wave 1 开发日志](../development/0015-0019-ux-feedback-wave1-development-log.md) / [worker 测试](../../tests/worker/folder-path.test.ts) / [协议单测](../../tests/unit/protocol.test.ts) | 2026-07-17 Wave 1 T2 实现（全链路，Renderer 只传 folder ID）；Computer Use 未执行，移交人工 QA。 |
| MENU-019 | 文件夹原地新建与重命名（无对话框） | 待人类验收 | 右键文件夹选「重命名…」：行内输入新名回车；再触发一次用同级重名/含 `?` 名称重试；右键选「新建子文件夹」：子级首行行内输入名称创建；Esc 取消；侧栏「+」新建 | 名称在行内直接编辑不弹窗；非法/重名错误内联显示在行下方且可继续修正；Esc 或空值失焦取消不产生变化；「+」落在当前选中文件夹下 | [Wave 1 开发日志](../development/0015-0019-ux-feedback-wave1-development-log.md) / [状态机单测](../../tests/unit/inline-folder-edit.test.ts) / [文件夹菜单 E2E](../../tests/e2e/folder-context-menu.test.ts) | 2026-07-17 Wave 1 T4 实现；Computer Use 未执行，移交人工 QA。 |
| SELECT-008 | 选中描边完整外扩可见，Shift 悬停无双圈 | 待人类验收 | 选中任意资产观察四边描边；保持选中后按住 Shift 并将指针移上已选资产 | 描边在预览图外侧完整环绕四边，比预览边框略粗；任何修饰键悬停都不再出现第二圈描边 | [Wave 1 开发日志](../development/0015-0019-ux-feedback-wave1-development-log.md) | 2026-07-17 Wave 1 T1 实现（外扩 2px 环 + :focus-visible 叠加根因修复）；Computer Use 未执行，移交人工 QA。 |
| SELECT-009 | 多选标量属性「多个值」与统一编辑 | 待人类验收 | 框选两项描述/评分/喜欢不同的资产，观察 Inspector；再框选两项这些字段相同的资产，改描述并失焦，逐项核对 | 值不同时对应控件显示「多个值」且不可改；值相同时可编辑，保存后两项一致；不再出现「将应用于 N 项」提示 | [开发日志](../development/2026-07-18-ue-multi-edit-inspector-development-log.md) / [决策单测](../../tests/unit/inspector-multi-edit.test.ts) / 工单 Serpent-eb7 | 2026-07-18 实现；Computer Use 未执行。 |
| SELECT-010 | 多选标签显示共有交集并可批量增删 | 待人类验收 | 两项资产各有不同标签且有一个共有标签；多选后看 Inspector 标签区；移除共有标签；再添加新标签；分别单选核对 | 仅显示共有标签；移除后两项都没有该标签；新标签两项都有；无共有时提示「选中项无共有标签」 | [开发日志](../development/2026-07-18-ue-multi-edit-inspector-development-log.md) / [决策单测](../../tests/unit/inspector-multi-edit.test.ts) / 工单 Serpent-eb7 | 2026-07-18 实现；Computer Use 未执行。 |
| SELECT-011 | 多选 Inspector 堆叠预览与「等 n 个文件」 | 人类验收通过 | 框选 ≥2 项带缩略图的资产，观察右侧 Inspector 顶部 | 预览框以主选图比例定尺寸，其余层同框裁剪（cover）并轻微错开；标题在堆叠下方完整可见，为「主文件名 等N个文件」 | [开发日志](../development/2026-07-18-ue-multi-edit-inspector-development-log.md) / [堆叠单测](../../tests/unit/inspector-multi-edit.test.ts) | 2026-07-18 实现；同日修正堆叠盖住标题。2026-07-18 用户验收通过（基线 `5104747`）。 |
| NAV-004 | 目录树高亮仅背景变化 | 待人类验收 | 在左侧目录树选择不同文件夹并悬停其他行 | 选中/悬停只有背景深浅变化，没有强调色竖条或描边 | [Wave 1 开发日志](../development/0015-0019-ux-feedback-wave1-development-log.md) | 2026-07-17 Wave 1 T1 实现；Computer Use 未执行，移交人工 QA。 |
| NAV-005 | 目录树折叠 disclosure | 待人类验收 | 打开含嵌套子文件夹的资源库；点父文件夹左侧箭头折叠；再展开；完全退出后重开 | 折叠后子行隐藏，合集区更易进首屏；展开恢复；重启后折叠状态保持 | [开发日志](../development/2026-07-18-nav-tree-collapse-development-log.md) / [可见性单测](../../tests/unit/unified-directory-nav.test.ts) / 工单 Serpent-5n5 | 2026-07-18 实现。 |
| THEME-001 | 默认蓝色强调色与中性小巧滑块 | 待人类验收 | 观察界面强调色（按钮、选中、焦点）；查看浏览工具栏卡片尺寸滑块 | 强调色为蓝色不再是绿色；滑块轨道更细、thumb 更小且为中性灰色 | [Wave 1 开发日志](../development/0015-0019-ux-feedback-wave1-development-log.md) | 2026-07-17 Wave 1 T1 实现（token #3b82f6 + color-mix 派生）；Computer Use 未执行，移交人工 QA。 |
| THEME-002 | 亮/暗/跟随系统主题切换与持久化 | 人类验收通过 | 资源库菜单 → 主题 → 亮色；观察壳层与画布；完全退出后重启；再试暗色与跟随系统 | 亮色下表面为浅色语义 token；重启后仍为所选偏好；跟随系统时随 OS 外观变化 | [主题单测](../../tests/unit/theme-preferences.test.ts) / [开发日志](../development/2026-07-18-theme-foundation-development-log.md) | 2026-07-18 用户验收通过（含对比度、toast 去描边、右键阴影、亮色星标 #ecc83a）。 |
| CANVAS-010 | 资产卡片预览图四角圆角 | 待人类验收 | 查看任意资产卡片预览图的上边与下边 | 预览图上下边均为圆角，下边缘不再是直角 | [Wave 1 开发日志](../development/0015-0019-ux-feedback-wave1-development-log.md) | 2026-07-17 Wave 1 T1 实现；Computer Use 未执行，移交人工 QA。 |
| CANVAS-011 | AI 搜索按钮与加宽搜索框 | 待人类验收 | 查看浏览工具栏 AI 搜索按钮与关键词输入框；输入若干文字 | 按钮图标为星芒样式且文字不溢出按钮；搜索框明显加宽，窄窗时也不挤压其他控件 | [Wave 1 开发日志](../development/0015-0019-ux-feedback-wave1-development-log.md) | 2026-07-17 Wave 1 T1 实现；Computer Use 未执行，移交人工 QA。 |
| SHELL-007 | 新建资源库直出表单与冗余文案清理 | 待人类验收 | 在未打开资源库的起始页与「创建资源库」界面观察 | 不再出现「01」步骤侧边栏与英文装饰行（如 LOCAL ASSET WORKSPACE / NEW LOCAL LIBRARY / MANAGED ASSETS）；中文界面只有功能性文字 | [Wave 1 开发日志](../development/0015-0019-ux-feedback-wave1-development-log.md) | 2026-07-17 Wave 1 T1/T4 实现；Computer Use 未执行，移交人工 QA。 |
| SHELL-008 | 通知淡出过渡 | 待人类验收 | 触发一条通知（如复制文件夹路径成功）并等待自动关闭 | 通知消失前有短暂淡出下移过渡，不是瞬间消失 | [Wave 1 开发日志](../development/0015-0019-ux-feedback-wave1-development-log.md) / [状态机单测](../../tests/unit/toast-notifications.test.ts) | 2026-07-17 Wave 1 T1 实现；Computer Use 未执行，移交人工 QA。 |
| SHELL-009 | 左右侧栏拖拽调宽并持久化 | 人类验收通过 | 拖动左侧导航右缘与右侧 Inspector 左缘改变宽度；双击拖拽柄；完全退出 Serpent 后重开 | 两面板宽度随拖动实时变化并有范围限制；双击恢复默认宽度；重启后宽度保持 | [Wave 2 开发日志](../development/0015-0019-ux-feedback-wave2-development-log.md) / [偏好单测](../../tests/unit/shell-preferences.test.ts) | 2026-07-17 Wave 2 T5 实现；Computer Use 未执行，移交人工 QA。2026-07-17 用户手动验收：“左右侧边栏可拖动，测试通过”。 |
| DND-001 | 拖拽资产到文件夹完成移动 | 待人类验收 | 拖动一项资产（及一个多选）到左侧某个托管文件夹；再拖到当前文件夹；拖到「资源库根目录」 | 目标行悬停有背景高亮；松开后资产移动到目标文件夹并提示移动/跳过数量；拖到当前文件夹提示无需移动 | [Wave 2 开发日志](../development/0015-0019-ux-feedback-wave2-development-log.md) / [拖放单测](../../tests/unit/asset-drag-drop.test.ts) | 2026-07-17 Wave 2 T6 实现；拖到链接文件夹为既有「复制到链接文件夹」行为。Computer Use 未执行，移交人工 QA。 |
| DND-002 | 拖拽资产到回收站完成删除 | 待人类验收 | 拖动一项资产（及一个多选）到左侧「回收站」 | 回收站行悬停有背景高亮；松开后资产移入回收站并可在回收站看到；链接资产等不适用项会计入跳过提示 | [Wave 2 开发日志](../development/0015-0019-ux-feedback-wave2-development-log.md) / [拖放单测](../../tests/unit/asset-drag-drop.test.ts) | 2026-07-17 Wave 2 T6 实现；Computer Use 未执行，移交人工 QA。 |
| DND-003 | 拖拽预览小图标 | 待人类验收 | 拖动一项资产观察跟随光标的预览；再框选多项后拖动 | 预览为缩小、圆角、半透明图标（约 96×72、透明度约 0.6、圆角约 9px），不再是不透明的整卡快照；多选时预览带数量徽标 | [批次 3 开发日志](../development/0015-0019-ux-feedback-batch3-development-log.md) / [预览模型单测](../../tests/unit/asset-drag-preview.test.ts) | 2026-07-17 实现（setDragImage 自定义预览节点）；合集内排序拖拽保持原生预览。Computer Use 未执行，移交人工 QA。 |
| DND-004 | 拖拽悬停文件夹高亮稳定性 | 待人类验收 | 拖动资产在左侧多个文件夹行之间来回移动并逐行停留；也在链接文件夹行上停留 | 每个目标行（含链接文件夹）稳定高亮，不闪烁、不丢失；移开后高亮消失 | [批次 3 开发日志](../development/0015-0019-ux-feedback-batch3-development-log.md) | 2026-07-17 修复（drop-target 特异性压过 hover、行子元素 pointer-events 豁免、dragleave relatedTarget 守卫、链接行补高亮）；Computer Use 未执行，移交人工 QA。 |

### I. 资源库导入导出

| ID | 功能 | 状态 | 人类操作 | 预期结果 | 证据 | 结果/反馈 |
| --- | --- | --- | --- | --- | --- | --- |
| TRANSFER-001 | 文件夹格式导出并重新导入 | 待人类验收 | 导出临时资源库为文件夹，再从导出目录导入副本 | 副本可打开；资产数量一致，抽查文件内容一致；原库不受影响 | [0010 QA](0010-library-import-export-qa-report.md) | — |
| TRANSFER-002 | ZIP 格式导出并重新导入 | 待人类验收 | 导出 ZIP，再导入到新位置 | 新资源库可打开；资产数量一致，抽查文件内容一致 | [0010 QA](0010-library-import-export-qa-report.md) | — |

## 暂不可验收

以下范围已知不满足进入待验收队列的条件；agent 修复并补齐证据后，必须新增独立 ID 或按历史记录重新进入队列：

- 2026-07-16 MVP UI/UX 需求池：0015–0018 未全部完成；`38fa873`、`591f524`、`64521c3`、`197ea9e`、`e2d5d60` 的部分实现已进入当前集成基线，0018 Label 退役/Inspector 标签与 0019 产品正确性已进入实现 `5b8b8fe`。SHELL-001–003、MENU-014、COMMAND-001 已于 2026-07-17 人类验收通过；其余相关条目仍为 TAG-006–008、CANVAS-007–009、INSPECT-001–004、MENU-013、SELECT-007 等。
- 文件夹浏览：画布尚不显示子文件夹卡片、内容封面和统一目录计数；“包含子文件夹资产”尚无正式 UI。
- 文件操作：资产菜单已具备外部打开、在 Finder/Explorer 显示、复制文件路径（2026-07-17，协议单测绿、Computer Use 未执行）与重命名真实文件（2026-07-17 第二增量，全链路 + E2E 3/3，见 MENU-015）；文件夹菜单已具备新建子文件夹与重命名真实目录（2026-07-17 第三增量，全链路 + worker 10/10 + E2E 4/4，见 MENU-016/MENU-017）；仍缺资产其他应用打开方式选择、复制/粘贴，文件夹复制/粘贴/克隆/移动/删除（#5/#7 待裁决），链接文件夹菜单动作。
- 框选集合运算：Shift 并集、Command 切换与 Command+Shift 范围追加已有实现；差集/对称差不作为当前额外模式，Windows 真实 Ctrl 仍待平台验证。
- 标签新体验：Inspector chip 已由用户验收，空输入按创建时间提供最近添加且仍在使用的标签；右键菜单批量可搜索选择器 2026-07-17 已实现（自动化全绿，Computer Use 证据未执行，TAG-004/TAG-005 待补证据后重新验收）；左侧标签枚举移除 2026-07-17 第二增量已实现（含 shell-navigation 负向断言），发现工具栏「标签过滤」输入框是进入标签范围的保留入口；标签重命名/删除暂无 UI 入口，待集中澄清队列 #8 裁决；仍未完成的是基于实际使用行为的最近时间和维度式标签过滤器。
- Label 退役：ADR 0022 与预发布迁移策略已确认；数据库 v14、FTS、AI 和一等协议退役已有自动化与真实应用 QA；`META-001`、`SEARCH-002` 保持撤回，因为产品概念本身已删除。
- 中英文：i18n 模块与 zh-CN/en 目录已落地（2026-07-18）；渲染层主要 UI（壳层/命令/对话框/侧栏/Inspector/App toast/查看页/批量与重命名）已迁入翻译键；I18N-001–003 人类验收通过；默认语言跟随系统。亮/暗/跟随系统主题已落地；THEME-002、AVAIL-001 人类验收通过（2026-07-18）。默认语言跟随系统。
- 应用壳与发现工具栏：纯色画布与冗余装饰清理已验收；资源库下拉、可点击面包屑、后退/前进、统一目录树已进入 0016-A 待验收；过滤条和导入迁出常驻工具栏仍待后续。
- Computer Use：已对当前 0018–0019 集成候选执行真实应用检查；Inspector 等比轻圆角预览和标签选择器截图见 `evidence/0018-0019-ui-correctness/`。工具栏/导航未按 0016-A 收口仍是下一增量。
- 单项读取失败不阻断整批链接恢复：缺少稳定的人类可制造场景与公共 UI 证据。
- 元数据并发冲突：缺少双客户端并发的人类验收夹具。
- 回收站占用文件的部分成功/跳过：需要稳定制造 `FILE_BUSY` 的平台夹具。
- 导入/导出的进度与取消：自动化已覆盖，但当前 20,000 资产 soak 夹具只存在于 Worker 测试中，没有可由人类独立生成和打开的固定资源库，因此暂不进入人工队列。
- 0013 查看页面完整 UX：`VIEWER-001`–`VIEWER-007` 已于 2026-07-18 人类验收通过（基线 `34442b0`）；视频播放器空格/倍速等仍见需求池。
- 0020 检查器与壳层打磨：macOS 开发态自动化 63 E2E 全绿、用户已人工验收色卡复制与整体视觉；Windows 平台与 packaged app 未验证；独立 agent 交叉审查因 kimi 配额受限未完整执行，最终 accepted 未独立签署。
- 0014 发布级证据：功能候选 `f1330a7` 已开放人类验收；最终集中 `verify:mainline`、macOS packaged 与 Windows 平台验收未执行。
- 0007 真实进程恢复：v3 已按“归属不明不删除”关闭误删窗口；恢复测试仍为 `closeAll()`+新实例，非真实 UtilityProcess kill/restart。
- 0005 当前 HEAD packaged 搜索与智能合集：正式媒体二进制 bundle 尚未发布，当前代码无法完成新包验收；新增 packaged 测试也未覆盖智能合集。
- 0006 发布包媒体能力：不可变 FFmpeg/OIIO 发布来源、receipt、packaged playback 与 Windows 验证仍是发布阻断。
- 0008 浏览器扩展真实 Chrome/Edge 往返、packaged 和 Windows 行为。
- 0009 完整 AI 用户旅程：范围分析/清空入口、密钥边界决定和真实供应商验证。
- 0010 完整迁移一致性：元数据、标签、合集、revision、soak 20k 往返自动化通过（现已通过真实 `trashAssets` API + `.serpent/trash` 物理目录验证）；剩余 macOS packaged、Windows↔macOS、长路径/非 ASCII 未验证。
- 0011 CLI：已排入 v0.2.0，尚未实现。
- Windows 平台整体：当前没有真实 runner；Windows Ctrl 多选、long path、文件占用、系统回收站和打包都不能用 macOS 结果替代。

## 人类验收记录

用户每次给出结论时，在这里追加一条，不覆盖历史：

| 日期 | ID | 结论 | 用户原始反馈摘要 | 后续动作 |
| --- | --- | --- | --- | --- |
| 2026-07-16 | META-001 / SEARCH-002 | 已撤回 | 删除 Label/显示别名设计，资产名称统一使用真实文件名。 | ADR 0022；0018 完成字段退役和兼容迁移。 |
| 2026-07-16 | TAG-001–005 / MENU-003 | 部分撤回、部分不通过 | 不在左侧展示全部标签，也不设置独立标签管理页；标签用于过滤并在 Inspector 以 chip 编辑，大量标签不能直接铺进菜单。 | 0018 完成新入口和可搜索批量选择器后拆分新的可验收步骤。 |
| 2026-07-16 | FILTER-001–008 | 人类验收不通过 | 当前过滤工具不是美术友好的工作方式；参考 Eagle 的紧凑维度过滤条重做。 | 0016 保留查询语义、替换交互层，再按字段拆分重新验收。 |
| 2026-07-16 | TAG-006–008 / CANVAS-009 | 人类验收通过 | “瀑布流、标签我也验收了，还不错。” | 保持回归测试；继续完成标签过滤/批量入口和其他壳层优化。 |
| 2026-07-16 | INSPECT-003 | 人类验收通过 | 等比布局正确后，竖图不应显示包住留白的统一边框；图片本身保留些许圆角。 | 用户确认测试通过并明确反馈“这个圆角没问题”；保持真实媒体解码/比例 E2E。 |
| 2026-07-17 | SHELL-001–003 / MENU-014 / COMMAND-001 | 人类验收通过 | 用户明确确认已手动验收。 | 保持回归；继续 0016-A 资源库菜单/面包屑/历史导航与统一目录树。 |
| 2026-07-17 | SHELL-009 / LIB-003 / MENU-020 / FILTER-012 | 人类验收通过 | “左右侧边栏可拖动，测试通过”“LIB-003通过”“多选菜单接入注册表。标签确实可以应用到选中的所有资产”“递归搜索通过”。另确认面包屑（NAV-001）早已实现、保持通过。 | 保持回归；多选属性交互新模型入需求池 REQ-SELECT-004。 |
| 2026-07-17 | FOLDER-001 | 人类验收不通过 | “递归显示不通过。需要显式勾选选项才能够显示递归显示内容。” | REQ-FOLDER-009：递归显示改为显式开关（默认不递归），实现后重新验收。 |
| 2026-07-17 | 查看页与播放体验反馈 | 记录为需求/缺陷 | 查看不应显示“正在生成预览”阻塞（REQ-VIEW-002）；视频元数据需帧率/码率（REQ-VIEW-003）；查看页应为浏览附属层、后退与切换文件夹可退出（REQ-VIEW-004）；播放器需空格暂停/倍速（REQ-VIEW-005）；5 秒视频只播 2 秒循环（BUG-VIEWER-001）；网格动图/视频预览（REQ-CANVAS-009）；侧栏拖小可隐藏（REQ-SHELL-011）；文件夹删除（CU-M3，用户点名）；创建资源库文案口语化（REQ-SHELL-012）。 | 全部拆解入需求池“2026-07-17 第三批反馈（验收驱动）”。 |
| 2026-07-18 | INSPECT-005 / PALETTE-001 / URL-OPEN-001 / AICFG-001 / FILTER-OUTSIDE-DISMISS-001 / TOOLBAR-001 | 人类验收通过 | 「色卡均匀+点击复制我验证过了，可以没问题」；其余打磨项（设计令牌、工具栏图标化、资产卡片、侧栏导航、Inspector 重设计、描述自适应、源链接跳转、AI 配置去强调色、筛选面板外部点击关闭）随色卡一并确认。 | 保持回归 E2E 63 绿；Windows 与 packaged 待后续验证；独立 agent 交叉审查因配额未完整执行。 |
| 2026-07-18 | SHELL-013 / FOLDER-009 | 人类验收通过 | 用户确认「这俩可以验收」：图标悬停提示与包含子文件夹显式开关（标题左侧、按文件夹持久化）。 | 保持 HoverTipHost 与 folder-recursive 偏好回归。 |
| 2026-07-18 | META-006 | 已撤回 | Serpent-7pg 移除自定义/人工色卡功能入口。 | 新增 META-008（自动色卡只读展示）；META-007 持久化范围去掉人工色卡。 |
