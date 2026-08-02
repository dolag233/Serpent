# Windows 主菜单与菜单项拆分开发记录

日期：2026-08-01  
工单：`Serpent-bnah`

## 范围

Windows frameless shell 不显示原生顶部 menu bar，因此原工具栏设置按钮替换为点击打开的「主菜单」。macOS 继续使用原生 menu bar 与原设置入口。

## 信息架构

菜单项由 `src/renderer/main-menu-items.ts` 以纯 builder 统一拆分：

- 文件：导入文件、文件夹和链接文件夹；
- 编辑：撤销、复制/粘贴、选择、反选和清除选择，并显示 Windows 快捷键；
- 资源库：创建、打开、关闭、移除、从硬盘删除以及库导入/导出；
- 窗口：后台任务、诊断日志；不重复承载 Windows 最小化/最大化/关闭控件；
- 关于：分别提供「关于 Serpent」（产品信息、版本与 GitHub 入口）和「开源组件与许可」（依赖组件及许可证说明）。
- 设置：固定为顶层菜单最后一项，直接执行原设置按钮行为，不展开二级菜单；

`src/renderer/MainMenu.tsx` 只负责交互：打开主菜单时仅显示顶层分组，二级菜单只在悬停或键盘进入带子项的分组后出现；设置是直接动作；Escape、外点、焦点恢复和禁用态保持一致。

## 关于信息

新增 `AboutDialog`，以独立的品牌信息卡展示 Serpent 图标、产品说明、版本和 GitHub 入口；新增 `OpenSourceLicensesDialog`，单独展示 Electron/React/SQLite/媒体组件及许可证说明。外部 URL 仍通过现有 preload shell bridge 校验后打开。

## 验证

- `npm run typecheck`
- `npm run lint`
- `npx vitest run tests/unit/main-menu-items.test.ts tests/unit/dialog-escape-stack.test.ts`（2 个文件、12 个测试通过）
- 后台运行 `node scripts/run-e2e.mjs tests/e2e/shell-navigation.test.ts --workers=1`（1 个测试通过），覆盖入口、顶层分组、默认不展开二级菜单、文件/关于分组 hover 展开、两个独立对话框和 Escape 关闭。

2026-08-02 用户已验收通过主菜单点击入口、二级菜单定位/互斥、宽度自适应及三类菜单视觉统一；更大范围的 UI 复用缺口另开 `Serpent-nzxh`，暂不在本工单继续扩展。

## 2026-08-02 反馈修复（Serpent-yne1）

- 主菜单二级面板改为读取当前一级项的实际矩形位置：顶部与触发项对齐，左边缘直接贴合触发项右边缘，不再使用固定顶部或间隙。
- 一级项 hover/focus 到无子菜单项时主动清空 `activeSectionId`，确保前一个二级面板立即卸载，不会残留。
- 新增壳层 E2E 断言覆盖上述位置对齐和互斥行为。
- 设置项移动到顶层菜单末尾；关于界面移除底部操作按钮和分割线，改为版本下方居中的 GitHub 图标入口。
- 二级菜单宽度改为按内容自适应，保留 180px 最小宽度与视口边界，避免短菜单出现大片空白。
- 主菜单入口改为点击打开；入口 hover 不再自动展开，打开后仍可通过 hover 或键盘切换二级菜单。

后续 UI 复用缺口见 [2026-08-02 UI 样式与交互复用审计](2026-08-02-ui-reuse-audit.md)。

验证：`npm run typecheck`、`npm run lint`、`npx vitest run tests/unit/main-menu-items.test.ts`（3 个测试通过），以及后台 `node scripts/run-e2e.mjs tests/e2e/shell-navigation.test.ts --workers=1`（1 个测试通过）。
