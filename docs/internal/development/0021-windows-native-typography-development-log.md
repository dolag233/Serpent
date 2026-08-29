# 0021 Windows 原生字体与小字号可读性开发日志

> 状态：follow-up implementation complete / awaiting human re-acceptance
> 开始时间：2026-07-19
> 分支：`codex/windows-adaptation`
> 基线：`5c18852`
> 工单：`Serpent-2lp`

## 用户反馈与复现

用户提供的 Windows 截图显示 Inspector 当前资源库摘要中文字发虚且层级生硬。对应实现位于 `InspectorPanel.tsx` 的空选择资源库摘要；其 `.micro-label` 为 9.5px，`.metadata-list` 为 10px。全局字体栈又把打包的 `Noto Sans SC Variable` 放在 Windows 原生 `Microsoft YaHei` 之前。

### 2026-07-19 首轮复验不通过

用户截图确认字号/对比改善后字形仍怪。根因不是 DirectWrite 开关，而是同一身份摘要内继续混用三条路径：`.inspector-badge` 的 IBM Plex Mono 无 CJK、标题 560 在静态 YaHei UI 上跳到粗体、资产/文件夹数字的 `.mono`。首轮“YaHei actual font”自动化只能证明字体被选中，不能证明同一组件的字体系统一致；SHELL-023 当场改为人类验收不通过并重开 `Serpent-2lp`。

### 2026-07-19 第二轮反馈

用户确认右侧 Inspector 的长资源库名可以换行，但其他紧凑界面必须继续单行省略；同时指出 Inspector「为资产写一句备注…」与「输入作者…」的 placeholder 字形不一致。静态排查定位为 Chromium 原生 `textarea` 未进入现有 `button, input { font: inherit }` reset，Windows 下因而可能使用独立默认字体。基础 reset 已补齐 `select` 和 `textarea`；普通 UI 表单统一继承应用字体，文本预览编辑器仍由后置显式规则保留等宽字体。按用户要求，本次小改动未运行回归测试。

## 同步记录

- `git fetch origin` 后确认 `origin/codex/slice-002-asset-ingestion` 从 `8abc73c` 更新到 `5c18852`。
- 当前 Windows 分支无冲突 fast-forward 到 `5c18852`。
- `npm ci` 首次因正在运行的 Serpent 锁定 Rolldown/Electron 文件而失败；通过窗口正常关闭消息退出开发实例后重跑成功，未强杀进程。
- beads 本地 Dolt 与远端历史分叉；工单已在本地 JSONL 和 Dolt 中认领，但远端 Dolt push 因 GitHub 非交互认证/无共同祖先失败。代码与 `.beads/issues.jsonl` 仍随 Git 提交同步。

## 调研结论

- Microsoft：Segoe UI Variable 是 Windows 11 默认 UI 字体；简体中文 UI 字体为 Microsoft YaHei UI；普通正文建议至少 12px Regular。
- Microsoft：Microsoft YaHei 针对 ClearType 和屏幕小字号可读性设计。
- MDN：字体按字符逐项从 `font-family` 列表回退，因此显式把 YaHei UI 放在 Noto 前面可以保持 Segoe 拉丁字符，同时让简中采用 Windows 原生 UI 字形。
- MDN：`font-smooth` 非标准；`text-rendering: optimizeLegibility` 不是抗锯齿开关，普通 UI 应使用 `auto`。

## 实现

1. 新增 `renderer-platform.ts`，在 React 首帧前写入根元素平台标记；Windows 之外不套用字体覆盖。
2. Windows 字体栈改为 Segoe UI Variable/Segoe UI → Microsoft YaHei UI/YaHei → Noto fallback；保留 Noto 打包字体作跨环境兜底。
3. Inspector、侧栏、资源库/上下文菜单、过滤 caption、AI/搜索本地化摘要使用 12px UI 字体；Windows caption 从低对比 tertiary 提升到 secondary。
4. Windows 普通 UI 使用 `text-rendering: auto` 与 `font-optical-sizing: auto`，未加入 `font-smooth`、GPU 或 Skia 参数。
5. E2E 在隔离 userData 中创建中文库，验证亮/暗主题、12px、字距、≥4.5:1 对比度、`document.fonts.check`，并用 CDP 证明四类中文节点实际由 Microsoft YaHei UI 渲染。

## 复验修复

1. 全局 Windows 字体栈继续 Segoe → YaHei UI → Noto，保住已有 U+2026 省略号基线。
2. Inspector identity/metadata 使用独立 `--font-ui-unified`（bundled Noto Sans SC Variable）；徽标、标题正文、状态、资产、文件夹及数字统一 glyph family，500/560 使用真实可变字重。
3. `.mono` DOM 语义保留给 macOS/其他平台，仅 Windows metadata 数字覆盖为统一 UI 字体 + tabular figures。
4. 长资源库名在 Windows 完整换行，避免 Noto 生成省略号，也不依赖 pointer-only `title`；装饰性徽标 `aria-hidden`。
5. 徽标使用 `--accent-soft-fg`，亮/暗实际背景对比度均由 E2E 守住 4.5:1。
6. CDP 遍历全部 3 个 `dt` + 3 个 `dd`，不再只抽查「状态」和第一个数字。

## 已执行命令

| 命令 | 结果 |
| --- | --- |
| `git merge --no-edit origin/codex/slice-002-asset-ingestion` | fast-forward 到 `5c18852` |
| `npm ci --registry=https://registry.npmjs.org` | 753 packages 安装成功；npm audit 报告 26 个既有依赖告警，本切片不自动升级依赖 |
| `npm run rebuild:native` | 通过；Electron ABI 重编成功，FTS5 probe OK |
| `npm run typecheck` | 通过 |
| 定向 ESLint（4 个 TS/TSX 测试/实现文件） | 通过 |
| `npx vitest run --config vitest.config.ts tests/unit/renderer-platform.test.ts` | 1 file / 4 tests 通过 |
| `node scripts/run-e2e-isolated.mjs tests/e2e/windows-typography.test.ts` | 1 test 通过；Windows 亮/暗截图、CDP actual font、12px、字距和对比度断言均通过 |
| 首轮不通过后的同一字体 E2E | 1/1 通过；新增 identity/metadata bundled Noto actual font、全部 6 个 metadata 节点、徽标对比、长名换行、亮暗局部截图 |
| `npm run test:unit` | 当前主线红：112 files 中 110 通过、2 失败；996 tests 通过、4 跳过。失败为硬编码 macOS fixture 路径与既有 raw-hex token 测试 |
| `npm run lint` | 当前主线红：7 errors + 1 warning，均位于既有 Audio/Video/Text/SmartCollection/use-dialog 文件；本切片定向 lint 通过 |
| `npm run test:e2e:isolated` | 当前主线红：43 通过、3 跳过、18 失败；失败集中在同步后的导入/重命名/文件夹/恢复等既有旅程，字体专项通过 |
| `npm run verify:mainline` | 已执行，在上述既有 lint 7 errors + 1 warning 处停止；未伪记为通过 |

## 交叉审查处理

- 2 路深审 + 4 路广度审查完成。已修正 macOS `.micro-label` 被误改、`:is()` specificity 放大、E2E 清理泄漏、亮色/菜单/真实 glyph 缺口、未断言字距、更多中文正文仍走 monospace，以及小字对比度不足。
- 125%/150% DPI、macOS 和 packaged 保留为人工/平台证据缺口。

## 当前风险

- Windows 字体改善已由真实 Electron 亮/暗截图审查；最终主观接受仍只能由用户确认。
- macOS 不在当前机器上，定向 CSS 之外仍需后续平台回归。
- 同步后的当前主线存在与本切片无关的 lint、unit 和 18 项 E2E 红灯，详见 QA；因此不能声明主线验收完成。
