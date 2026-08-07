# 主题色设置默认折叠开发记录

## 工单与范围

- 工单：`Serpent-siwm`
- 需求：打开设置时「主题色设置」默认折叠，用户点击标题后才展开。
- 当前状态：实现完成，待人类验收；packaged、Windows 尚未执行。

## 根因与修复

`ThemeColorSettings` 显式向通用 `SettingsDisclosure` 传入 `defaultOpen`，覆盖了组件默认的折叠状态。移除该属性后，`SettingsDisclosure` 的 `defaultOpen = false` 生效；用户仍可通过标题按钮展开和再次折叠，主题颜色编辑逻辑未改变。

## 验证

- `tests/e2e/shell-navigation.test.ts` 新增 macOS 路径断言：设置打开后 `主题色设置` 的 `aria-expanded` 为 `false`、编辑网格不可见；点击后变为 `true` 且编辑网格可见。
- `npm run typecheck`：通过。
- `npm run lint`：通过。
- 当前会话未执行 Computer Use、packaged 构建或 Windows 验证。

