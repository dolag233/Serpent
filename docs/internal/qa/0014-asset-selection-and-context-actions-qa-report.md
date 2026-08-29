# 切片 0014 QA 报告：资产选择与上下文操作

> 状态：macOS 开发态有条件通过；可进入人类功能验收
>
> Build under test：`f1330a7`
>
> 日期：2026-07-16
>
> 后续产品反馈：普通框选和点击修饰键证据仍有效，但修饰键框选尚未实现；左侧标签菜单已撤回，资产/文件夹完整文件菜单与单一高亮也待实施。准确待办与人类验收状态分别见 `../implementation/mvp-ui-ux-requirements-backlog.md` 和 `human-acceptance-checklist.md`。

## 自动化证据

| 门禁 | 结果 |
| --- | --- |
| lint | 通过 |
| typecheck | 通过 |
| relink crash-recovery Worker | 11/11 |
| 选择/菜单/移动/链接/回收站定向 Electron E2E | 26/26 |
| 最近完整主线检查点 | 885 passed、1 skipped；search perf 4/4；Electron E2E 44/44 |
| 最后一组动作迁移后的 `verify:mainline` | 未完成；执行时被用户中断，不写成通过 |
| macOS packaged | 未执行 |
| Windows | 未执行 |

## 已验证行为

- 平铺与瀑布流框选。
- 瀑布流自动滚动跨多屏后首项、末项与沿途资产同时保持选择。
- Shift、Command/Ctrl、Command/Ctrl+Shift、Esc 分层语义。
- 菜单外点、Esc、滚动、resize、失焦和范围切换关闭。
- 单选与多选的可见数量标题。
- managed / linked / missing 混选的处理数、跳过数和原因。
- 标签、合集、移动、回收站、复制等动作使用固定 descriptor 快照。
- 单选托管移动、回收站；链接删除；missing 找回；回收站恢复和永久删除。
- 多选后顶部不存在选择动作，相关入口均在右键菜单。
- 核心预览回归仍验证实际图片解码，不仅检查 DOM。

## Computer Use 与截图

真实 Serpent 开发态、隔离的 31 项图片资源库：

1. 进入资源库，31 项缩略图可见且实际解码。
2. 全选后发现顶部仍残留移动/删除，产品判定不通过。
3. 修复并重启应用后，全选不再改变顶部工具栏；右键菜单通过 AX 树显示“已选择 31 项”、移动、回收站和清除选择。
4. 单资产右键菜单显示“已选择 1 项”；AI 未配置时显示具体禁用原因。

证据：

- [进入态](evidence/0014-selection-context/01-library-entry.png)
- [发现的顶部动作缺陷](evidence/0014-selection-context/02-all-selected-defect.png)
- [修复后的多选界面](evidence/0014-selection-context/03-all-selected-fixed.png)

## 平台与边界

- macOS 开发态：有条件通过，可交给用户逐项验收。
- macOS packaged：未执行。
- Windows：未执行；Ctrl/Ctrl+Shift、Delete、右键、长路径、系统回收站和占用文件不能由 macOS 结果替代。
- Electron E2E 当前会显示真实窗口；后续应增加隐藏窗口模式，并把全量 UI 回归集中到切片收口阶段。

## 结论

0014 的功能性阻断已关闭，允许进入人类验收清单。发布级结论仍受最终集中 `verify:mainline`、packaged 与 Windows 证据约束。
