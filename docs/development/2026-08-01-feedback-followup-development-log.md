# 2026-08-01 验收反馈跟进开发记录

## 本轮范围

- `Serpent-i1h0`：合集 F2/右键重命名改为与文件夹一致的行内编辑；补齐命令注册表已有快捷键在合集、文件夹、资产菜单中的展示。
- `Serpent-cwor`：硬盘删除执行前关闭查看器，避免 Windows 文件句柄阻塞删除；文件夹树删除增加 Windows 短暂句柄重试，并在删除磁盘目录成功后再删除数据库索引行，避免权限失败留下半删除状态。
- `Serpent-4joy`：右键二级菜单使用共享活动实例，新的 hover 会同步关闭旧实例；标签选择器不再显示返回按钮，Escape 直接关闭整个右键菜单。
- `Serpent-mxxc`：回收站删除成功后记录可撤销的资产集合，通知面板直接显示“撤销删除”；撤销复用现有恢复/冲突处理流程，成功恢复后清除撤销状态；硬盘删除会清除不可用的撤销状态。
- `Serpent-6b3i`：撤回上一轮 Tab 修改，Tab/Shift+Tab 恢复为只移动焦点；Shift+点击恢复基于卡片几何范围的连续选择。瀑布流改为单一 CSS Grid 的行优先布局，避免独立列高度差导致后续卡片在前序卡片上方出现。

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

Windows 真实应用仍需复验：合集 F2/右键重命名的行内输入、所有相关快捷键标签；在设置重新开启“从硬盘删除”确认后分别测试资产、文件夹、混合选择及 Shift+Delete，并确认查看器打开时删除不会报权限错误；删除资产后通知面板应直接提供“撤销删除”，点击后恢复原位置，遇到冲突时进入已有冲突处理；瀑布流多种卡片尺寸/窗口宽度下按视觉从左到右、从上到下检查，并确认 Tab 不改变选择、Shift+点击连续选择。
