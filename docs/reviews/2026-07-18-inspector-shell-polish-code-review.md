# 0020 代码审查 — 检查器与壳层视觉/UX 打磨

> 分支：`codex/slice-002-asset-ingestion`
> 基线 SHA：`5c9bb48`
> 审查范围：`git diff`（11 文件，+1087/−573）加未跟踪文件 `src/renderer/use-dismissible-details.ts`、`src/shared/external-url.ts`
> 开发日志：`docs/development/2026-07-18-inspector-shell-polish-development-log.md`
> 日期：2026-07-18
> 审查模式：双轴（Standards + Spec）

## 审查执行情况（纪律 #11 合规说明）

CLAUDE.md 纪律 #11 要求每次代码变更后启动 2 个 sonnet 加 4 个 haiku 交叉审查。本次尝试调度 6 个 agent 并发执行（2 sonnet 双轴深度加 4 haiku 广度：regression / dead-code / accessibility / security）。其中 5 个 agent 因 kimi 后端配额受限（`403 You have reached your usage limit`）未能产出结果，仅 accessibility 轴 haiku 完成扫描。下方「haiku 可访问性轴」为实际产出，其余轴由主 agent 依据纪律 #5（独立最终验收）补做内联审查，但**主 agent 不得自签 accepted**，故最终 `accepted` 结论留待用户或独立 agent 签署。

用户 2026-07-18 明确指示「不用审查了，直接更新文档然后提交并 push」。故本审查记录到此处即止，后续不再补跑；accessibility 轴的可操作发现已在提交前修复（见下方），剩余为已知产品化缺口或低优先项，记于开发日志与人工验收清单。

## haiku 可访问性轴（实际产出，摘录与处置）

1. 评分组件状态仅靠颜色传达（InspectorPanel.tsx 评分 group）：star 按钮仅 `data-active` 改色，无 `aria-pressed`。→ 已处置：补 `aria-pressed={star <= editRating || undefined}`，喜欢按钮同理。
2. 清除评分按钮被包含在评分 group 内：会被读屏当作评分控件一部分。→ 评估为低优先，清除按钮在 group 内语义上确属「评分操作集」，保留不改；若后续读屏反馈混淆再外提。
3. 源链接 disabled 按钮提示暴露不足：disabled 不响应鼠标、不可聚焦，title 不可达。→ 已处置：改用 `aria-disabled` 加动态 aria-label 加 onClick 兜底，保持可聚焦。
4. 输入框与按钮无 aria 关联：→ 评估为低优先，输入框已有可见 placeholder 加按钮紧邻，当前不引入 aria-describedby 复杂度。
5. 色卡父容器无 role：→ 已处置：补 `role` 为 group。
6. 色卡 span 模拟 button 语义正确：role / tabIndex / aria-label / Enter+Space 齐全。→ 无需改。
7. `--tertiary` 对比度不足（约 3.2:1）：9.5–11px 小字低于 WCAG AA 4.5:1。→ 记为已知产品化缺口，不属本次回归（既有令牌，全应用使用）；列入后续主题化增量统一提亮。
8. 状态行文字同时说明状态：圆点 aria-hidden，文字写出「可用/文件丢失/回收站…」，语义不依赖颜色。→ 无需改。
9. use-dismissible-details 关闭后焦点丢失：→ 记为后续优化（关闭后移焦 summary），不阻断本次（Esc 关闭后用户多在画布操作）。
10. focus-visible 覆盖：新按钮为原生 button 已被全局覆盖，色卡 span 已单独定义 `:focus-visible`。→ 无需改。
11. textarea focus 未用 focus-visible：→ 低优先，焦点视觉可见，不改。

## 主 agent 内联补充审查（Standards / Spec / Regression / Dead-code / Security）

> 以下为主 agent 自查，**非独立 agent 签署**，仅供用户与后续独立审查参考。纪律 #5 规定实现者不得自签 accepted，故这些结论不构成最终验收。

### Standards 轴

- 新增 IPC 链路（external-url.ts / channels.ts `OPEN_EXTERNAL_URL_CHANNEL` / main handler / preload shell bridge）与既有 `EXTENSION_PAIRING_CHANNEL` 模式一致：sender 双重校验 + zod 输入 + 业务校验。
- App.tsx 改动遵循纪律 #8：resizeAssetCards 守卫、handleOpenSourceUrl、InspectorPanel props 接线均为对既有函数的增量，无新增 >60 行内联块；InspectorPanel/AiConfigDialog 已是独立模块。
- styles.css 令牌使用一致（--hover/--active/--accent-soft/--accent-ring），无应入令牌的硬编码颜色遗留。

### Spec 轴

- 滚动钳制守卫：测量时记录 scrollLeft/Top，两帧后仅当当前滚动位置等于「浏览器钳制值」才补偿，避免错误回拉用户新滚动意图；边界（缩小卡片从底部 clamp、分数像素 scrollTop、轮询缩放）经探针验证。
- use-dismissible-details：handler 内实时读 ref.current 规避条件渲染导致的 DOM 重建闭包失效；mousedown capture 与 ContextMenu 共存；Escape stopPropagation 仅在面板打开时拦截一次。
- 描述 textarea 自适应 effect 依赖 editDescription/assetId，受控输入下无抖动；色卡 canOpenSourceUrl 与主进程校验同口径（均走 toOpenableExternalUrl）。
- E2E 契约保留：getByLabel（描述/源链接 (URL)/人工色卡/人工色卡预览/自动色卡预览）、.inspector-hero-title、.inspector-hero-preview img 布局不变量、星/喜欢/清除评分按钮 aria-label 全部保留。

### Regression / Dead-code / Security 轴

- 被改动的共享选择器（.tool-button/.compact-action/.nav-row/.asset-card/.text-field/.primary-button/.secondary-button）波及面已由全量 E2E 63 绿覆盖，无未预期组件断裂。
- Icons.tsx 新图标 activity/box/clipboard/download/globe/sliders 均被工具栏引用，无死代码。
- 安全：OPEN_EXTERNAL_URL_CHANNEL 校验链（preload 透传 → main parseOpenExternalUrlRequest zod → toOpenableExternalUrl 协议+凭据校验）三道防线；色卡颜色经 isCssColor 正则后写入 style background，CSS 注入被拦截；navigator.clipboard.writeText 无敏感数据；main handler sender 校验与既有 handler 一致。

## 结论

macOS 开发态自动化与代表性 Computer Use 已完成；accessibility 轴可操作发现已修复。主 agent 不签署 accepted（纪律 #5），最终结论留待用户人工验收或独立 agent 签署。Windows 与 packaged app 未验证。
