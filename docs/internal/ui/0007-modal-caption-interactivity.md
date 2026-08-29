# 0007 — 模态蒙层与窗口控制按钮（Modal Chrome Interactivity）

> 状态：生效（Serpent-52a9b4，2026-08-27）
> 范围：所有「模糊背景模态面板」的全窗口交互规范。

## 背景

创建/关联资源库等模态面板打开时，窗口的「缩小 / 最大化 / 关闭」按钮曾因模糊蒙层
（`dialog-backdrop`，全窗 `inset: 0`）覆盖而无法点击，用户只能强退。该问题出现在
所有带模糊 scrim 的模态面板上（创建资源库、导入、移动、合集编辑、关于、设置等
30+ 组件），属于 UI 规范化的一部分。

## 规范（强制）

1. **任何模态面板打开时，窗口控制按钮必须保持可点击**（缩小/最大化/关闭；
   macOS 为原生红绿灯）。模态面板不得使窗口陷入不可关闭状态。
2. 模态面板统一复用 `dialog-backdrop`（全窗 scrim + `serpent-modal-open` 冻结
   shell），并由 App 的 `dialogFocusTrapActive` 汇集状态触发。**新增模态面板不得
   另造蒙层类**；确有特殊需要时也必须复用同一切口。
3. 图层（`ui/tokens.css` 命名图层，禁止组件发明数字）：
   ```text
   base 0 → shell 100 → … → modal-backdrop 700
   → window-caption 701（窗口控制按钮，必须用 --ui-layer-window-caption）
   → modal 800（模态内容）→ tooltip 900
   ```
4. 窗口控制按钮组件（Windows `WindowsWindowControls` 等）是**窗口级层**：
   `createPortal` 到 `document.body`（与 `PortaledPopover` 同为逃逸 shell
   stacking context 的既有模式）、`position: fixed`、引用
   `--ui-layer-window-caption`。**禁止**把按钮挂进 `.app-shell` 等
   `isolation: isolate` 的容器——子元素 z-index 只在其内部比较，永远赢不了
   蒙层（Serpent-52a9b4 第一次修复即因此失败）。
5. 验收必须用真实命中/点击证据（如 `document.elementFromPoint`、Playwright
   actionability），**不得**只断言 computedStyle 的 z-index/pointer-events。
6. **平台差异**：Windows 无边框窗由 renderer 自绘 caption（受本规范约束）；
   macOS `hiddenInset` 使用系统原生红绿灯（绘制在 web content 之上，天然不受
   蒙层影响，无需代码）；涉及平台分支时两个平台都必须验证。

## 实现参考

- `src/renderer/ui/tokens.css` — `--ui-layer-window-caption`
- `src/renderer/styles.css` — `.windows-window-controls`、`body.serpent-modal-open .app-shell .windows-window-controls`
- `src/renderer/App.tsx:7750` — `dialogFocusTrapActive` 汇集点

## 审查固定项

代码审查时核对新增/修改的模态面板：

- [ ] 使用 `dialog-backdrop`（或同一切口），未自造蒙层
- [ ] 纳入 `dialogFocusTrapActive`（打开时 `serpent-modal-open` 生效）
- [ ] 窗口控制按钮仍可点击（Windows 自绘按钮；macOS 红绿灯）
