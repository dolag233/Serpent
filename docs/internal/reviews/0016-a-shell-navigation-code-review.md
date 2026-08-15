# 0016-A 双轴代码审查

> 审查基线：相对 `d49e51a` 的未提交增量
> 日期：2026-07-17
> 审查模型：cursor-grok-4.5-high × 2（Standards / Spec）

## Standards

- **HARD：0**
- Medium：App.tsx 导航编排仍偏大（建议后续抽 hook）；`WorkspaceNavLocation` kind 多处 switch；unified linked 行渲染再查表；`parentFolderId`/`peek` 生产侧使用偏少。
- 纯模块抽取与路径边界合格。

## Spec

- REQ-SHELL-005 / NAV-001–004 主体已覆盖。
- 已修：无库空态不再显示产品名 `Serpent`，改为「选择资源库」。
- 残留风险：back/forward 先改栈再 apply，失败时可能短暂不一致；E2E 本机 Electron 启动失败未跑绿；Computer Use 未执行。

## 结论

有条件合入开发分支；人类验收 SHELL-004、NAV-001–003；真实 Electron E2E / Computer Use 待补。
