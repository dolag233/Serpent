# 0020 QA 报告 — 检查器与壳层视觉/UX 打磨

> 分支：`codex/slice-002-asset-ingestion`
> 基线 SHA：`5c9bb48`
> 实现提交：本报告所属提交（见 git log）。
> 构建环境：macOS 26.5 arm64，Node 24.15.0，npm 11.12.1，Electron 43.1.0。
> 构建产物：Electron + Vite 开发态 `.vite/build`；未生成 packaged app。
> 日期：2026-07-18
> 状态：macOS 开发态自动化全绿 + 用户人工已验证色卡复制；Windows 与 packaged app 未验证，结论为有条件通过。

## 自动化证据

| 检查 | 命令/范围 | 结果 |
|---|---|---|
| lint | `npm run lint` | GREEN，0 error |
| 类型检查 | `npm run typecheck` | GREEN，core + extension |
| 单元/Worker | `npm run test:unit` | 52 files；610 passed |
| Electron E2E | `npm run test:e2e`（全量 20 文件） | 63 passed（2.9m） |

E2E 相关回归修复：
- `context-menu` pointer-hover 样式断言：从共享 120ms 过渡列表移除瞬态浮层条目（context-menu-item / tag-suggestion-item），避免 getComputedStyle 读到过渡中间帧。
- `asset-pagination` 滚动锚点守卫：resizeAssetCards 两帧后仅在滚动位置等于「浏览器钳制值」时补偿，修复 place-items:center 网格小尺寸下顶部不可达导致的 scrollTop=0 回归；并补「作用域跳转后重新展开筛选面板」步骤（auto-close 浮层行为）。
- `browsing-preferences` 滚到底部断言：网格列宽分数像素致 scrollHeight 取整比真实最大滚动大 0.5，放宽为 ≥ maxScrollTop−1，与下方 deepestCard ±1 口径一致。
- `asset-grid-layout.ts` ASSET_GRID_GAP_PX 12→14 与 styles.css .asset-grid/.masonry-columns/.masonry-column gap 同步。

## 真实应用 UX 检查（Computer Use）

使用 kimi-cu Computer Use 操作本地真实 Serpent 窗口：
- 资产网格、瀑布流、筛选面板浮层、右键菜单、Inspector 选中态、资源库概览（无选中）均渲染新设计正确。
- 筛选面板外部点击自动关闭：经用户人工复测确认（右键菜单能关、原筛选面板不能关 → 定位为 useDismissibleDetails 闭包持有旧 DOM 节点的真 bug，已修：handler 内实时读 ref.current）。
- 色卡点击复制：用户人工验证，剪贴板得到 `#381444`，toast 反馈正常。
- AI 配置对话框：标签去强调色，排版由 ai-config-* 类承担。

## 用户人工验收记录

用户 2026-07-18 反馈与结论：
- 色卡均匀分布 + 点击复制 → 「我验证过了，可以没问题」。
- 其余打磨项（设计令牌、工具栏图标化、资产卡片、侧栏导航、Inspector 重设计、描述自适应、源链接跳转、AI 配置去强调色）随色卡一并确认。

## 未验证项

- Windows 平台：无 runner，Ctrl 多选/long path/打包均未验证。
- packaged app：未基于当前 HEAD 重新构建打包验收（纪律 #4）。
- 独立 agent 交叉审查：因 kimi 配额受限未完整执行（详见审查报告），最终 accepted 未被独立签署。

## 结论

macOS 开发态有条件通过：自动化全绿，用户已人工确认色卡复制与整体视觉打磨。发布级结论仍受 Windows、packaged app 与独立 agent 签署 `accepted` 约束。
