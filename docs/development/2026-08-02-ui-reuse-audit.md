# UI 样式与交互复用审计

日期：2026-08-02  
范围：Windows 主菜单、右键菜单、资源库菜单及 renderer 中的相关浮层  
来源：两次独立 luna 只读审计（未直接修改代码）

## 本次已收口（Serpent-yne1）

主菜单、资产右键菜单、资源库菜单已统一使用菜单 token：

- surface 背景、边框、圆角和阴影；
- 菜单项字体、行高、间距和最小高度；
- pointer hover 高亮（亮色主题使用一致的较深 `--hover`）；
- keyboard focus、禁用透明度和危险项颜色。

## 后续复用缺口

按优先级记录，暂不扩大 `Serpent-yne1` 的实现范围：

### P1

- 主菜单与右键菜单仍各自维护浮动子菜单定位、viewport 翻转/夹紧和 submenu owner 关闭控制；应抽共享的 floating-menu position/controller。
- WorkspaceToolsOverflow 与上述菜单重复定义 surface；应迁移到同一 `menu-surface` 基类。
- 主菜单、右键菜单、资源库菜单仍各自维护键盘 roving 逻辑，应统一键盘导航 contract。

### P2

- 标签/合集/色彩空间 picker 的 option 样式与右键菜单条目重复但字号、圆角、active token 不一致。
- 维度过滤、排序、AI 模型 picker、标签建议等 popover 重复定义 surface/padding/shadow，应区分并统一 popup/menu token。
- 冲突对话框未完整复用 `create-dialog` surface；按钮层的 compact/tool/history variants 需要共享 control token。

### P3

- workspace notice、toast、activity strip 三套通知浮层的圆角、阴影和 action 样式可进一步收敛。
- 增加跨菜单视觉 contract 测试，覆盖 computed background、font、padding、radius 及子菜单定位。

这份审计只记录后续规范化路线；后续工单应逐项认领，避免把大规模样式重构混入单个交互修复。
