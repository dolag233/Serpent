# 标签过滤与长名称显示

工单：Serpent-8u6tv。用户要求 Ctrl+单击应用标签过滤，并报告标签显示长度受限。

根因：新增标签选择时，所有 label 点击都交给选择回调，覆盖原先的修饰键过滤。名称继承全局 `.tag-chip-name` 的 120px 上限与裁剪；标签数量本身没有 slice 上限。

处理：复用平台修饰键工具，Ctrl（Windows）/Command（macOS）无 Shift 单击优先调用既有过滤回调，不再同时触发选择。Shift 及 Ctrl/Command+Shift 继续范围选择，框选不变。普通与编辑模式采用相同规则。旧单测将 Ctrl 单击选中视为预期，本次按最新产品要求更新。

Inspector 范围内取消名称宽度上限和省略号；标签本体限制面板宽度，长中英文可换行，AI 标识不压缩。其他标签组件不受影响，沿用现有主题与圆角样式。

| 需求 | 实现 | 自动化 | 人工证据 |
| --- | --- | --- | --- |
| 修饰键单击过滤 | InspectorTagChip.tsx 点击分支 | inspector-tag-chip.test.tsx：Ctrl、Command、Shift、普通/编辑模式及菜单/键盘 | 待用户验收 |
| 完整名称且不溢出 | styles.css Inspector 标签规则 | 后台 Edge 加载当前完整 CSS，260px 面板中中文换两行、连续英文换三行，无水平溢出或省略号 | 待用户验收 |

验证命令：`npx vitest run tests/unit/inspector-tag-chip.test.tsx tests/unit/inspector-tag-clipboard.test.tsx tests/unit/inspector-tag-grid.test.tsx`，3 files / 10 passed。相关 TSX ESLint 与 git diff --check 通过。首次布局检查误将可单行容纳的中文视为必须换行；延长合成名称后确认按实际可用宽度换行，不是实现失败。

仅修改 Renderer，未运行后端、资源库或全量测试。后台浏览器使用内存合成标签，不写截图/数据库/媒体。真实应用、macOS 与 packaged 未执行。

## 用户验收反馈与清除条件修复

用户已确认长名称显示通过，但过滤条件右侧关闭按钮无效。定位到表达式条件描述使用 `tag-expression`，清除分支及文案映射只处理 `tag`；条件点击处的类型强制转换隐藏了协议不一致。

统一使用已有 `tag` 维度编号，ActiveFilterChip.id 收紧为 ClearableFilterId（不含 all），移除点击处强制转换，条件标签恢复本地化文案。单项清除和全部清除复用 clearTagDiscoveryFilter，同时清空当前表达式、上次合法表达式、旧选择/排除状态与 activeTagId。表达式模式不再显示旧排除列表的残留条件。

回归：`npx vitest run tests/unit/dimension-filter-bar.test.tsx tests/unit/active-discovery-filters.test.ts`，2 files / 11 passed。新增界面测试直接点击关闭图标，经过生产清除函数验证条件消失、旧状态归零且评分条件保留；既有空表达式用例增加旧排除条件。相关模块 ESLint 与 diff 检查通过。长名称单独记录 TAG-LENGTH-021 为人类验收通过，TAG-FILTER-020 为本轮不通过、修复待复验。

类型检查 npm run typecheck 通过；App ESLint 无错误，保留原有两项 hooks 警告。同步更新已有标签剪贴板 Electron 脚本：Ctrl/Command 单击取消选择改为修饰键拖框取消选择，匹配最新交互。该 E2E 本轮未执行，仅执行直接相关 Renderer 测试。

## 菜单文案与鼠标快捷操作提示

用户确认前轮清除修复通过，新增要求菜单文案为「应用标签过滤」，右侧显示 Ctrl 加鼠标左键图标（macOS 使用 Command）。复用 ContextMenuItem 的快捷键栏，shortcut 类型扩展为 ReactNode 以兼容既有字符串与图形提示；沿用 Icon 体系新增左键填充的鼠标轮廓，使用 currentColor。图形提示提供本地化可访问名称；英文文案为 Apply tag filter。

定向 `npx vitest run tests/unit/inspector-tag-chip.test.tsx tests/unit/context-menu.test.ts`，2 files / 7 passed，覆盖双平台修饰键提示、SVG 图标与菜单动作。首次新增菜单断言失败是 macOS 测试宿主未挂入 document.body，修正测试挂载后通过。相关 ESLint 无错误。TAG-FILTER-020 更新为人类验收通过，TAG-FILTER-HINT-022 为待验收。

最终 npm run typecheck 通过。用户确认菜单提示可用，授权提交推送；TAG-FILTER-HINT-022 更新为人类验收通过，Serpent-8u6tv 关闭。
