# 2026-08-01 反馈收口开发记录

## 范围

本轮只处理 2026-08-01 验收反馈中可直接落地的合集、删除、标签菜单、通知按钮和瀑布流选择交互。合集资产“跳转到文件夹”保留在 `Serpent-udj5`，等待来源文件 focus 分支合流。

## 实现摘要

- 合集创建输入行使用 layout focus + 下一帧重试，并延迟 blur 提交，避免创建菜单关闭/行插入竞态夺走输入焦点。
- 合集侧栏行暴露独立焦点标记，F2 重命名、Delete 删除；空合集直接删除，包含资产或子合集时由界面确认。
- 文件夹 Delete 对齐空/非空确认语义；文件夹补齐 Windows `Shift+Delete` 与 macOS `⌥⌘Delete` 的从硬盘删除快捷键。
- 添加标签改为 hover 打开可搜索二级菜单，并用实际菜单尺寸做 viewport clamp/flip；Enter/Space 仍可打开子菜单。
- 通知撤销按钮收敛到通知条的尺寸、间距、边框、hover/focus token。
- 瀑布流 Tab/Shift+Tab 替换为单项选择；Shift 点击按视觉顺序连续范围选择，不再按中心点矩形模拟。
- 文件夹卡片外框、前后层圆角共享同一尺寸 token。

## 验证

- `npx eslint`（涉及的 TS/TSX 文件）：通过。
- `npm run typecheck`：通过。
- `npx vitest run tests/unit/sidebar-commands.test.ts tests/unit/folder-shortcut-dispatch.test.ts tests/unit/asset-grid-layout.test.ts`：63/63 通过。
- `node scripts/run-e2e.mjs tests/e2e/context-menu.test.ts --grep "tag picker searches" --workers=1`：通过。
- `node scripts/run-e2e.mjs tests/e2e/selection-marquee.test.ts --grep "masonry Tab" --workers=1`：通过。
- `node scripts/run-e2e.mjs tests/e2e/organization-search-trash.test.ts --grep "collection recursion toggle" --workers=1`：通过（包含合集创建输入框聚焦断言）。

这些是自动化/开发态证据，不替代 Windows 真实应用和产品负责人最终人类验收；对应清单条目仍保持“人类验收不通过/待复验”。
