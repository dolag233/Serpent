# 0021 Windows 原生字体与小字号可读性 QA 报告

> 状态：首轮人类验收不通过；复验修复专项通过，等待用户复验
> 分支：`codex/windows-adaptation`
> 基线：`5c18852`

## 自动化

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| 定向 ESLint | 通过 |
| 平台解析 Vitest | 4/4 通过 |
| Windows 字体隔离 Electron E2E | 1/1 通过：全局 YaHei UI；Inspector identity/全部 metadata bundled Noto actual font；暗/亮、12px、字距、徽标/caption ≥4.5:1、长名换行 |
| `npm run lint` | 未通过：7 errors + 1 warning，均为当前主线既有 React hooks 问题，未触及本切片文件 |
| `npm run test:unit` | 未通过：996 passed / 4 skipped / 2 failed；失败为 `/Users/dolag/...` 音频 fixture 硬编码和既有 raw hex token 检查 |
| `npm run test:e2e:isolated` | 未通过：43 passed / 3 skipped / 18 failed；字体专项在该轮通过，其他失败涉及导入、资产/目录重命名、分页、恢复等同步后主线旅程 |
| `npm run verify:mainline` | 已执行，在 lint 的 7 errors + 1 warning 处停止 |

## Windows 真实界面

- Electron 以临时 `SERPENT_E2E_USER_DATA_PATH` 和临时建库父目录启动；结束后关闭应用并删除临时目录。
- 创建中文资源库「设计资源库」，打开资源库菜单，分别在暗色与亮色读取 computed style。
- 首轮用户不通过证据：[Inspector 字形仍异常](evidence/0021-windows-typography/windows-inspector-identity-user-fail.png)。
- 修复后 CDP `CSS.getPlatformFontsForNode` 证明 Inspector 徽标、名称、当前资源库、全部状态/资产/文件夹 label/value 实际解析到 bundled Noto Sans SC；侧栏与菜单继续走 Microsoft YaHei UI。
- E2E 动态注入超长中文库名，证明 Windows 下完整换行、无横向溢出，不触发 Noto U+2026 基线问题。
- [修复后亮色局部](evidence/0021-windows-typography/windows-inspector-identity-light.png) / [修复后暗色局部](evidence/0021-windows-typography/windows-inspector-identity-dark.png)
- [亮色截图](evidence/0021-windows-typography/windows-inspector-typography-light.png)
- [暗色截图](evidence/0021-windows-typography/windows-inspector-typography-dark.png)

## 平台矩阵

| 平台 | 开发态 | packaged | 结论 |
| --- | --- | --- | --- |
| Windows | 首轮不通过；当前复验修复专项通过 | 未执行 | SHELL-023 可重新进入待人类验收；不可写 packaged/主线通过 |
| macOS | 本机不可执行 | 未执行 | 保留回归 |

## 最终结论

首轮方案已被用户明确否决；当前方案针对其截图根因重做并获得当前 HEAD 的 Windows 开发态自动化和亮暗局部截图证据，可重新进入 `SHELL-023` 待用户复验。只有用户确认后才能标记通过。125%/150% DPI、packaged、macOS 和当前主线既有红灯均未关闭。

2026-07-19 第二轮反馈补充：Inspector 备注 `textarea` 已与作者 `input` 统一继承 UI 字体；资源库名称换行继续严格限定在右侧 Inspector，切换器与菜单保持单行省略。遵照用户要求，此最小 CSS reset 只完成静态范围核对，未新增或运行回归测试，因此仍等待人工复验。
