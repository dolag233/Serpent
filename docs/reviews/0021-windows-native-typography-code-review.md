# 0021 Windows 原生字体与小字号可读性代码审查

> 状态：reviewed / findings addressed
> 基线：`5c18852`
> 审查范围：`renderer-platform`、Renderer typography CSS、Vitest/Playwright 证据、0021 文档与验收清单

## Standards（2 路深审）

- 平台覆盖只影响 Renderer CSS，不扩展 Renderer/Preload/Main/Worker 权限边界。
- macOS 基础 `.micro-label` 一度被全局改动；已按审查意见恢复，UI font 只在 Windows 平台覆盖。
- Windows 多 selector 字号规则一度依赖 `:is()` 的最高 specificity；已移到组件规则之后并改用 `:where()`，metadata 单独明确覆盖。
- E2E 启动失败/关闭失败路径已用嵌套 `try/finally` 无条件清理临时 userData。

## Spec（2 路深审）

- 初版只截暗色且未打开菜单；已补亮/暗主题和资源库菜单。
- 初版只检查 `font-family` 候选列表；已补 `document.fonts.check` 和 CDP actual platform font，覆盖 Inspector、metadata、侧栏和菜单中文节点。
- 已断言 12px、micro-label 字距和亮/暗 ≥4.5:1 对比度，并补齐规格四列表。
- macOS、packaged 和 Windows 125%/150% DPI 仍明确为未验证，不作完成证据。

## 广度审查（4 路）

- Regression：发现全平台 micro-label 变化、actual glyph 误报、亮色缺口、临时目录泄漏；均已修正。
- Accessibility：发现 tertiary 在 12px 下仅约 2.98–3.53:1；Windows caption 改用 secondary，E2E 守住 4.5:1。DPI 缩放作为人工保留项。
- CSS/platform：发现 AI 搜索计划、搜索摘要和选中资产 Inspector 同类中文仍为 9–11px/monospace；已纳入 Windows UI font/12px 范围，并对多个节点验证 actual font。
- Security/dead code：无安全边界、IPC、依赖或未用代码问题；字距采集已补断言。

## 最终发现

本切片范围内无未处理 P0–P2。保留项均为缺少平台证据，不得写为通过：macOS 视觉、Windows 125%/150% DPI、packaged 当前 HEAD。当前主线已有 lint/unit/E2E 红灯另记 QA，不由字体补丁掩盖。
