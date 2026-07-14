# Serpent 人类功能验收清单

> 状态：持续维护
>
> 首次建立：2026-07-14
>
> 当前功能代码基线：本清单所在提交（清单条目与对应实现同提交；固定提交由 Git 历史确定）
>
> 适用平台：macOS 开发态；Windows 与当前 HEAD 的 packaged app 另列为未验证

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
| META-001 | 编辑和清空资产名称 | 待人类验收 | 设置资产名称并保存，再清空并保存 | 设置值和空值均正确显示，不回弹为旧值 | [0004 QA](0004-tags-collections-metadata-qa-report.md) / [组织持久化 E2E](../../tests/e2e/organization-metadata-persistence.test.ts) | — |
| META-002 | 编辑和清空资产描述 | 待人类验收 | 设置资产描述并保存，再清空并保存 | 设置值和空值均正确显示，不回弹为旧值 | [0004 QA](0004-tags-collections-metadata-qa-report.md) / [组织持久化 E2E](../../tests/e2e/organization-metadata-persistence.test.ts) | — |
| META-003 | 编辑和清空资产评分 | 待人类验收 | 设置非零评分并保存，再清除评分并保存 | 评分可设置为目标值，也可恢复为未评分 | [0004 QA](0004-tags-collections-metadata-qa-report.md) / [组织持久化 E2E](../../tests/e2e/organization-metadata-persistence.test.ts) | — |
| META-004 | 设置和取消喜欢 | 待人类验收 | 将资产标为喜欢，再取消喜欢 | 两种状态均立即正确显示 | [0004 QA](0004-tags-collections-metadata-qa-report.md) / [组织持久化 E2E](../../tests/e2e/organization-metadata-persistence.test.ts) | — |
| META-005 | 编辑和清空源链接 | 待人类验收 | 设置有效来源 URL 并保存，再清空并保存 | URL 可保存也可清空，不残留旧值 | [0004 QA](0004-tags-collections-metadata-qa-report.md) / [组织持久化 E2E](../../tests/e2e/organization-metadata-persistence.test.ts) | — |
| META-006 | 编辑和清空人工色卡 | 待人类验收 | 设置人工色卡并保存，再清空并保存 | 色卡可保存也可清空，不残留旧颜色 | [0004 QA](0004-tags-collections-metadata-qa-report.md) / [组织持久化 E2E](../../tests/e2e/organization-metadata-persistence.test.ts) | — |
| META-007 | 元数据跨完整重启持久化 | 待人类验收 | 保存一组元数据，完全退出 Serpent 后重新启动 | 重启前保存的每个字段值均恢复 | [0004 QA](0004-tags-collections-metadata-qa-report.md) / [组织持久化 E2E](../../tests/e2e/organization-metadata-persistence.test.ts) | — |
| TAG-001 | 创建标签 | 待人类验收 | 新建一个名称唯一的标签 | 新标签立即出现在标签列表 | [0004 QA](0004-tags-collections-metadata-qa-report.md) | — |
| TAG-002 | 重命名标签 | 待人类验收 | 重命名已有标签 | 新名称立即出现，原有资产关联保持 | [0004 QA](0004-tags-collections-metadata-qa-report.md) | — |
| TAG-003 | 删除标签 | 待人类验收 | 删除一个已分配给资产的标签 | 标签及其关联消失，资产本身不被删除 | [0004 QA](0004-tags-collections-metadata-qa-report.md) | — |
| TAG-004 | 给多项资产分配标签 | 待人类验收 | 选中多项资产并分配同一标签 | 所有选中资产都获得标签，计数准确更新 | [0004 QA](0004-tags-collections-metadata-qa-report.md) / [组织 E2E](../../tests/e2e/organization-search-trash.test.ts) | — |
| TAG-005 | 从多项资产移除标签 | 待人类验收 | 选中多项已带同一标签的资产并移除该标签 | 所有选中资产都失去标签，计数准确更新 | [0004 QA](0004-tags-collections-metadata-qa-report.md) / [组织 E2E](../../tests/e2e/organization-search-trash.test.ts) | — |
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
| SEARCH-002 | 按资产名称搜索 | 待人类验收 | 输入只存在于目标资产名称中的关键词 | 只返回名称命中的资产；清空后恢复当前范围 | [0005 QA](0005-search-filter-sort-smart-collections-qa-report.md) / [组织搜索 E2E](../../tests/e2e/organization-search-trash.test.ts) | — |
| SEARCH-003 | 按标签搜索 | 待人类验收 | 输入只存在于目标标签名称中的关键词 | 返回带该标签的资产；清空后恢复当前范围 | [0005 QA](0005-search-filter-sort-smart-collections-qa-report.md) / [组织搜索 E2E](../../tests/e2e/organization-search-trash.test.ts) | — |
| FILTER-001 | 按文件格式过滤 | 待人类验收 | 选择一种已知同时存在和不存在样本的文件格式 | 只显示该格式资产 | [0005 QA](0005-search-filter-sort-smart-collections-qa-report.md) | — |
| FILTER-002 | 按标签过滤 | 待人类验收 | 选择一个只分配给部分资产的标签 | 只显示带该标签的资产 | [0005 QA](0005-search-filter-sort-smart-collections-qa-report.md) | — |
| FILTER-003 | 按评分过滤 | 待人类验收 | 设置一个能排除部分样本的评分条件 | 只显示满足评分条件的资产 | [0005 QA](0005-search-filter-sort-smart-collections-qa-report.md) | — |
| FILTER-004 | 按喜欢状态过滤 | 待人类验收 | 选择“喜欢”过滤 | 只显示标为喜欢的资产 | [0005 QA](0005-search-filter-sort-smart-collections-qa-report.md) | — |
| FILTER-005 | 按来源链接存在性过滤 | 待人类验收 | 选择“有来源链接”过滤 | 只显示设置过来源链接的资产 | [0005 QA](0005-search-filter-sort-smart-collections-qa-report.md) | — |
| FILTER-006 | 按可用性过滤 | 待人类验收 | 准备 available 与 missing 资产后选择其中一种可用性 | 只显示所选可用性状态的资产 | [0005 QA](0005-search-filter-sort-smart-collections-qa-report.md) | — |
| FILTER-007 | 不同过滤字段使用 AND | 待人类验收 | 同时选择一个格式和一个标签条件 | 只显示同时满足格式与标签的资产 | [0005 QA](0005-search-filter-sort-smart-collections-qa-report.md) | — |
| FILTER-008 | 同一过滤字段多值使用 OR | 待人类验收 | 在格式字段同时选择两种格式 | 显示属于任一所选格式的资产，不要求同时满足 | [0005 QA](0005-search-filter-sort-smart-collections-qa-report.md) | — |
| SORT-001 | 按名称排序 | 待人类验收 | 选择名称排序 | 结果按显示名称稳定排列 | [0005 QA](0005-search-filter-sort-smart-collections-qa-report.md) | — |
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
| SELECT-002 | 瀑布流框选和边缘自动滚动 | 待人类验收 | 在瀑布流中拖框并靠近画布边缘继续拖动 | 相交资产被选中，接近边缘时画布自动滚动 | [0014 QA](0014-asset-selection-and-context-actions-qa-report.md) / [框选 E2E](../../tests/e2e/selection-marquee.test.ts) | — |
| SELECT-003 | Shift 连续范围选择 | 待人类验收 | 单击一项，再按住 Shift 单击另一项 | 两项之间的连续范围被选中 | [0014 QA](0014-asset-selection-and-context-actions-qa-report.md) / [框选 E2E](../../tests/e2e/selection-marquee.test.ts) | — |
| SELECT-004 | macOS Command 增减选择 | 待人类验收 | 按住 Command 依次点击未选和已选资产 | 未选资产加入，已选资产移出；其他选择保持 | [0014 QA](0014-asset-selection-and-context-actions-qa-report.md) / [框选 E2E](../../tests/e2e/selection-marquee.test.ts) | — |
| SELECT-005 | Command+Shift 向现有选择追加范围 | 待人类验收 | 已有离散选择时，按 Command+Shift 点击另一项 | 新范围追加到现有选择，不清空原选择 | [0014 QA](0014-asset-selection-and-context-actions-qa-report.md) / [框选 E2E](../../tests/e2e/selection-marquee.test.ts) | — |
| SELECT-006 | Esc 按层级关闭菜单再清空选择 | 待人类验收 | 多选并打开右键菜单，连续按两次 Esc | 第一次只关闭菜单，第二次清空选择 | [0014 QA](0014-asset-selection-and-context-actions-qa-report.md) / [菜单 E2E](../../tests/e2e/context-menu.test.ts) | — |
| MENU-001 | 外部点击关闭资产菜单 | 待人类验收 | 打开资产右键菜单后点击菜单外部 | 菜单可靠关闭 | [0014 QA](0014-asset-selection-and-context-actions-qa-report.md) / [菜单 E2E](../../tests/e2e/context-menu.test.ts) | — |
| MENU-002 | Esc 关闭资产菜单 | 待人类验收 | 打开资产右键菜单后按 Esc | 菜单可靠关闭 | [0014 QA](0014-asset-selection-and-context-actions-qa-report.md) / [菜单 E2E](../../tests/e2e/context-menu.test.ts) | — |
| MENU-003 | 标签使用统一右键菜单 | 待人类验收 | 打开标签右键菜单，将指针移过各菜单项后按 Esc | 菜单项可获得悬停反馈，Esc 能关闭，不出现重复菜单 | [0014 QA](0014-asset-selection-and-context-actions-qa-report.md) / [菜单 E2E](../../tests/e2e/context-menu.test.ts) | — |
| MENU-004 | 合集使用统一右键菜单 | 待人类验收 | 打开合集右键菜单，将指针移过各菜单项后按 Esc | 菜单项可获得悬停反馈，Esc 能关闭，不出现重复菜单 | [0014 QA](0014-asset-selection-and-context-actions-qa-report.md) / [菜单 E2E](../../tests/e2e/context-menu.test.ts) | — |
| MENU-005 | 智能合集使用统一右键菜单 | 待人类验收 | 打开智能合集右键菜单，将指针移过各菜单项后按 Esc | 菜单项可获得悬停反馈，Esc 能关闭，不出现重复菜单 | [0014 QA](0014-asset-selection-and-context-actions-qa-report.md) / [菜单 E2E](../../tests/e2e/context-menu.test.ts) | — |
| MENU-006 | 滚动画布时关闭菜单 | 待人类验收 | 打开菜单后滚动画布 | 菜单关闭，不残留悬浮层 | [0014 QA](0014-asset-selection-and-context-actions-qa-report.md) / [菜单 E2E](../../tests/e2e/context-menu.test.ts) | — |
| MENU-007 | 调整窗口尺寸时关闭菜单 | 待人类验收 | 打开菜单后调整窗口尺寸 | 菜单关闭，不停留在旧位置 | [0014 QA](0014-asset-selection-and-context-actions-qa-report.md) / [菜单 E2E](../../tests/e2e/context-menu.test.ts) | — |
| MENU-008 | 应用失焦时关闭菜单 | 待人类验收 | 打开菜单后切换到其他应用 | 菜单关闭，切回时不残留 | [0014 QA](0014-asset-selection-and-context-actions-qa-report.md) / [菜单 E2E](../../tests/e2e/context-menu.test.ts) | — |
| MENU-009 | 菜单保持窗口内 | 待人类验收 | 分别在窗口四角打开右键菜单 | 菜单自动调整位置，不越出窗口 | [0014 QA](0014-asset-selection-and-context-actions-qa-report.md) / [菜单 E2E](../../tests/e2e/context-menu.test.ts) | — |
| MENU-010 | 同时只显示一个右键菜单 | 待人类验收 | 连续对不同对象打开右键菜单 | 新菜单出现时旧菜单关闭，页面上只有一个菜单 | [0014 QA](0014-asset-selection-and-context-actions-qa-report.md) / [菜单 E2E](../../tests/e2e/context-menu.test.ts) | — |

### I. 资源库导入导出

| ID | 功能 | 状态 | 人类操作 | 预期结果 | 证据 | 结果/反馈 |
| --- | --- | --- | --- | --- | --- | --- |
| TRANSFER-001 | 文件夹格式导出并重新导入 | 待人类验收 | 导出临时资源库为文件夹，再从导出目录导入副本 | 副本可打开；资产数量一致，抽查文件内容一致；原库不受影响 | [0010 QA](0010-library-import-export-qa-report.md) | — |
| TRANSFER-002 | ZIP 格式导出并重新导入 | 待人类验收 | 导出 ZIP，再导入到新位置 | 新资源库可打开；资产数量一致，抽查文件内容一致 | [0010 QA](0010-library-import-export-qa-report.md) | — |

## 暂不可验收

以下范围已知不满足进入待验收队列的条件；agent 修复并补齐证据后，必须新增独立 ID 或按历史记录重新进入队列：

- 单项读取失败不阻断整批链接恢复：缺少稳定的人类可制造场景与公共 UI 证据。
- 元数据并发冲突：缺少双客户端并发的人类验收夹具。
- 回收站占用文件的部分成功/跳过：需要稳定制造 `FILE_BUSY` 的平台夹具。
- 导入/导出的进度与取消：自动化已覆盖，但当前 20,000 资产 soak 夹具只存在于 Worker 测试中，没有可由人类独立生成和打开的固定资源库，因此暂不进入人工队列。
- 0013 查看页面完整 UX：深滚动错位已作为 `VIEWER-001` 开放验收；首次 fit、平移、缩放灵敏度、返回语义、范围切换退出和视频播放器体验仍待实施/修复。
- 0014 完整批量上下文操作：顶部批量条尚未移除，右键菜单仍只携带单个资产 ID，批量标签/合集/移动/删除和视觉打磨未完成。
- 0007 重新定位崩溃恢复：`crash-relink-*` failpoint 尚未接入执行路径，也没有真实崩溃重启回归；不能按旧 QA 文档宣称已覆盖。
- 0005 当前 HEAD packaged 搜索与智能合集：正式媒体二进制 bundle 尚未发布，当前代码无法完成新包验收；新增 packaged 测试也未覆盖智能合集。
- 0006 发布包媒体能力：不可变 FFmpeg/OIIO 发布来源、receipt、packaged playback 与 Windows 验证仍是发布阻断。
- 0008 浏览器扩展真实 Chrome/Edge 往返、packaged 和 Windows 行为。
- 0009 完整 AI 用户旅程：范围分析/清空入口、密钥边界决定和真实供应商验证。
- 0010 完整迁移一致性：元数据、标签、合集、revision、垃圾箱等全量一致性尚未进入人类清单；macOS packaged、Windows↔macOS、长路径/非 ASCII 也未验证。
- 0011 CLI：已排入 v0.2.0，尚未实现。
- Windows 平台整体：当前没有真实 runner；Windows Ctrl 多选、long path、文件占用、系统回收站和打包都不能用 macOS 结果替代。

## 人类验收记录

用户每次给出结论时，在这里追加一条，不覆盖历史：

| 日期 | ID | 结论 | 用户原始反馈摘要 | 后续动作 |
| --- | --- | --- | --- | --- |
| — | — | — | — | — |
