# 插件原生控件与菜单树增量开发日志

## 状态

- 日期：2026-08-02
- 范围：`Serpent-fkq3`、`Serpent-7nah.1`
- 状态：实现完成；Electron E2E 受当前环境启动 SIGABRT 阻断
- 结构化 UI DSL：不在本增量范围内，继续由 `Serpent-7nah` 跟踪

## 已实现

- `menus.*` 支持 `submenu`，最多三层；叶节点继续使用已声明的 command。
- 菜单贡献保留 `group`，并将 `open`、`organize`、`metadata`、`delete` 映射到宿主语义分组；其他值保留为插件自定义分区。
- 菜单贡献支持 `before` / `after` 一个相对宿主命令锚点，并通过注册表、IPC、Preload schema 传递。
- Host 设置支持 `boolean` toggle、`select` options、number 和 string；select 的提交值在 `PluginSettingsStore` 中二次校验。
- setting `description` 通过 Host 的 `data-hover-tip` 提供悬停帮助，并保留宿主渲染和无障碍字段。
- 更新 `unrestricted-settings-probe` fixture，覆盖菜单树、宿主分组、相对锚点、toggle、select 和 hover 描述。

## 关键文件

- `src/plugins/plugin-manifest.ts`
- `src/plugins/plugin-contributions.ts`
- `src/shared/plugin-manager-api.ts`
- `src/main/plugin-package-ipc.ts`
- `src/main/plugin-settings-store.ts`
- `src/renderer/plugin-host-settings-fields.tsx`
- `src/renderer/plugin-menu-contributions.ts`
- `src/renderer/AssetContextMenu.tsx`

## 自动化证据

- `npx vitest run tests/unit/plugin-contributions.test.ts tests/unit/plugin-menu-contributions.test.ts tests/unit/plugin-settings-sections.test.ts tests/unit/plugin-settings-store.test.ts`：18 passed。
- 最终定向命令覆盖 5 个插件贡献/设置测试文件：30 passed。
- `npx tsc --noEmit`：通过。
- 变更源文件定向 ESLint：通过。
- `npm run test`：未全绿；14 个既有 Worker/媒体失败，主要为 schema v28 与旧断言 v27 不一致、`plugin_derived_fields` 重复建表，以及 darwin media bundle 校验失败；未发现由本增量引入的失败。
- `npx playwright test tests/e2e/plugin-unrestricted-settings-pages.test.ts --reporter=line`：未执行成功；Electron 进程启动即 SIGABRT，Playwright 报 `Process failed to launch`。因此 PLUGIN-038/039 保持“自动化证据不足”，不能写成 E2E 通过。

## 已知限制

- 当前相对定位在宿主语义分组内按 `before`/`after` 边缘放置；完整结构化 UI 描述与更细粒度菜单布局仍属于 `Serpent-7nah` 后续范围。
- packaged、Windows 和 Computer Use 未执行。

## 2026-08-04：命令条件语义扩展到所有入口

`gtih` 的审查发现，命令注册表已有 `when` / `enablement` / `checked`，但工具栏、Inspector action、Viewer action 和快捷键列表没有继承这些条件，导致同一命令换入口后行为不一致。本次把命令条件作为这些 command-backed Contribution 的统一有效条件来源，并在 Renderer 依据当前 Contribution Context 隐藏、置灰或跳过不可用快捷键。

自动化证据：

```text
npx vitest run --config vitest.config.ts tests/unit/plugin-surface-conditions.test.ts tests/unit/plugin-contributions.test.ts tests/unit/plugin-menu-contributions.test.ts
# 3 files / 25 tests passed

npm run typecheck
npx eslint <本次变更的插件贡献、入口组件与测试文件>
# 均通过
```

仍未执行 packaged、Windows、真实右键/Viewer/无选择矩阵和 Computer Use，因此 `Serpent-gtih` 保持 `in_progress`，不能据此声明整套插件交互内核完成。
