# UI 标准化阶段 1：Theme Contract v1 开发日志

> 日期：2026-08-04  
> 工单：`Serpent-ex46.2`  
> 设计基线：[0029 UI 标准化执行方案与插件原生 UI 契约](../implementation/0029-ui-standardization-execution-and-plugin-ui-contract.md)

## 范围

本阶段把插件主题从“插件可提交任意 CSS 变量覆盖”收口为版本化的语义 Theme Contract v1，并将主题变化可靠地传播到 sandboxed iframe。它不宣称完整 UI 标准化已经完成；公共 primitives、Host-rendered descriptor 和领域 UI 迁移属于后续阶段。

已完成：

- Host 公开语义引用：surface、content、border、action、state 共 15 个稳定名称；
- 插件主题 `version: 1`、light/dark mode、语义 `references` 与插件自有 `tokens`；
- 主题值限制为有界颜色字面量，插件不能覆盖 `--ui-*` 或注入任意 CSS；
- iframe 变量命名空间隔离：`--serpent-plugin-ref-*` 和 `--serpent-plugin-token-*`；
- `plugin-ui.theme-changed` 消息携带 `theme`、`contrast`、单调 `revision` 和有界 token map；
- 主题 revision 覆盖亮/暗/系统解析结果及强调色变化；
- fixture、插件开发文档、API 参考和定向契约测试同步更新。

## 四列追溯

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 语义主题引用与有界自有颜色 token | `src/plugins/plugin-manifest.ts`；`src/plugins/plugin-themes.ts` | `tests/unit/plugin-themes.test.ts` | 真实 Electron、packaged、Windows、Computer Use 未执行 |
| Host token 与插件 token 的 iframe 隔离 | `src/plugins/plugin-themes.ts`；`src/renderer/plugin-iframe-view-host.tsx` | `tests/unit/plugin-themes.test.ts`；`tests/unit/plugin-ui.test.ts` | 真实 iframe 亮/暗切换未执行 |
| 主题事件 revision 与协议校验 | `src/shared/plugin-ui-protocol.ts`；`src/renderer/theme/ThemeProvider.tsx` | `tests/unit/plugin-ui.test.ts`；主题定向回归 | 真实跨窗口时序未执行 |
| 开发者可依赖的发布契约 | `docs/manual/plugins/development.md`；`docs/manual/plugins/api-reference.md` | Manifest fixture 解析测试 | 文档待用户按示例验收 |

## 验证

```bash
npx vitest run tests/unit/plugin-themes.test.ts tests/unit/plugin-ui.test.ts tests/unit/theme-preferences.test.ts tests/unit/theme-css-tokens.test.ts tests/unit/ui-foundation.test.ts --reporter=dot
npm run typecheck
npx eslint src/plugins/plugin-manifest.ts src/plugins/plugin-themes.ts src/shared/plugin-ui-protocol.ts src/renderer/plugin-iframe-view-host.tsx src/renderer/theme/ThemeProvider.tsx tests/unit/plugin-themes.test.ts tests/unit/plugin-ui.test.ts
git diff --check
```

结果：定向测试 5 个文件、20 个测试通过；`typecheck`、定向 ESLint、`git diff --check` 通过。

## 未覆盖

- 用户编辑完整主题 profile 的设置界面和持久化；
- Host-rendered Settings/Menu/Notice/Activity descriptor；
- 所有遗留领域组件迁移到公共 primitives/patterns；
- packaged、Windows、Computer Use 和独立人工验收。
