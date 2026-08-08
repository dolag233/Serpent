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

## 2026-08-04：Placement Solver 稳定性增量

本次继续推进 `Serpent-fkq3` 的可独立验证部分，但不宣称整个 Command Registry/菜单表面统一已经完成：

- 将菜单同级排序收敛为可复用的 `solvePluginMenuPlacement`，默认平局按 group、plugin ID、plugin instance ID、item ID 和注册顺序确定，避免依赖 IPC 返回顺序。
- 保留 Host 稳定锚点（如 `asset.rename`、`host.asset.open-with`）的放置语义；未知锚点不丢弃菜单项，而是降级为普通同级项并记录 `missing-anchor` 诊断。
- 父节点缺失、循环约束和超过三级的子菜单分别记录 `orphan-parent`、`cycle-broken`、`max-depth` 诊断；循环只移除冲突边，超深只拒绝超出的分支，其他菜单继续显示。
- 诊断通过开发态 `console.warn` 输出，不进入用户可见 UI，也不让单个坏 Contribution 清空整张菜单。

自动化证据：

```text
npx vitest run tests/unit/plugin-menu-contributions.test.ts --reporter=dot
# 1 file / 11 tests passed

npx eslint src/renderer/plugin-menu-contributions.ts tests/unit/plugin-menu-contributions.test.ts
npm run typecheck -- --pretty false
git diff --check
# 均通过
```

`Serpent-fkq3` 仍保持 `in_progress`：完整的 native item/plugin item 统一树、toolbar/Inspector/Viewer 复用同一 Placement Solver、真实 Electron 菜单旅程、packaged/Windows 和 Computer Use 证据仍需在 `Serpent-gtih`、`Serpent-upsn.6` 等依赖收口后继续完成。

## 2026-08-04：命令表面顺序与插件内锚点

补齐两个会让不同入口表现漂移的边界：

- toolbar、Inspector、Viewer action 和快捷键现在共用同一个稳定排序器，按 plugin ID、plugin instance ID、Contribution ID 排序，不再分别依赖各自接口返回顺序；隐藏、置灰和 checked 仍统一使用同一个 Context 条件解析器。
- 插件菜单的 `before` / `after` 如果引用同一插件同级的 command 或 submenu 局部 ID，会在注册阶段解析成稳定 Contribution ID；Host 锚点（例如 `asset.rename`）仍保持原值，避免与 Host 菜单定位协议混淆。

自动化证据：

```text
npx vitest run tests/unit/plugin-contributions.test.ts tests/unit/plugin-menu-contributions.test.ts tests/unit/plugin-surface-conditions.test.ts --reporter=dot
# 3 files / 30 tests passed

npx eslint <本次变更的插件注册、Renderer surface 与测试文件>
npm run typecheck -- --pretty false
git diff --check
# 均通过
```

这仍是 `Serpent-fkq3` 的增量，不是完整关闭证据：native/plugin 合并后的单一 `ResolvedMenuTree`、toolbar/Inspector/Viewer 的完整 placement 语义、真实 Electron 菜单旅程和 packaged/Windows/CU 尚未完成或执行。

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

## 2026-08-04：上下文 revision、菜单循环与 Invocation Context

交叉审查又发现三处会让插件入口和实际命令漂移的缺口：Renderer 菜单 Context 默认一直是 revision 1，Host busy 状态恒为 false；父级菜单循环会让整棵树没有 root；命令触发只传 asset/folder/collection ID，没有携带触发时的 browse/viewer/revision 快照。

本次补齐：

- `createPluginMenuContributionContext` 对同一 contextId 按状态签名自动维护单调 revision，并接收当前 busy；菜单条件不再读取固定的假状态。
- 菜单树在建 children 前检测 parentId 环，断开一个确定的冲突父边并记录 `cycle-broken`，其它分支继续 materialize。
- toolbar、Inspector、Viewer 的 checked 条件解析为布尔值并渲染 `aria-pressed`；去掉覆盖共享排序器结果的二次 ID 排序。
- `runPluginMenuCommand` 从 Contribution Context 构造冻结 Invocation Context，携带 contextId、revision、完整有界 selection（含合集 ID）、browse 和 viewer 快照；Main 校验目标库一致后再交给 Standard/Trusted handler。

自动化证据：

```text
npx vitest run tests/unit/plugin-menu-contributions.test.ts tests/unit/plugin-surface-conditions.test.ts tests/unit/plugin-contribution-context.test.ts --reporter=dot
# 3 files / 21 tests passed
npx vitest run tests/unit/plugin-context.test.ts tests/unit/plugin-contract.test.ts tests/unit/plugin-manager-response-parse.test.ts --reporter=dot
# 3 files / 46 tests passed
npm run typecheck -- --pretty false
npx eslint <本次插件上下文、菜单、表面入口及协议文件>
# 均通过
npx vitest run tests/unit/plugin-menu-contributions.test.ts --reporter=dot
# 13 tests passed；覆盖菜单命令触发时 Invocation Context 的冻结快照透传
```

无选择/混合/Viewer 的真实右键旅程、packaged/Windows/Computer Use 仍未执行；`Serpent-gtih` 与 `Serpent-fkq3` 继续保持 `in_progress`。

## 2026-08-04：宿主分组与插件相对定位合并

补齐一个实际的菜单渲染缺口：Asset/Folder 右键菜单由多个 JSX slot 组成，原先逐 slot 过滤贡献。插件 A 声明 `after: B`、B 声明 `group: organize` 时，B 会进入“组织”组而 A 会落到通用插件区，插件间的相对顺序因此丢失；同样的问题也会出现在 `asset.rename` 这类内联宿主锚点的插件链上。

新增 `placePluginMenuItemsAroundHost`，先在完整插件贡献图中按插件 `before`/`after` 边构造连通分支，再把分支统一归并到宿主 group 或 inline anchor，最后对每个 slot 调用同一 `solvePluginMenuPlacement`。实际渲染的非内联宿主锚点会落入对应 group 的 before/after slot，避免“已识别但没有 JSX 插槽”而丢失；宿主锚点优先于插件 group，跨宿主 group 的显式冲突也不会被静默拆散。`AssetContextMenu` 的宿主分组、内联锚点和通用插件区全部复用同一次 placement 结果，隐藏贡献不会因此重新出现。

自动化证据：

```text
npx vitest run tests/unit/plugin-menu-contributions.test.ts --reporter=dot
# 1 file / 18 tests passed

npx vitest run tests/unit/plugin-menu-contributions.test.ts \
  tests/unit/plugin-surface-conditions.test.ts \
  tests/unit/plugin-contribution-context.test.ts \
  tests/unit/plugin-context.test.ts \
  tests/unit/plugin-contract.test.ts \
  tests/unit/plugin-manager-response-parse.test.ts \
  tests/unit/plugin-themes.test.ts \
  tests/unit/plugin-job-display.test.ts --reporter=dot
# 8 files / 80 tests passed

npx tsc --noEmit
npx eslint src/renderer/plugin-menu-contributions.ts \
  src/renderer/AssetContextMenu.tsx \
  tests/unit/plugin-menu-contributions.test.ts
git diff --check
# 均通过
```

`Serpent-fkq3` 仍保持 `in_progress`：当前增量尚未替代完整 native/plugin `ResolvedMenuTree`，真实右键多种菜单面、packaged/Windows 和 Computer Use 仍未执行。

补充验证：

```text
npm run test -- --reporter=dot
# Test Files 322 passed | 3 skipped (325)
# Tests 2814 passed | 8 skipped (2822)
```
