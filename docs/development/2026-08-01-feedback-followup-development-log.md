# 2026-08-01 验收反馈跟进开发记录

## 本轮范围

- `Serpent-i1h0`：合集 F2/右键重命名改为与文件夹一致的行内编辑；补齐命令注册表已有快捷键在合集、文件夹、资产菜单中的展示。
- `Serpent-cwor`：用户 2026-08-01 验收通过资产与含资产文件夹的 Windows 硬盘删除；删除前释放卡片/查看器媒体、Worker 取消并等待目标资产媒体任务，以及异步退避重试路径均通过。
- `Serpent-4joy`：右键二级菜单使用共享活动实例，新的 hover 会同步关闭旧实例；标签选择器不再显示返回按钮，Escape 直接关闭整个右键菜单。
- `Serpent-mxxc`：回收站删除成功后记录可撤销的资产集合，通知面板使用无边框回撤图标（可访问名称为“撤销”）；撤销复用现有恢复/冲突处理流程，成功恢复后按当前浏览范围刷新视图并清除撤销状态；硬盘删除会清除不可用的撤销状态。用户已验收通过。
- `Serpent-6b3i`：撤回上一轮 Tab 修改，Tab/Shift+Tab 恢复为只移动焦点；Shift+点击恢复基于卡片几何范围的连续选择。用户明确拒绝 CSS Grid 重做布局，本轮用 `git diff` 恢复原有显式瀑布流列分配和自然高度估算，用户已验收通过。

## 验证

- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npx vitest run tests/unit/sidebar-commands.test.ts tests/unit/asset-commands.test.ts tests/unit/asset-action-keyboard.test.ts`：101 项通过。
- `npx vitest run tests/worker/folder-delete.test.ts`：未执行到用例断言；当前工作区 `better-sqlite3` 为 Node ABI 148，而测试 Node 要求 ABI 137，12 项均在加载数据库时阻断，非本次代码失败。
- `node scripts/run-e2e.mjs tests/e2e/context-menu.test.ts --grep "tag picker searches" --workers=1`：通过（1 项）。
- `npx vitest run tests/unit/toast-notifications.test.ts tests/unit/asset-action-keyboard.test.ts tests/unit/sidebar-commands.test.ts tests/unit/asset-commands.test.ts`：118 项通过。
- `npx vitest run tests/unit/asset-grid-layout.test.ts tests/unit/selection-anchor.test.ts tests/unit/toast-notifications.test.ts tests/unit/sidebar-commands.test.ts tests/unit/asset-commands.test.ts tests/unit/asset-action-keyboard.test.ts`：134 项通过。
- `node scripts/run-e2e.mjs tests/e2e/selection-marquee.test.ts --grep "masonry Tab" --workers=1`：通过（1 项；验证 Tab/Shift+Tab 焦点顺序，不改变选中状态）。

## 人工复验

 Windows 真实应用仍需复验：合集 F2/右键重命名的行内输入、所有相关快捷键标签。

## 2026-08-01 复验纠正

用户明确指出上一版反馈记录存在两处误读：硬盘删除问题不是“只需关闭查看器并重试”，而是资产和含资产文件夹均高概率收到权限错误；瀑布流也不能改成 CSS Grid。当前修复因此拆成两层：Renderer 在硬盘删除前清掉选中/悬停/查看器媒体并等待卸载，Worker 取消并等待目标资产的缩略图/代理生成任务；布局代码恢复到 `d2774f9^` 的 `distributeMasonryItems` 显式列布局。2026-08-01 用户已验收硬盘删除/媒体句柄、瀑布流恢复与通知撤回图标。

本轮追加检查：`npm run typecheck`、`npm run lint` 通过；`npx vitest run tests/unit/asset-grid-layout.test.ts tests/unit/selection-anchor.test.ts tests/unit/toast-notifications.test.ts tests/unit/asset-action-keyboard.test.ts` 为 36/36 通过；`node scripts/run-e2e.mjs tests/e2e/selection-marquee.test.ts --grep "masonry Tab" --workers=1` 为 1/1 通过。`npx vitest run tests/worker/folder-delete.test.ts` 仍在 better-sqlite3 Node ABI 148/137 不匹配处阻断，不能作为 Worker 删除路径通过证据。
