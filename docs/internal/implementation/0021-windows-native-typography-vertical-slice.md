# 0021 Windows 字体一致性与小字号可读性垂直切片

> 状态：follow-up implemented / awaiting human re-acceptance
> 日期：2026-07-19
> 工单：`Serpent-2lp`

## 问题

Windows 真实应用截图中，Inspector「当前资源库」摘要的简体中文辅助文字发虚、笔画不均，正文与数字的混排观感明显弱于 macOS。首轮修复解决了 9.5–10px 和低对比问题，但用户复验仍不通过：徽标中文由 IBM Plex Mono 的 generic monospace fallback 渲染，标题的 560 在静态 YaHei 字重上跳档，计数又切换到第三套 monospace，造成同一摘要内三套字形/字重混排。

## 设计依据

- Windows 官方字体指南推荐 Windows UI 使用 Segoe UI Variable，并把 Microsoft YaHei UI 列为简体中文 UI 字体。
- Windows 官方建议普通 UI 文字不小于 12px Regular，标题使用 Semibold；截图中的 9.5–10px 低于此下限。
- CSS `font-smooth` / `-webkit-font-smoothing` 不是可移植的 Windows DirectWrite 控制面，不作为修复手段。
- `text-rendering: optimizeLegibility` 主要影响字偶距和连字，适合短标题，不是抗锯齿开关；Windows 普通 UI 恢复浏览器 `auto` 决策。
- Windows 全局仍保持 Segoe → YaHei UI → Noto 的原生优先回退，避免 Noto 的 U+2026 全角省略号回归；仅在不截断的 Inspector 身份/统计摘要中使用打包的 Noto Sans SC Variable，使中文、数字和 500/560 中间字重保持同一字体家族。

## 范围

1. Renderer 在 React 首次渲染前为根节点标记 `windows` / `macos` / `other` 平台。
2. Windows 全局字体栈优先使用 `Segoe UI Variable` / `Segoe UI`，简体中文逐字符回退到 `Microsoft YaHei UI`；Inspector 身份/统计摘要定向使用打包的 `Noto Sans SC Variable`。
3. 保持 macOS 的 `-apple-system` / PingFang 路径不变。
4. Windows 上把截图所涉 Inspector 摘要，以及同类高频壳层 caption/计数文字提升到不低于 12px Regular；取消 CJK 小字号的大字距，并让小字相对所在表面至少达到 4.5:1 对比度。
5. IBM Plex Mono 只用于路径、快捷键和明确的技术数据；资源库徽标与统计数字不再换字体，数字用 `font-variant-numeric: tabular-nums`。
6. Windows 长资源库名完整换行，不依赖指针悬停或 Noto U+2026；徽标标为装饰性且对比度不低于 4.5:1。
7. 新增平台解析单测与 Windows Electron E2E：检查 computed style、CDP actual platform font、全部 metadata label/value、长名换行和截图。

## 非范围

- 不改变 Chromium/DirectWrite 命令行开关，不关闭 GPU，不切换 Skia 后端。
- 不加入非标准字体平滑属性。
- 不在本切片重做全部 UI 密度、间距或设计系统。
- Windows 之外的平台只做回归保护，不以 Windows 结果替代 macOS 人工 QA。

## 验收条件

| 需求 | 实现位置 | 自动化 | 人工/平台证据 |
| --- | --- | --- | --- |
| Windows 全局原生字体栈 + 摘要统一可变字体 | `src/renderer/styles.css:76`、`:85`、`:5216` | `tests/e2e/windows-typography.test.ts:130`–`:145`、`:207`–`:259`（CDP actual font） | 全局侧栏/菜单实际为 YaHei UI；Inspector 徽标、标题、状态/资产/文件夹全部节点实际为 bundled Noto Sans SC |
| Renderer 首帧带稳定平台标记 | `src/renderer/renderer-platform.ts:3`、`src/renderer/main.tsx:13` | `tests/unit/renderer-platform.test.ts:8`–`:20`、E2E `:130` | Windows Electron 根节点为 `data-platform=windows` |
| Inspector 摘要无 generic monospace、静态字重跳档或低对比 | `src/renderer/InspectorPanel.tsx:1313`、`:1318`；`src/renderer/styles.css:5216`、`:5252` | E2E `:139`–`:164`、`:207`–`:245` | [用户不通过截图](../qa/evidence/0021-windows-typography/windows-inspector-identity-user-fail.png) / [修复后亮色局部](../qa/evidence/0021-windows-typography/windows-inspector-identity-light.png) / [暗色局部](../qa/evidence/0021-windows-typography/windows-inspector-identity-dark.png) |
| 侧栏/菜单核心文字不低于可读下限 | `src/renderer/styles.css:5157`–`:5176`（字号）、`:5178`–`:5199`（颜色） | E2E 字号 `:155`–`:157`、actual font `:245`–`:259` | Windows 亮/暗资源库菜单截图；字号 12px、对比度 ≥4.5:1 |
| macOS 字体路径无定向覆盖 | 所有新增视觉覆盖均位于 `:root[data-platform="windows"]`；基础 `.micro-label` 仍为原样 | `tests/unit/renderer-platform.test.ts:8`–`:20` 仅验证平台分流 | macOS Electron/视觉未执行，保留平台回归，不标记通过 |
| 长资源库名可读且无 Noto 省略号回归 | `src/renderer/styles.css:5238`–`:5245`、`src/renderer/InspectorPanel.tsx:1318` | E2E `:171`–`:202` 动态注入长中文名并验证换行、无横向溢出 | Windows 开发态通过；缩放平台复验保留 |

## 保留项

- Windows 125%/150% DPI 与系统文字缩放下的固定高度裁切需要人工平台复验。
- packaged 当前 HEAD 未执行；不能用开发态截图替代 packaged 结论。
- macOS 本机不可用，定向 CSS 已避免改变其基础字体路径，但视觉仍未验证。
