# 2026-07-29：交互式脚本沙箱预览代码审查（Serpent-opwv）

> 审查基线：`a160f60` 上的工作树增量（未提交）
>
> 范围：开发态 Script Sandbox Preview dialog、Renderer Web Worker、QuickJS/WASM 预览适配、错误显示及 Escape 集成。不是 0023 正式 Script Runtime/MCP 审查。

按仓库验收纪律，本次功能性跨模块变更由两位独立审查者分别从规范与规格审查；实现者逐条处理后复跑定向验证。

## Standards 审查

| 发现 | 处置 | 验证 |
| --- | --- | --- |
| P2：TypeScript 转译发生在 QuickJS 资源限额前，过大源码可在 Worker 内造成资源压力。 | 已修复：共享 64 KiB UTF-8 上限在 UI、Worker runtime 和 QuickJS 转译前强制执行。 | `script-sandbox-limits.ts`、`quickjs-sandbox-prototype.ts`；超限用例见 `quickjs-sandbox-prototype.test.ts`、`script-sandbox-preview-runtime.test.ts`。 |
| P2：controller 的英文失败文案会混入中文 UI。 | 已修复：协议只接受已知稳定错误码，Dialog 使用 `automation.preview.errors.*` 本地化映射，不展示 Guest 原始错误。 | `script-sandbox-preview-protocol.ts`、`ScriptSandboxPreviewDialog.tsx`；真实 UI 以 `node:fs` 导入验证中文提示。 |
| P2：真实 Worker 请求处理缺少自动化覆盖。 | 已修复：将 Worker 请求处理抽为 `runScriptSandboxPreview` 并以真实 QuickJS 运行默认 JS/TS、导入拒绝、64 KiB 拒绝；controller 单测覆盖 stop 后迟到消息。 | `script-sandbox-preview-runtime.test.ts`、`script-sandbox-preview-controller.test.ts`。 |
| P2：开发/QA 记录缺乏实时四列证据。 | 已修复：本开发日志和 QA 报告已补基线、实现位置、自动化、平台观察与未验证项。 | 本目录日志/QA。 |

## Spec 审查

| 发现 | 处置 | 验证 |
| --- | --- | --- |
| P2：开发日志仍写“待实现/待补”，与实际 UI 和测试矛盾。 | 已修复。 | [开发日志](../development/2026-07-29-script-sandbox-preview-development-log.md)。 |
| P2：`return 1n` 会让 `JSON.stringify` 抛宿主 TypeError，退化为泛化运行时错误。 | 已修复：限制核算与 UI 展示均使用 BigInt/循环安全的显示序列化。 | `quickjs-sandbox-prototype.ts`、`ScriptSandboxPreviewDialog.tsx`；BigInt 回归见 `quickjs-sandbox-prototype.test.ts`。 |

## 审查结论

未发现 P1。所有 P2 已处理；不把开发预览误写为正式 Runtime。最终用户验收仍保留 AUT-006 的真实“停止”点击、主题与窄窗检查。
