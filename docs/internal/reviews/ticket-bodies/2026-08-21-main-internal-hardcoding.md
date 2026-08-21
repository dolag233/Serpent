延续 Serpent-n5iu。Main 层 shell/clipboard/外部打开等路径（index.ts ~4650-4874 等）在 OS 操作失败时硬编码 createPublicError('INTERNAL_ERROR')，丢失 EACCES/ENOENT 等可操作信息。

同步服务器配置缺失等路径抛中文 Error，经 toPublicError 剥 message 后仍落 INTERNAL。

## 要求

- 逐条评估 Main INTERNAL 兜底点：能映射到 LIBRARY_* / ASSET_* / 文件系统 reason 的必须映射。
- 保留中文 actionable message（0004 原则）；禁止无日志的静默 INTERNAL。
- automation-script-ipc 等同理。

## 验收

- openPath/reveal/剪贴板/同步服务器缺失等失败时用户可见具体原因与建议。
- 补 main 层定向单测；typecheck/lint 通过。
