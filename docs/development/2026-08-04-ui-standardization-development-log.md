# UI 标准化开发日志（2026-08-04）

## Foundation：token 与 layer contract

### 本次范围

本阶段先建立 Renderer UI library 的基础契约，再接入第一批 primitive 和一个真实设置调用方；没有重写 `styles.css` 或大面积迁移业务组件。新增：

- `src/renderer/ui/tokens.css`：以 `--ui-*` 命名的语义 token，继承现有 Studio Contact Sheet 的紧凑桌面工作台方向；
- `src/renderer/ui/foundation.ts`：供后续 primitive 使用的纯类型、CSS 变量映射和 layer 常量。
- `src/renderer/ui/primitives/`：Button、IconButton、Field、TextField、Switch、Select、Progress、Tooltip；
- `src/renderer/ui/patterns/`：DialogShell、ModalStack、MenuSurface，以及递归菜单 resolve/focus boundary helper；
- `src/renderer/ui/ui.css`：只消费 `--ui-*` token 的基础组件样式；
- `src/renderer/ui/index.ts`：内部 library 统一导出入口。

### 设计决定

1. token 按 surface、content、border、action、status、geometry、typography、elevation、layer 分类；新 UI 不应继续新增页面私有颜色或阴影。
2. dark 是默认主题，`[data-theme="light"]` 覆盖同一组语义变量；token 依靠 CSS 继承传递到后代，允许明确的嵌套主题边界。
3. layer 只使用 `base → shell → sticky → menu → popover → activity → notice → modal-backdrop → modal → tooltip` 这组命名层级。后续组件应通过 `UI_LAYER` 或 `layerCssVar()` 选择层级，不再自行写 z-index 数字。
4. `foundation.ts` 不依赖 React、DOM、插件 registry 或业务模块，避免基础层反向依赖应用表面。
5. 当前不删除旧 token；迁移由后续 surface 工单完成。`main.tsx` 已在旧 `styles.css` 后加载新的 token/style 文件，旧业务 UI 仍由兼容层渲染。
6. Menu/Dialog pattern 目前是 headless 语义契约，不替换既有菜单定位、portal、roving keyboard 和 dialog focus controller；先避免抽象层反向改变成熟业务行为。
7. 插件仍不能依赖这些 React 组件、DOM 或 CSS；后续 semantic descriptor 必须通过 Host adapter 映射到内部 library。

### 本阶段补强

- 新 token 的 accent 通过现有 `--accent` 语义变量继承用户自定义强调色；危险操作和 Switch 阴影也改为 token，不在组件 CSS 中留下页面级颜色/阴影。
- `Switch` 同时支持受控与非受控模式，并保持 `aria-checked` 与真实状态同步。
- `Tooltip` 继续复用既有 `HoverTipHost`，但现在为 focus/hover 统一调度提示，并通过稳定 ID 提供 `aria-describedby`；`Field` 转发 `data-*`/ARIA 属性，保证复合组件不会吞掉语义属性。
- `DialogShell` 只允许标记为 topmost 的实例消费 Escape，并阻止事件继续冒泡；实际 focus trap、恢复和 inert 仍由现有宿主控制器/后续 `ModalStack` surface 负责。

### 自测与风险

- `npx eslint src/renderer/ui src/renderer/main.tsx src/renderer/AppSettingsPages.tsx tests/unit/ui-foundation.test.ts tests/unit/ui-primitives.test.ts tests/unit/ui-patterns.test.ts`：通过。
- `npm run typecheck`：通过。
- `npx vitest run --config vitest.config.ts tests/unit/ui-foundation.test.ts tests/unit/ui-primitives.test.ts tests/unit/ui-patterns.test.ts tests/unit/plugin-settings-sections.test.ts`：4 files / 17 tests passed。
- `npm run lint`：通过。
- `npm run test`：321 files（318 passed / 3 skipped），2,775 tests（2,767 passed / 8 skipped）。
- `git diff --check`：通过。
- CSS 结构检查：通过；主题块允许同名 token 在 light/dark 中覆盖，未发现单个主题块内重复声明或未配对括号。
- 定向 Electron E2E：`node scripts/run-e2e.mjs tests/e2e/plugin-management.test.ts tests/e2e/plugin-unrestricted-settings-pages.test.ts tests/e2e/shell-navigation.test.ts`，3 passed（插件设置迁移、插件贡献/设置页恢复、Shell 导航）。期间发现并修正了旧 `checkbox` 查询与 Tooltip 属性透传问题。
- 本阶段尚未运行全量 `npm run test:e2e` 或 Computer Use；仍需在更大范围 UI surface 迁移后集中执行。插件管理页的启用 toggle、现有菜单定位/roving keyboard、其他对话框仍保留旧业务实现，不能据此宣称全量 UI 已统一。
- 风险：现有 `styles.css` 仍拥有旧 token 和历史 z-index；在迁移完成前，两套契约会并存。后续必须按 layer contract 逐步替换，不能只导入 token 文件就宣称全应用统一。
