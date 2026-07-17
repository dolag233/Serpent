# 0020 开发日志 — 检查器与壳层视觉/UX 打磨

> 触发：用户 2026-07-17/18 反馈——“按你的审美把 UI 打磨好看，融入现代软件 UX 设计，竞品参考 Eagle”；并在迭代中追加四项具体反馈（色卡均匀+点击复制、字段重排、描述自适应/源链接跳转、AI 配置去强调色）。
> 审查报告：`docs/reviews/2026-07-18-inspector-shell-polish-code-review.md`
> QA 报告：`docs/qa/2026-07-18-inspector-shell-polish-qa-report.md`

## 基线与状态

- 分支：`codex/slice-002-asset-ingestion`
- 基线 SHA：`5c9bb48`（`bd init` issue tracker 落地提交）
- 实现提交：本日志所属提交（见 `git log`）。
- 开始：2026-07-17；最后更新：2026-07-18。
- 状态：`implementing` → `automated-verification`（lint/typecheck/unit 610/E2E 63 全绿）→ `code-review`（交叉审查因 kimi 配额受限未完整执行，详见审查报告）→ `qa`。macOS 开发态 Computer Use 与用户人工已验证；Windows 与 packaged app 未验证，结论为有条件通过。

## 已完成的垂直行为

- **设计令牌升级**：新增 `--hover`（4.5% 白）、`--active`（8% 白）、`--accent-soft`（accent 14%）、`--accent-ring`、`--border` 别名（修复多处引用未定义令牌的隐性 bug）；全局细滚动条（10px、透明轨道、13%→24% 拇指）、`::selection` accent、`focus-visible` 2px accent ring；18 个静音控件共享 120ms 过渡语言（瞬态浮层条目 context-menu-item / tag-suggestion-item 刻意排除，避免 E2E 读到过渡中间帧）。
- **工作区工具栏图标化**：原 9 个文本 `compact-action` 按钮改为 `ToolButton` 三组（导入/导出/工具），`aria-label` 与原文本完全一致，~35 处 E2E `getByRole('button', { name })` 无需改动。
- **资产卡片**：8px 圆角、hover `--hover`（去掉边框闪烁）、选中态 accent 9% 背景 + 2px accent ring（REQ-SELECT-003 保留）；预览底栏去掉条纹渐变与 border-bottom；视频时长徽标（`asset-duration-badge`，毛玻璃，左下角避开右下角缺失横幅）；扩展名 frosted pill；说明文字节奏收紧。
- **侧栏导航**：28px 行高、6px 圆角、hover `--hover`、`is-active` `--active`（REQ-NAV-005 仅背景，无强边框/指示条）；drop-target 用 accent 混色区分。
- **Inspector 重设计**：左对齐资产身份区（预览→文件名→摘要行，文件名两行省略）；可用性状态用语义色圆点（绿/红/橙）+ 文字，取代抢视线的灰胶囊；评分/喜欢聚拢一行（评分左、喜欢右），评分与喜欢激活态图标实心填充 + 缩放微动；标签区距收紧。
- **色卡（用户反馈 1/2）**：等宽分段条（顺序即提取重要性，左→右），点击任一分段复制 hex 到剪贴板，toast 反馈；`role=button` + 键盘 Enter/Space；色卡字段前移到评分之后、描述之前。
- **描述与源链接（用户反馈 3）**：描述 textarea `resize:none` + JS 自适应高度（auto→scrollHeight，max 180px 内部滚动），无下拉手柄；源链接单行截断，右侧嵌 link 图标按钮，仅当 URL 通过 HTTP(S) + 无凭据校验时可用，点击经新 IPC `OPEN_EXTERNAL_URL_CHANNEL` 由主进程 `shell.openExternal` 打开系统浏览器。
- **AI 配置对话框（用户反馈 4）**：去掉全部内联样式，标签由 accent 强调色改为中性 `--tertiary`（accent 只留给真正可点控件），新增 `ai-config-*` 系列类承担排版。
- **筛选面板浮层行为**：`<details>` 披露控件支持外部 mousedown / Escape 自动关闭（`useDismissibleDetails` hook），保留 native summary 切换与既有 E2E 逐步打开/关闭流程。
- **滚动钳制回归修复**：`resizeAssetCards` 两帧后只在滚动位置等于"浏览器钳制值"时做锚点补偿，避免把用户新的滚动意图（拖滚动条/脚本 scrollTo）拉回旧锚点。

## 公共测试接缝

- `toOpenableExternalUrl` / `parseOpenExternalUrlRequest`（`src/shared/external-url.ts`）：渲染进程禁用态判定 + 主进程最终校验，两道防线都不放行非 HTTP(S)。
- `useDismissibleDetails`（`src/renderer/use-dismissible-details.ts`）：handler 内实时读 `ref.current`，规避条件渲染导致的 DOM 重建使闭包失效。
- E2E 契约保持：`getByLabel("描述"/"源链接 (URL)"/"人工色卡"/"人工色卡预览"/"自动色卡预览")`、`.inspector-hero-title`、`.inspector-hero-preview img` 布局不变量、星/喜欢/清除评分按钮 aria-label 全部保留。

## 重要实现决定及理由

1. **色卡等宽而非按比例**：用户明确要求均匀分布 + 顺序即重要性；等宽条视觉更整洁，比例信息通过 `title` tooltip（`#xxx · 39.6% · 点击复制`）保留，不丢失数据。
2. **点击复制走 `navigator.clipboard.writeText`**：无需新 IPC，剪贴板 API 在 Electron 渲染进程可用；失败回退 toast 报错。
3. **源链接跳转走主进程 `shell.openExternal`**：Renderer 沙箱不可直接调 shell；新 IPC 通道与既有 `EXTENSION_PAIRING_CHANNEL` 同模式（sender 校验 + zod 输入 + 业务校验），URL 协议/凭据双重校验。
4. **描述自适应高度用 effect 而非 CSS `field-sizing`**：Chromium 已支持 `field-sizing:content`，但 Electron 版本依赖与跨浏览器一致性未确认；JS 量高在受控值与资产切换时重算，兜底 max-height + 内部滚动防溢出。
5. **AI 对话框标签去 accent**：满屏 accent 标签会稀释真正可点的行动点（保存/取消按钮）；中性 `--tertiary` 让强调色回归"这是可交互的"语义。
6. **瞬态浮层不加共享过渡**：context-menu hover 必须即时；给 `background-color` 加过渡会让 E2E `getComputedStyle` 读到中间帧值（`oklab(0 0 0 / 0)`），样式断言抖动。
7. **筛选面板 auto-close 不破坏逐步切换 E2E**：全量 E2E 复盘确认所有 toggle 测试在 open→inside-click→close 之间都有面板内点击，auto-close 无影响；`asset-pagination` 在作用域跳转后需显式重新展开面板（已修测试）。
8. **滚动钳制守卫**：`place-items:center` 的 grid 在小尺寸下顶部溢出不可达，浏览器钳制 `scrollTop` 后两帧内若被用户/脚本改动，旧 RAF 会错误回拉；守卫比对"测量时钳制值"作废补偿。

## 与规格的偏离

- 用户反馈驱动的色卡均匀分布偏离了 Eagle 的"按比例分段"惯例；以 tooltip 保留比例数据，是显式产品取舍。
- 未实现色卡拖拽重排序、未实现源链接的"复制链接"次级动作（当前点击=跳转）；留待后续需求。

## 人工验收待办

见 `docs/qa/human-acceptance-checklist.md` 新增的 INSPECT-005、PALETTE-001、URL-OPEN-001、AICFG-001、FILTER-OUTSIDE-DISMISS-001、TOOLBAR-001 条目。
