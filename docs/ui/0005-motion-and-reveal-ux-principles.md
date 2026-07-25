# UI direction 0005: Motion and reveal UX principles

> Status: active product/UX constraint  
> Date: 2026-07-25  
> 关联：SHELL-030 / `Serpent-62wm`、查看页 chrome 渐隐、滚动条显隐

## 核心原则（一句话）

**出现可以即时（为跟手与实时性），消失必须有退出动画（淡出即可，避免硬切）。**

进入动画可选；若做，应短、轻，不得拖慢操作反馈。退出动画是默认要求——控件、浮层、滚动条拇指、闲置渐隐的 chrome 等，从「可见」回到「隐藏」时不得瞬间消失。

## 实现提示

- 显式写 **show 无 transition / hide 有 transition**（例如滚动条拇指：`transition: background 220ms ease-in` 写在默认透明态，`.is-scrollbar-active` 上 `transition: none` 即时出现）。
- 时长参考：退出 **180–280ms**，ease-in 或 ease-out；不必与进入对称。
- 验收时除了「有没有出现」，还要确认 **松手/离开/闲置结束后是否柔和淡出**。
