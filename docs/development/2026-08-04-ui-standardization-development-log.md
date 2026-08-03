# UI 标准化开发日志（2026-08-04）

## Foundation：token 与 layer contract

### 本次范围

本阶段只建立 Renderer UI library 的基础契约，没有修改 `styles.css`、`main.tsx` 或业务组件，也没有实现 React primitive。新增：

- `src/renderer/ui/tokens.css`：以 `--ui-*` 命名的语义 token，继承现有 Studio Contact Sheet 的紧凑桌面工作台方向；
- `src/renderer/ui/foundation.ts`：供后续 primitive 使用的纯类型、CSS 变量映射和 layer 常量。

### 设计决定

1. token 按 surface、content、border、action、status、geometry、typography、elevation、layer 分类；新 UI 不应继续新增页面私有颜色或阴影。
2. dark 是默认主题，`[data-theme="light"]` 覆盖同一组语义变量；token 依靠 CSS 继承传递到后代，允许明确的嵌套主题边界。
3. layer 只使用 `base → shell → sticky → menu → popover → activity → notice → modal-backdrop → modal → tooltip` 这组命名层级。后续组件应通过 `UI_LAYER` 或 `layerCssVar()` 选择层级，不再自行写 z-index 数字。
4. `foundation.ts` 不依赖 React、DOM、插件 registry 或业务模块，避免基础层反向依赖应用表面。
5. 当前不改旧 token；迁移由后续 primitive/surface 工单完成。`tokens.css` 目前是独立契约，接入应用入口时需要单独验证加载顺序和主题属性位置。

### 自测与风险

- `npx eslint src/renderer/ui/foundation.ts`：通过。
- 隔离 TypeScript 编译：通过；仓库级 `npx tsc --noEmit` 当前被其他 agent 同时产生的未跟踪 primitive/test 文件中的既有类型错误阻断，错误不在本阶段写入文件内。
- CSS 结构检查：通过；主题块允许同名 token 在 light/dark 中覆盖，未发现单个主题块内重复声明或未配对括号。
- 未执行全量 Electron/E2E：本阶段无业务行为变更，且 token 文件尚未接入应用入口。
- 风险：现有 `styles.css` 仍拥有旧 token 和历史 z-index；在迁移完成前，两套契约会并存。后续必须按 layer contract 逐步替换，不能只导入 token 文件就宣称全应用统一。
