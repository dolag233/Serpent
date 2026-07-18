# 2026-07-18 已关闭工单集中验收与收尾

## 范围

- 基线：当前 `codex/slice-002-asset-ingestion` 工作树；Computer Use 确认 Renderer URL 为 `localhost:5173/`，旧 `out/Serpent-darwin-arm64` 未作为证据。
- 工单：审计所有关闭理由含“待人类验收/未验证”的 beads，以及人类验收清单仍待验收的对应增量。
- 约束：Computer Use 只执行浏览、选择、排序、视图切换和查看，不在用户资源库执行删除、移动或元数据写入；验收后恢复原瀑布流、相关性升序和侧栏展开偏好。

## 自动化证据

| 门禁 | 结果 | 说明 |
| --- | --- | --- |
| `npm run lint` | 通过（0 error，17 个既有 hook dependency warning） | 本轮修复 `NavigationSidebar` effect 内同步状态更新与退役 palette 参数残留。 |
| `npm run typecheck` | 通过 | Renderer/Main/Worker/extension 类型检查通过。 |
| `npm run test` | 通过 | 116 files；1427 passed，1 skipped。 |
| Electron E2E profile 隔离 | 通过 | 所有 39 个独立 Electron launch 均显式传入测试拥有并清理的临时 `SERPENT_E2E_USER_DATA_PATH`。 |
| `npm run test:perf:search` | 通过 | 4/4。 |
| `npm run test:e2e` | 通过 | 63/63；真实 Electron 串行运行。 |
| E2E 前台干扰 | 未解决，已独立开单 | `showInactive` 实验导致键盘/焦点旅程稳定失败，已撤回；`Serpent-a1b` 跟踪独立会话/虚拟显示方案，不以隐藏窗口削弱真实测试。 |

最终 `npm run verify:mainline` 于 2026-07-19 00:58–01:03（Asia/Shanghai）在当前收尾工作树完整通过：lint 0 error / 17 个已开单 warning，typecheck 通过，extension verify 通过，116 个 Vitest 文件中 1427 passed / 1 skipped，搜索性能 4/4，Electron E2E 63/63（3.1 分钟）。此前两轮在审查发现新的查看页恢复竞态后由主 agent 主动中断，不作为通过证据；一次导入 E2E 暴露关闭事件与 Worker 清理的等待竞态，修正 helper 等待完整关闭后定向 3/3 与最终 63/63 均通过。

## Computer Use 证据（当前源码实例）

2026-07-18 22:55–23:05（Asia/Shanghai）使用真实 Electron 窗口并截图检查。截图仅包含资产文件名与应用 UI，不包含本地绝对路径：

- [壳层与浏览布局](evidence/2026-07-18-closed-beads/01-shell-layout.jpg)
- [查看页完整适配](evidence/2026-07-18-closed-beads/02-viewer-fit.jpg)
- [平铺 justified 布局](evidence/2026-07-18-closed-beads/03-justified-layout.jpg)
- [原生双击进入查看页](evidence/2026-07-18-closed-beads/04-native-double-click-viewer.jpg)

| 清单 ID | 结论 | 观察证据 |
| --- | --- | --- |
| SHELL-014 | 通过 | 左折叠按钮位于后退/前进之前；折叠后出现边缘展开按钮；恢复成功。 |
| SHELL-020 | 通过 | 顶栏、范围标题与数量、浏览栏、过滤维度的文字/图标中线一致。 |
| SORT-005 | 通过 | 排序为过滤条右侧一等控件；选择“分辨率”后网格重排，升降序再次反向重排。 |
| CANVAS-010（justified） | 通过 | 平铺中横竖素材保比例、等行高并横向填满；卡片显示 `宽 × 高`。 |
| META-010 | 通过 | 真实 GIF 网格显示 `0:04 GIF`，Inspector 显示 `0:04 · 86 帧`。 |
| VIEWER-008 | 通过 | Computer Use 以原生 `click_count: 2` 双击图片成功进入查看页；右键菜单“打开”分组首项“查看”、Enter、左右键和 Esc 也均有效。 |
| SHELL-017 | 不通过（既有结论复现） | 排序菜单仍显示“相关性（默认）”；由 `Serpent-d45` 继续跟踪。 |
| CANVAS-012 | 不通过（既有结论保持） | 类型/时长功能存在，但亮色角标对比度仍由 `Serpent-yu8` 修复，不拆成假通过。 |

## Beads 状态校正

- `Serpent-c1p` → superseded by `Serpent-d45`：括注文案验收失败。
- `Serpent-4gk` → superseded by `Serpent-bhv`：侧栏隐藏缺少双向死区段落感。
- `Serpent-2j9` → superseded by `Serpent-60k`：MP4 空格/进度能力验收失败。
- `Serpent-lrt` → superseded by `Serpent-yu8`：亮色角标对比度验收失败。
- `Serpent-6s1` 标记为部分交付：META-010 已通过；VIEW-010 已由产品撤回，不算成功功能。

## 交叉审查与后续工单

本轮完成 Standards、Spec、验收状态审计，以及 regression/dead-code、a11y/CSS/i18n、security/test-isolation 三组广度审查。当前运行环境没有 Sonnet/Haiku 或 Luna 调度入口，使用可用的轻量审查 agent 替代并明确保留模型门禁差异。

- `Serpent-vvn`：查看页、菜单、listbox、combobox 与模态框键盘焦点模型。
- `Serpent-uye`：拆分约 7030 行的 `App.tsx` 交互状态。
- `Serpent-1pd`：外部 URL / active-context IPC 公开错误码与结构化日志。
- `Serpent-zhh`：清零 17 个 React hook dependency warning，防止语言/选中资产陈旧闭包。
- `Serpent-a1b`：让 Electron E2E 在不破坏键盘/焦点真实性的隔离会话运行。

仍保留待验收：SYNC-001/002/003、SELECT-009/010、MENU-022/023、SMART-001/006、DND-005、SEARCH-006、SHELL-019 等需要隔离写入旅程或本轮未完整覆盖的项目；关闭工单不等于这些条目已经通过。
