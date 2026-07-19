# 0021 Windows 原生字体与小字号可读性 QA 报告

> 状态：字体专项通过 / 主线与平台验收未完成
> 分支：`codex/windows-adaptation`
> 基线：`5c18852`

## 自动化

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| 定向 ESLint | 通过 |
| 平台解析 Vitest | 4/4 通过 |
| Windows 字体隔离 Electron E2E | 1/1 通过：暗/亮、Inspector/侧栏/菜单、12px、字距、≥4.5:1、Microsoft YaHei UI actual platform font |
| `npm run lint` | 未通过：7 errors + 1 warning，均为当前主线既有 React hooks 问题，未触及本切片文件 |
| `npm run test:unit` | 未通过：996 passed / 4 skipped / 2 failed；失败为 `/Users/dolag/...` 音频 fixture 硬编码和既有 raw hex token 检查 |
| `npm run test:e2e:isolated` | 未通过：43 passed / 3 skipped / 18 failed；字体专项在该轮通过，其他失败涉及导入、资产/目录重命名、分页、恢复等同步后主线旅程 |
| `npm run verify:mainline` | 已执行，在 lint 的 7 errors + 1 warning 处停止 |

## Windows 真实界面

- Electron 以临时 `SERPENT_E2E_USER_DATA_PATH` 和临时建库父目录启动；结束后关闭应用并删除临时目录。
- 创建中文资源库「设计资源库」，打开资源库菜单，分别在暗色与亮色读取 computed style。
- `document.fonts.check` 证明 YaHei UI 可用；CDP `CSS.getPlatformFontsForNode` 证明 Inspector label、metadata、侧栏 heading、菜单 section 的中文 glyph 实际解析为 Microsoft YaHei UI，而非只检查 CSS 候选列表。
- [亮色截图](evidence/0021-windows-typography/windows-inspector-typography-light.png)
- [暗色截图](evidence/0021-windows-typography/windows-inspector-typography-dark.png)

## 平台矩阵

| 平台 | 开发态 | packaged | 结论 |
| --- | --- | --- | --- |
| Windows | 字体专项通过；全量 E2E 主线红 | 未执行 | SHELL-023 可进入待人类验收；不可写 packaged/主线通过 |
| macOS | 本机不可执行 | 未执行 | 保留回归 |

## 最终结论

Windows 开发态字体专项满足自动化和截图证据，可进入 `SHELL-023` 待用户验收。125%/150% DPI、packaged、macOS 和当前主线既有红灯均未关闭；切片不得标记 `accepted`。
