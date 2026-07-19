# 0021 Windows 原生字体与小字号可读性垂直切片

> 状态：implemented / awaiting human acceptance
> 日期：2026-07-19
> 工单：`Serpent-2lp`

## 问题

Windows 真实应用截图中，Inspector「当前资源库」摘要的简体中文辅助文字发虚、笔画不均，正文与数字的混排观感明显弱于 macOS。当前实现把 `Noto Sans SC Variable` 放在 Windows 自带的 `Microsoft YaHei UI` 之前，并在该表面使用 9.5–10px 字号；两点共同放大了 Chromium/DirectWrite 下的小字号差异。

## 设计依据

- Windows 官方字体指南推荐 Windows UI 使用 Segoe UI Variable，并把 Microsoft YaHei UI 列为简体中文 UI 字体。
- Windows 官方建议普通 UI 文字不小于 12px Regular，标题使用 Semibold；截图中的 9.5–10px 低于此下限。
- CSS `font-smooth` / `-webkit-font-smoothing` 不是可移植的 Windows DirectWrite 控制面，不作为修复手段。
- `text-rendering: optimizeLegibility` 主要影响字偶距和连字，适合短标题，不是抗锯齿开关；Windows 普通 UI 恢复浏览器 `auto` 决策。

## 范围

1. Renderer 在 React 首次渲染前为根节点标记 `windows` / `macos` / `other` 平台。
2. Windows 字体栈优先使用 `Segoe UI Variable` / `Segoe UI`，简体中文逐字符回退到 `Microsoft YaHei UI` / `Microsoft YaHei`，打包的 Noto Sans SC 仅作兜底。
3. 保持 macOS 的 `-apple-system` / PingFang 路径不变。
4. Windows 上把截图所涉 Inspector 摘要，以及同类高频壳层 caption/计数文字提升到不低于 12px Regular；取消 CJK 小字号的大字距，并让小字相对所在表面至少达到 4.5:1 对比度。
5. 保留 IBM Plex Mono 只用于代码、快捷键和明确的技术数据，不让它承担中文正文。
6. 新增平台解析单测与 Windows Electron E2E：检查实际 computed style、字体就绪和截图。

## 非范围

- 不改变 Chromium/DirectWrite 命令行开关，不关闭 GPU，不切换 Skia 后端。
- 不加入非标准字体平滑属性。
- 不在本切片重做全部 UI 密度、间距或设计系统。
- Windows 之外的平台只做回归保护，不以 Windows 结果替代 macOS 人工 QA。

## 验收条件

| 需求 | 实现位置 | 自动化 | 人工/平台证据 |
| --- | --- | --- | --- |
| Windows 原生拉丁/简中 UI 字体栈 | `src/renderer/styles.css:76`、`:5204` | `tests/e2e/windows-typography.test.ts:121`、`:151`（CDP 实际字体） | Windows Electron：Inspector、metadata、侧栏、菜单中文节点实际解析到 Microsoft YaHei UI；亮/暗截图 |
| Renderer 首帧带稳定平台标记 | `src/renderer/renderer-platform.ts:3`、`src/renderer/main.tsx:13` | `tests/unit/renderer-platform.test.ts:7`、E2E `:121` | Windows Electron 根节点为 `data-platform=windows` |
| Inspector 摘要不再使用 9.5–10px/低对比中文 | `src/renderer/styles.css:5149`、`:5173`、`:5196` | E2E `:132`、`:139`、`:195`、`:201` | [亮色](../qa/evidence/0021-windows-typography/windows-inspector-typography-light.png) / [暗色](../qa/evidence/0021-windows-typography/windows-inspector-typography-dark.png) |
| 侧栏/菜单核心文字不低于可读下限 | `src/renderer/styles.css:5152`、`:5173` | E2E `:136`、`:145`、`:157`、`:204` | Windows 亮/暗资源库菜单截图；字号 12px、对比度 ≥4.5:1 |
| macOS 字体路径无定向覆盖 | 所有新增视觉覆盖均位于 `:root[data-platform="windows"]`；基础 `.micro-label` 仍为原样 | `tests/unit/renderer-platform.test.ts:7` 仅验证平台分流 | macOS Electron/视觉未执行，保留平台回归，不标记通过 |

## 保留项

- Windows 125%/150% DPI 与系统文字缩放下的固定高度裁切需要人工平台复验。
- packaged 当前 HEAD 未执行；不能用开发态截图替代 packaged 结论。
- macOS 本机不可用，定向 CSS 已避免改变其基础字体路径，但视觉仍未验证。
