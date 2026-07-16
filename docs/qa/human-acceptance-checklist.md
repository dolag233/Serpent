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
| SHELL-004 | 左上角资源库名称下拉菜单 | 人类验收不通过 | 打开资源库后点击左上角名称，检查新建/打开/关闭与本机其他资源库列表 | 无 `S` 品牌字形；菜单可新建、打开、关闭资源库；并显示本机其他资源库供直接打开 | [0016-A 规格](../implementation/0016-a-shell-navigation-slice.md) / [壳层 E2E](../../tests/e2e/shell-navigation.test.ts) | 2026-07-17 用户反馈：SHELL-004 需要能够显示本电脑的其他资源库，方便直接打开。修复后重新进入待验收。 |
| SHELL-005 | 截断文本省略号垂直对齐 | 人类验收不通过 | 查看资产卡片文件名、面包屑等长文本被截断的位置 | 省略号贴文本基线（向下对齐），不悬空居中 | — | 2026-07-17 用户反馈：字数太长用于省略的省略号需要向下对齐，现在是居中对齐。修复后重新进入待验收。 |
| SHELL-006 | 左侧导航面板状态点清理 | 人类验收不通过 | 查看左侧导航面板顶部与底部 | 不再显示任何表示状态的小点 | — | 2026-07-17 用户反馈：左侧面板上方和下方的表示状态的小点都是冗余的。修复后重新进入待验收。 |
| NAV-001 | 无边框可点击面包屑 | 人类验收通过 | 进入嵌套托管文件夹，点击父级面包屑 | 不显示前缀“资源库 >”；父目录可跳转；当前段不可点 | [0016-A 规格](../implementation/0016-a-shell-navigation-slice.md) / [面包屑单测](../../tests/unit/scope-breadcrumbs.test.ts) | 2026-07-17 用户明确反馈“NAV-001已验收”。 |
| NAV-002 | 工作区后退/前进 | 人类验收不通过 | 在文件夹与所有资产间切换后按后退再前进 | 恢复此前浏览范围；与查看页返回无关；按钮 icon 形似 < >，位于资产浏览页上方 bar 最左边、当前目录名称左边 | [0016-A 规格](../implementation/0016-a-shell-navigation-slice.md) / [历史单测](../../tests/unit/workspace-nav-history.test.ts) | 2026-07-17 用户反馈：前进后退按钮的 icon 不对，需要形似 <>；位置需在 bar 最左边、当前目录名称左边。修复后重新进入待验收。 |
| NAV-003 | 托管与链接文件夹统一目录树 | 待人类验收 | 同时存在托管文件夹和链接文件夹时查看左侧“文件夹” | 无独立“链接文件夹”分区；链接用彩色链接图标，离线红色断链并可悬停说明 | [0016-A 规格](../implementation/0016-a-shell-navigation-slice.md) / [统一树单测](../../tests/unit/unified-directory-nav.test.ts) | 2026-07-17 用户表示目前不会进行手动验收，保持待验收。 |
| MENU-014 | 资产右键菜单按语义分组 | 人类验收通过 | 选中资产打开右键菜单，检查“打开/组织/元数据/删除” | 同类操作在同一组，不同组之间有分隔，危险操作独立 | [进度同步](../development/0015-0016-progress-sync.md) / [菜单 E2E](../../tests/e2e/context-menu.test.ts) | 2026-07-17 用户手动验收通过；完整文件操作菜单仍在后续条目。 |
| COMMAND-001 | 菜单显示已实现命令的快捷键 | 人类验收通过 | 打开单资产菜单，查看外部打开和移入回收站条目 | 显示当前平台快捷键，且按对应快捷键执行同一动作 | [进度同步](../development/0015-0016-progress-sync.md) / [快捷键单测](../../tests/unit/asset-command-shortcuts.test.ts) | 2026-07-17 用户手动验收通过；完整命令注册表仍未完成。 |

### A. 资源库与导入

| ID | 功能 | 状态 | 人类操作 | 预期结果 | 证据 | 结果/反馈 |
| --- | --- | --- | --- | --- | --- | --- |
| LIB-001 | 创建、关闭并重新打开资源库 | 待人类验收 | 创建临时资源库，关闭后从起始页重新打开 | 名称、目录和资产保持一致；失败时显示具体原因 | [0001 QA](0001-library-shell-qa-report.md) / [生命周期 E2E](../../tests/e2e/library-lifecycle.test.ts) | — |
| LIB-002 | 完整退出后恢复最近资源库 | 待人类验收 | 打开一个资源库，完全退出 Serpent 后重新启动 | 自动打开刚才使用的资源库 | [生命周期 E2E](../../tests/e2e/library-lifecycle.test.ts) | — |
| LIB-003 | 完整退出后恢复上次浏览资产 | 待人类验收 | 选中一项资产，完全退出后重新启动 | 恢复到原浏览范围，并将原资产带回视野和焦点 | [生命周期 E2E](../../tests/e2e/library-lifecycle.test.ts) | — |
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
| META-006 | 编辑和清空人工色卡 | 待人类验收 | 设置人工色卡并保存，再清空并保存 | 色卡可保存也可清空，不残留旧颜色 | [0004 QA](0004-tags-collections-metadata-qa-report.md) / [组织持久化 E2E](../../tests/e2e/organization-metadata-persistence.test.ts) | — |
| META-007 | 元数据跨完整重启持久化 | 待人类验收 | 保存一组元数据，完全退出 Serpent 后重新启动 | 重启前保存的每个字段值均恢复 | [0004 QA](0004-tags-collections-metadata-qa-report.md) / [组织持久化 E2E](../../tests/e2e/organization-metadata-persistence.test.ts) | — |
| TAG-001 | 创建标签 | 已撤回 | — | — | [MVP UX 需求池](../implementation/mvp-ui-ux-requirements-backlog.md) | 旧入口依赖左侧完整标签列表；新入口改为 Inspector tag chip 的搜索/输入创建，实施后用新步骤重新进入验收。 |
| TAG-002 | 重命名标签 | 已撤回 | — | — | [MVP UX 需求池](../implementation/mvp-ui-ux-requirements-backlog.md) | 用户确认不设标签管理页；全局重命名入口待集中确认后重新定义。 |
| TAG-003 | 删除标签 | 已撤回 | — | — | [MVP UX 需求池](../implementation/mvp-ui-ux-requirements-backlog.md) | 用户确认不设标签管理页；全局删除入口待集中确认后重新定义。 |
| TAG-004 | 给多项资产分配标签 | 人类验收不通过 | — | — | [MVP UX 需求池](../implementation/mvp-ui-ux-requirements-backlog.md) | 批量能力保留，但当前菜单直接枚举全部标签，不适合大量标签；改为可搜索选择器后重新验收。 |
| TAG-005 | 从多项资产移除标签 | 人类验收不通过 | — | — | [MVP UX 需求池](../implementation/mvp-ui-ux-requirements-backlog.md) | 批量能力保留，但当前入口随标签数量膨胀；改为可搜索选择器后重新验收。 |
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
| SORT-001 | 按名称排序 | 待人类验收 | 选择名称排序 | 结果按真实文件名稳定排列 | [0005 QA](0005-search-filter-sort-smart-collections-qa-report.md) | — |
| SORT-002 | 按日期排序 | 待人类验收 | 选择日期排序 | 结果按所示日期稳定排列 | [0005 QA](0005-search-filter-sort-smart-collections-qa-report.md) | — |
| SORT-003 | 按大小排序 | 待人类验收 | 选择文件大小排序 | 结果按文件大小稳定排列 | [0005 QA](0005-search-filter-sort-smart-collections-qa-report.md) | — |
| SORT-004 | 切换升序和降序 | 待人类验收 | 在同一排序字段下切换升序和降序 | 两次结果顺序互为反向，缺失值位置稳定 | [0005 QA](0005-search-filter-sort-smart-collections-qa-report.md) | — |
| SEARCH-004 | 超过 50 项时连续纵向浏览 | 待人类验收 | 在至少 60 项的范围中持续向下滚动到底 | 全部资产可到达，无分页按钮、重复或遗漏 | [0005 QA](0005-search-filter-sort-smart-collections-qa-report.md) / [连续浏览 E2E](../../tests/e2e/asset-pagination.test.ts) | — |
| SMART-001 | 保存智能合集 | 待人类验收 | 将当前搜索、过滤和排序条件保存为智能合集 | 新智能合集出现在侧栏 | [0005 QA](0005-search-filter-sort-smart-collections-qa-report.md) | — |
| SMART-002 | 执行智能合集 | 待人类验收 | 打开已保存的智能合集 | 按已保存条件查询当前数据并显示结果 | [0005 QA](0005-search-filter-sort-smart-collections-qa-report.md) | — |
| SMART-003 | 更新智能合集条件 | 待人类验收 | 修改一个智能合集的查询或排序条件后保存 | 再次打开时使用新条件 | [0005 QA](0005-search-filter-sort-smart-collections-qa-report.md) | — |
| SMART-004 | 重命名智能合集 | 待人类验收 | 重命名已有智能合集 | 新名称立即出现，查询条件保持 | [0005 QA](0005-search-filter-sort-smart-collections-qa-report.md) | — |
| SMART-005 | 删除智能合集 | 待人类验收 | 删除已有智能合集 | 智能合集消失，资产不受影响 | [0005 QA](0005-search-filter-sort-smart-collections-qa-report.md) | — |

### E. 资产画布与缩略图

| ID | 功能 | 状态 | 人类操作 | 预期结果 | 证据 | 结果/反馈 |
| --- | --- | --- | --- | --- | --- | --- |
| CANVAS-001 | 平铺视图完整到达首尾 | 待人类验收 | 切到平铺视图，分别滚动到最上和最下 | 所有资产均可到达，顶部和底部不裁剪，没有分页 | [0012 QA](0012-asset-canvas-views-and-card-display-qa-report.md) / [浏览偏好 E2E](../../tests/e2e/browsing-preferences.test.ts) | — |
| CANVAS-002 | 瀑布流视图完整到达首尾 | 待人类验收 | 切到瀑布流视图，分别滚动到最上和最下 | 所有资产均可到达，顶部和底部不裁剪，没有分页 | [0012 QA](0012-asset-canvas-views-and-card-display-qa-report.md) / [浏览偏好 E2E](../../tests/e2e/browsing-preferences.test.ts) | — |
| CANVAS-003 | 用滑块调整资产卡片大小 | 待人类验收 | 拖动卡片大小滑块缩小再放大 | 卡片尺寸连续变化，布局无重叠 | [0012 QA](0012-asset-canvas-views-and-card-display-qa-report.md) | — |
| CANVAS-004 | macOS 手势缩放卡片并保持视觉锚点 | 待人类验收 | 将鼠标放在某项资产附近，用 Ctrl+滚轮或触控板缩放卡片 | 指针附近的可见资产尽量保持在原视野 | [0012 QA](0012-asset-canvas-views-and-card-display-qa-report.md) / [浏览偏好 E2E](../../tests/e2e/browsing-preferences.test.ts) | — |
| CANVAS-005 | 控制卡片字段显示 | 待人类验收 | 分别关闭文件名、大小和修改日期 | 对应字段立即隐藏，其他字段不受影响 | [0012 QA](0012-asset-canvas-views-and-card-display-qa-report.md) | — |
| CANVAS-006 | 画布偏好跨完整重启保存 | 待人类验收 | 修改视图、卡片大小和字段开关，完全退出后重开 | 所有画布偏好恢复 | [0012 QA](0012-asset-canvas-views-and-card-display-qa-report.md) / [浏览偏好 E2E](../../tests/e2e/browsing-preferences.test.ts) | — |
| CANVAS-007 | 小卡片平铺用满横向宽度 | 待人类验收 | 切到平铺视图，把卡片缩至最小并改变窗口宽度 | 每行弹性铺满，不留下可再容纳一列的大空当 | [0018–0019 QA](0018-0019-ui-correctness-qa-report.md) / [浏览偏好 E2E](../../tests/e2e/browsing-preferences.test.ts) | 从旧合并条目拆出；瀑布流另由 CANVAS-009 记录。 |
| CANVAS-008 | 修改日期开关使用时钟图标 | 待人类验收 | 查看浏览工具栏的修改日期显示开关 | 使用秒表/时钟语义图标，不再显示五角星 | [0018–0019 QA](0018-0019-ui-correctness-qa-report.md) | — |
| CANVAS-009 | 稀疏瀑布流横向优先且不留大空当 | 人类验收通过 | 在只有 3 项的范围切到瀑布流并缩小卡片 | 首三项从左到右位于第一行；后续按最短列布局，首尾可达 | [0018–0019 QA](0018-0019-ui-correctness-qa-report.md) / [浏览偏好 E2E](../../tests/e2e/browsing-preferences.test.ts) | 2026-07-16 用户明确反馈“瀑布流……验收了，还不错”。 |
| INSPECT-001 | Inspector 显示真实缩略图 | 待人类验收 | 依次选择支持预览的图片和视频 | Inspector 显示已成功解码的图片或视频封面，不是通用文件图标 | [0018–0019 QA](0018-0019-ui-correctness-qa-report.md) / [媒体 E2E](../../tests/e2e/media-preview.test.ts) | — |
| INSPECT-002 | 切换资产时 Inspector 不混态/不空闪 | 待人类验收 | 快速在两项具有不同元数据的资产间切换 | 不出现“连接中/加载中”，也不显示前后资产混合内容 | [0018–0019 QA](0018-0019-ui-correctness-qa-report.md) / [切换 E2E](../../tests/e2e/organization-metadata-persistence.test.ts) | — |
| INSPECT-003 | Inspector 图片等比、宽度优先且无统一外框 | 人类验收通过 | 依次选择横图和竖图观察右侧预览 | 图片完整不拉伸；横图使用可用宽度，竖图受最大高度限制；无包住留白的卡片边框，图片本身有轻微圆角 | [0018–0019 QA](0018-0019-ui-correctness-qa-report.md) / [真实应用截图](evidence/0018-0019-ui-correctness/01-inspector-proportional-preview.png) / [媒体 E2E](../../tests/e2e/media-preview.test.ts) | 2026-07-16 用户先确认预览测试通过，随后明确确认轻圆角没有问题。 |
| INSPECT-004 | Inspector 资产身份信息在分割线上方居中 | 待人类验收 | 选择任意带预览资产，观察右侧预览下方 | 文件名和大小/分辨率/修改日期均随居中的预览居中；分割线以下的状态、标签和元数据仍左对齐 | [0018–0019 QA](0018-0019-ui-correctness-qa-report.md) | 按 2026-07-16 最新反馈完成；用户要求自行查看，不再启动 Computer Use。 |
| THUMB-001 | 支持的图片自动生成缩略图 | 待人类验收 | 导入支持的图片，不点击任何“生成预览”操作 | 缩略图自动出现并成功解码 | [0006 QA](0006-thumbnails-preview-format-decoding-qa-report.md) / [媒体预览 E2E](../../tests/e2e/media-preview.test.ts) | — |
| THUMB-002 | 横图、竖图和方图等比完整显示 | 待人类验收 | 导入横图、竖图和方图并观察资产卡片 | 图片保持比例并完整显示，不裁剪、不拉伸 | [0006 QA](0006-thumbnails-preview-format-decoding-qa-report.md) / [媒体预览 E2E](../../tests/e2e/media-preview.test.ts) | — |

### F. 资产查看页面

| ID | 功能 | 状态 | 人类操作 | 预期结果 | 证据 | 结果/反馈 |
| --- | --- | --- | --- | --- | --- | --- |
| VIEWER-001 | 从深滚动位置双击查看且返回原位置 | 待人类验收 | 在含较多资产的范围向下滚动至少数屏，双击当前可见图片；确认内容后点击返回/关闭查看页面 | 查看页面完整覆盖中央工作区且图片成功显示，不向上或向下错位；返回后仍在原滚动位置，原资产保持可见和选中 | [0013 QA](0013-asset-viewer-navigation-and-gestures-qa-report.md) / [连续浏览 E2E](../../tests/e2e/asset-pagination.test.ts) | 原反馈：双击查看有非常大概率显示错位；P0 修复后重新进入待验收 |

### G. 回收站与重新定位

| ID | 功能 | 状态 | 人类操作 | 预期结果 | 证据 | 结果/反馈 |
| --- | --- | --- | --- | --- | --- | --- |
| TRASH-001 | 托管资产移入回收站 | 待人类验收 | 删除一项或多项托管资产后进入回收站 | 正常视图移除这些资产，回收站中可见 | [0007 QA](0007-trash-relink-batch-relocate-qa-report.md) / [组织与回收站 E2E](../../tests/e2e/organization-search-trash.test.ts) | — |
| TRASH-002 | 从回收站恢复资产 | 待人类验收 | 恢复一项回收站资产 | 资产回到可浏览范围，ID、标签和元数据保持 | [0007 QA](0007-trash-relink-batch-relocate-qa-report.md) | — |
| TRASH-003 | 多选后永久删除并确认数量 | 待人类验收 | 在回收站多选两项，执行永久删除并确认 | 确认框显示准确数量；确认后两项消失 | [0007 QA](0007-trash-relink-batch-relocate-qa-report.md) / [组织与回收站 E2E](../../tests/e2e/organization-search-trash.test.ts) | — |
| RELINK-001 | 批量重新定位预览 | 待人类验收 | 让托管资产 missing，选择候选新根并发起预览 | 只显示相对路径和匹配/缺失数量，不泄露候选根绝对路径 | [0007 QA](0007-trash-relink-batch-relocate-qa-report.md) / [重新定位 E2E](../../tests/e2e/trash-relink-flow.test.ts) | — |
| RELINK-002 | 取消批量重新定位不修改资产 | 待人类验收 | 得到预览后取消 | 资产位置和状态不变 | [0007 QA](0007-trash-relink-batch-relocate-qa-report.md) / [重新定位 E2E](../../tests/e2e/trash-relink-flow.test.ts) | — |
| RELINK-003 | 重新预览后应用批量重新定位 | 待人类验收 | 取消一次预览后，重新选择候选根并应用新预览 | 匹配资产恢复可用，使用的是第二次预览结果 | [0007 QA](0007-trash-relink-batch-relocate-qa-report.md) / [重新定位 E2E](../../tests/e2e/trash-relink-flow.test.ts) | — |

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

### I. 资源库导入导出

| ID | 功能 | 状态 | 人类操作 | 预期结果 | 证据 | 结果/反馈 |
| --- | --- | --- | --- | --- | --- | --- |
| TRANSFER-001 | 文件夹格式导出并重新导入 | 待人类验收 | 导出临时资源库为文件夹，再从导出目录导入副本 | 副本可打开；资产数量一致，抽查文件内容一致；原库不受影响 | [0010 QA](0010-library-import-export-qa-report.md) | — |
| TRANSFER-002 | ZIP 格式导出并重新导入 | 待人类验收 | 导出 ZIP，再导入到新位置 | 新资源库可打开；资产数量一致，抽查文件内容一致 | [0010 QA](0010-library-import-export-qa-report.md) | — |

## 暂不可验收

以下范围已知不满足进入待验收队列的条件；agent 修复并补齐证据后，必须新增独立 ID 或按历史记录重新进入队列：

- 2026-07-16 MVP UI/UX 需求池：0015–0018 未全部完成；`38fa873`、`591f524`、`64521c3`、`197ea9e`、`e2d5d60` 的部分实现已进入当前集成基线，0018 Label 退役/Inspector 标签与 0019 产品正确性已进入实现 `5b8b8fe`。SHELL-001–003、MENU-014、COMMAND-001 已于 2026-07-17 人类验收通过；其余相关条目仍为 TAG-006–008、CANVAS-007–009、INSPECT-001–004、MENU-013、SELECT-007 等。
- 文件夹浏览：画布尚不显示子文件夹卡片、内容封面和统一目录计数；“包含子文件夹资产”尚无正式 UI。
- 文件操作：资产菜单缺默认/其他应用、Finder/Explorer、复制/粘贴、重命名、复制路径等完整命令；文件夹重命名/复制/克隆/移动/删除领域命令尚未实现。
- 框选集合运算：Shift 并集、Command 切换与 Command+Shift 范围追加已有实现；差集/对称差不作为当前额外模式，Windows 真实 Ctrl 仍待平台验证。
- 标签新体验：Inspector chip 已由用户验收，空输入按创建时间提供最近添加且仍在使用的标签；仍未完成的是左侧标签枚举移除、基于实际使用行为的最近时间、标签过滤器和批量可搜索选择器。
- Label 退役：ADR 0022 与预发布迁移策略已确认；数据库 v14、FTS、AI 和一等协议退役已有自动化与真实应用 QA；`META-001`、`SEARCH-002` 保持撤回，因为产品概念本身已删除。
- 中英文、亮/暗/跟随系统主题、统一命令注册表和真实平台快捷键尚未实现。
- 应用壳与发现工具栏：纯色画布与冗余装饰清理已验收；资源库下拉、可点击面包屑、后退/前进、统一目录树已进入 0016-A 待验收；过滤条和导入迁出常驻工具栏仍待后续。
- Computer Use：已对当前 0018–0019 集成候选执行真实应用检查；Inspector 等比轻圆角预览和标签选择器截图见 `evidence/0018-0019-ui-correctness/`。工具栏/导航未按 0016-A 收口仍是下一增量。
- 单项读取失败不阻断整批链接恢复：缺少稳定的人类可制造场景与公共 UI 证据。
- 元数据并发冲突：缺少双客户端并发的人类验收夹具。
- 回收站占用文件的部分成功/跳过：需要稳定制造 `FILE_BUSY` 的平台夹具。
- 导入/导出的进度与取消：自动化已覆盖，但当前 20,000 资产 soak 夹具只存在于 Worker 测试中，没有可由人类独立生成和打开的固定资源库，因此暂不进入人工队列。
- 0013 查看页面完整 UX：深滚动错位已作为 `VIEWER-001` 开放验收；首次 fit、平移、缩放灵敏度、返回语义、范围切换退出和视频播放器体验仍待实施/修复。
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
