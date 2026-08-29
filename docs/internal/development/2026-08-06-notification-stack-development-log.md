# 通知堆叠布局开发记录

## 工单与范围

- 工单：`Serpent-0k52`
- 用户反馈日期：2026-08-06
- 范围：多个 info/warning/error 通知必须垂直堆叠、互不遮挡、可逐条关闭。
- 当前状态：实现完成，自动化验证已通过；Computer Use、packaged 和 Windows 尚未执行。

## 根因

通知控制器原本只保留 `notice`、`warning`、`error` 三个单值通道，并在 UI 中只渲染一个最高优先级通知。每个通知都使用同一个固定顶部坐标，因此连续到达的通知要么覆盖旧消息，要么在优先级切换时丢失可见状态。

## 实现

- `src/renderer/toast-notifications.ts`
  - 将每条非 fatal 通知建模为带唯一 ID 的栈条目。
  - 保留每个条目的独立自动关闭计时器和淡出生命周期。
  - 新消息插入栈顶；旧消息仍保留到自动关闭或逐条手动关闭。
  - 保留 `rendered` 作为兼容性的最高优先级摘要，同时新增 `renderedStack` 供 UI 使用。
- `src/renderer/useToastNotifications.ts`
  - 暴露按 ID 关闭通知的回调。
  - 从通知元素的 `data-toast-id` 读取 transitionend 对应条目。
- `src/renderer/App.tsx` / `src/renderer/WorkspaceNoticeBanner.tsx`
  - 在一个 portal 中渲染通知栈。
  - 每条通知使用独立 key、关闭回调和退出动画。
- `src/renderer/styles.css`
  - 新增顶部居中的 flex 通知栈；通知条目改为普通流布局，避免多个 fixed 元素重叠。
- `tests/unit/toast-notifications.test.ts`
  - 增加多通道栈顺序、唯一 ID、单条关闭、同等级独立计时与淡出卸载覆盖。

## 独立审查

2026-08-06 使用 Composer 2.5 对本工单改动执行一次合并的 Standards / Spec 审查。审查未发现阻断项；根据审查建议补齐了日志状态、同等级独立计时测试、单一父级 live region、通知栈最大高度与 App 栈顶 ID 预计算。`setX(null)` 的现有语义是清理该 severity 的全部条目，保留并在控制器注释/测试语义中明确。

## 验证记录

已执行：

```text
npm run typecheck && npm run lint && npm run test:unit -- tests/unit/toast-notifications.test.ts
```

结果：通过。`typecheck` 和 `lint` 无错误；单元测试 `304 passed`、`2257 passed | 1 skipped`，其中通知控制器 19 项通过。

真实桌面 Computer Use、当前 HEAD packaged 构建、Windows 平台和用户本人验收尚未执行；不能据此标记为完成或人类验收通过。

## 2026-08-06 Info 单行通知窄窗布局复核

用户反馈显示，窄窗口中的短 Info 通知仍被撑到接近 viewport 宽度，文字与撤销/关闭动作
之间留下过大的空白。根因是通知栈使用 shrink-to-fit 宽度时，通知条目内部的
`width: 100%` 与父级 `align-items: stretch` 组合把条目反向撑到栈的最大宽度。

修复：

- 通知栈改用 `align-items: flex-start`；
- 通知条目改为 `width: auto; max-width: 100%` 并显式使用 `border-box`；
- 保留长文案的最大宽度、单行省略、通知堆叠、逐条关闭和撤销操作。

验证：既有 `organization-search-trash.test.ts` 完整回归 `4 passed`；本次修复后以同一
流程执行通知宽度定向回归 `1 passed`，并断言短通知宽度 `<280px`。此前主线
`npm run verify:mainline` 结果为 `72 passed / 3 skipped`；本次 CSS 收口后未重复整套主线。
当前 HEAD 的实际桌面视觉验收、packaged 和 Windows 仍未执行。

