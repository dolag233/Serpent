# 查看器返回浏览画布的首帧恢复（2026-11-07）

工单 `Serpent-940c54`。用户在浏览画布底部打开资产查看器后返回，画布会空白约一秒。

## 原因与改动

关闭查看器时，原实现先排队卸载查看器，再在卸载前的布局上启动按帧滚动恢复。恢复期间整个画布被隐藏，直到滚动范围容纳旧位置且连续两帧稳定；底部布局若略微变短，旧 `scrollTop` 根本无法达到，最多等 120 帧才露出画布。隐藏 Electron 的动画帧调度会放大等待时间。

现在先同步提交查看器卸载，再在已经更新的画布几何上立即恢复滚动。捕获打开前的最大滚动范围，以区分「新的底部略短」和「虚拟画布尚未展开」；达到可用位置就先显示画布，原有两帧稳定检查仍在后台结束。用户在显示后继续滚动时，恢复任务停止，不再把位置写回去。

## 四列追溯

| 需求 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 返回底部时尽快显示浏览画布 | `src/renderer/App.tsx`、`src/renderer/browse-view-restore-scheduler.ts`、`src/renderer/styles.css` | `tests/unit/browse-view-restore-scheduler.test.ts`；`tests/e2e/viewer-close-scroll-restore.test.ts` | 隐藏 Electron 合成资源库底部路径：Esc 键处理约 68 ms，之后画布可见约 5 ms；真实前台待用户验收 |
| 保持底部位置和返回后的用户滚动 | `src/renderer/view-restore.ts`、`src/renderer/browse-view-restore-scheduler.ts` | `tests/unit/view-restore.test.ts`、`tests/unit/browse-view-restore-scheduler.test.ts`、同一 Electron E2E 的 Esc/后退与后续滚动断言 | 隐藏 Electron E2E 1 passed；真实大库与前台未验证 |

## 当次验证

- `npx vitest run tests/unit/browse-view-restore-scheduler.test.ts tests/unit/view-restore.test.ts`：2 files，13 tests passed。
- `SERPENT_E2E_HIDE_WINDOW=1 node scripts/run-e2e.mjs tests/e2e/viewer-close-scroll-restore.test.ts`：1 passed。先前迭代在同一合成底部路径测得总返回约 1916 ms；最终运行测得 Esc 键处理 68 ms、键处理后显示 5 ms。该数据只代表隔离隐藏 Electron 与合成文本资产，不代表真实大库的绝对耗时。
- `npm run typecheck`、定向 ESLint：通过；ESLint 在 `App.tsx` 报两条本次未引入的 Hook 依赖警告。

前台 Computer Use 按用户此前选择未执行。人类验收状态保持「待验收」，需要从真实浏览画布底部打开图片或视频、按 Esc 和后退分别返回，观察是否有空白或跳顶。
