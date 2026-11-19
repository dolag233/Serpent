# 回车快速查看

工单 `Serpent-b0db8e`。基线 `b9ca4bd0`，在 `dolag_dev` 工作区实现。

| 需求 | 实现位置 | 自动化证据 | 人工与平台证据 |
| --- | --- | --- | --- |
| 从浏览界面按回车打开，另一次回车退出并恢复浏览 | `src/renderer/App.tsx:12796` 的查看器快捷键分支和现有关闭流程 | `tests/e2e/browse-feedback.test.ts:218`，打开后检查图片实际解码，长按不关闭，独立回车关闭后原目录和选中资产恢复 | Windows 后台 Electron 通过，待用户验收 |
| 仅回车打开的会话支持回车退出 | `src/renderer/App.tsx:4424` 记录打开方式，关闭清空；同一查看会话内切换资产保留打开方式 | 同一用例验证双击与空格打开后回车不关闭，Esc 仍能关闭 | macOS 与发布包未执行 |

复用查看器的关闭请求，以保留文本编辑保存确认和既有滚动恢复。回车关闭避开输入法、编辑控件和可通过回车激活的按钮。主代理按 Standards 与 Spec 核对了入口、会话重置和关闭行为。

Windows 后台命令 `node scripts/run-e2e.mjs tests/e2e/browse-feedback.test.ts -g 'Enter closes only' --trace off` 从当前代码构建，1 项通过（24.9 秒）。

用户确认快捷键验收通过，另报返回浏览时画面轻微偏移，拆为 `Serpent-72a636`。复现用例在正常浏览时捕获滚动位置和卡片坐标，打开并读取真实文本预览，再回车关闭。修复前，纵向滚动值从 3784 变为 3701，原卡片的屏幕坐标从 310 变为 393，两处差值对应恢复阶段浮层画布与正常浏览画布的原点差。关闭查看器后先让画布宿主参与正常 flex 布局，再运行恢复，保留现有首次可见门禁、锚点及后退和标签页的恢复逻辑。

`src/renderer/styles.css:10768` 的宿主仅在查看器实际打开时脱离 flex 布局。后台 Electron 用例 `tests/e2e/workspace-scroll-restore.test.ts:179` 对前后 `scrollTop`、`scrollLeft` 和卡片屏幕坐标做严格相等断言，独立运行 1 项通过（32.7 秒）。同一构建的快速查看回归通过。`npx vitest run --config vitest.config.ts tests/unit/view-restore.test.ts tests/unit/browse-view-restore-scheduler.test.ts tests/unit/preview-return-interruption.test.ts` 共 17 项通过。`VIEWER-RETURN-051` 待用户验收。

既有后退及切标签页旅程在普通隐藏窗口的目录导航等待超时，使用同一构建及 `SERPENT_E2E_PERF_OFFSCREEN=1` 限定后台渲染后单独运行，1 项通过（17.5 秒）。两种模式分别记录。定向 ESLint 和差异检查通过。

用户已确认返回位置修复通过，关闭 `Serpent-72a636`。提交前重新运行恢复相关单测，17 项通过。
