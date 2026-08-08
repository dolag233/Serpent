# 2026-07-19 过滤维度按钮 toggle/hover + 多选覆盖/OR 语言 开发日志

## 工单

- `Serpent-yp7`（REQ-FILTER-021）：维度按钮单击 = 启用/关闭该维度过滤；悬停 = 打开该维度设置面板。
- `Serpent-f86`（REQ-FILTER-025）：同维度多值过滤语言统一——默认点击 = 覆盖当前选择；Shift+点击 = OR 追加；跨维度仍 AND。

裁决原文见 `docs/internal/implementation/mvp-ui-ux-requirements-backlog.md` 第五批「C. 过滤交互裁决」第 1、2 条。

## 范围与所有权

仅改动过滤条相关代码：`src/renderer/DimensionFilterBar.tsx`、`src/renderer/FilterTagPicker.tsx`，新增两个纯逻辑模块。未触碰 `App.tsx`、文件夹卡片、查看页；未 commit、未 `bd close`。

## 实现

### 新增模块（供 DimensionFilterBar 复用，避免文件继续膨胀）

- `src/renderer/dimension-filter-selection.ts`：
  - `applyDimensionSelectionClick<T extends string>(current, value, shiftKey)` — 通用同维度多值点击解析：不按 Shift 时覆盖为 `[value]`（若 `value` 已是唯一选中项则清空，呼应既有的单预设 toggle 语言）；按 Shift 时在现有选择基础上增删 `value`。供颜色、评分、格式、标签复用。
  - `formatTokensHas` / `toggleFormatToken`：格式维度原本内联在 `DimensionFilterBar.tsx` 的两个私有函数搬出并加 `shiftKey` 参数，语义同上（大小写不敏感）。
- `src/renderer/dimension-enable-toggle.ts`：
  - `DimensionEnableToggle<T>`——纯 class（非 hook），每个维度一个实例（存在 `useRef` 里跨渲染保活）。`toggle(active, current, cleared, apply)`：维度当前启用时记住 `current` 并把值清空（`apply(cleared)`）；维度当前关闭且有记住的值时恢复它（`apply(remembered)`）；关闭且什么都没记住则是 no-op。用 class 而非 hook 是为了在不依赖 React Testing Library 的前提下可被 vitest 直接单测（仓库现有过滤类测试全部是纯函数/纯 class 风格，无 RTL 依赖）。

### `DimensionFilterBar.tsx` 改动

- **REQ-FILTER-021**：颜色/标签/形状/评分/格式/更多六个维度按钮的 `onClick` 从「切换面板开合」改为调用各自的 `DimensionEnableToggle`，清空或恢复该维度的实际过滤值（颜色、标签走 `onTagNamesChange`、形状 range、评分、格式各自的 setter；「更多」维度一次性打包 favorite/sourceUrl/availability/四个数值 range 八个字段一起清空/恢复，因为它们共享同一个维度按钮）。
- 面板开合（`openDimension`）改为**悬停**驱动：新增一个 `useEffect`，在过滤条根节点上监听 `pointerover`/`pointerout`/`focusin`/`focusout`（原生事件，冒泡），用 `event.target.closest("[data-dimension]")` 定位悬停/聚焦所在的维度，离开时启动 150ms 关闭延时（吸收按钮与面板之间的几像素间隙，避免移动鼠标时闪烁关闭）。六个维度容器 div 上新增 `data-dimension="color"` 等标记。
  - **为什么不直接在 JSX 上挂 `onMouseEnter`/`onMouseLeave` 闭包**：最初实现是这样写的，但会触发本仓库启用的 `react-hooks/refs`（"Cannot access refs during render"）——因为这些内联闭包读取了一个 `useRef` 计时器。改为完全放进 `useEffect`（与文件顶部已有的「外部点击关闭 + Esc 关闭」effect、以及 `hover-tip.tsx` 的文档级监听同一套约定）后彻底消除该 lint 错误，且逻辑更集中。
  - Escape 关闭、外部点击关闭两个既有 effect 未改动，继续生效。
  - 新增 `focusin`/`focusout` 让 Tab 键盘聚焦也能打开面板，避免悬停化之后键盘可达性回归（原点击开合天然可达）。
- 颜色/评分/格式的选项点击处理函数新增 `shiftKey` 参数，改为调用 `applyDimensionSelectionClick`（颜色、评分）或 `toggleFormatToken`（格式，含大小写不敏感与逗号字段兼容）。默认点击覆盖为单选，按住 Shift 才在已选基础上增删。

### `FilterTagPicker.tsx` 改动

- 建议/搜索列表里点击标签（或 Enter 键）的 `add` 函数改用 `applyDimensionSelectionClick`，同样支持 `shiftKey`：不按 Shift 点击会把当前标签过滤替换为只有这一个标签；按住 Shift 才累加多个。移除标签的 chip `×` 按钮语义不变（始终精确移除该项，不受修饰键影响）。

## 明确不动的部分（避免过度实现）

- **形状/宽高比/分辨率预设 chips**（`FilterPresetChips` + `togglePresetRange`）未接入 Shift 语言：这些是「范围」而非离散多值 token 集合，同一个 min/max 字段本身无法表示两个预设的 OR（没有既有的多范围 schema），维持原「点击替换/再点清空」行为，不属于本次裁决覆盖的「同维度多值」场景。若产品后续要求形状维度也能多范围 OR，需要先扩展底层查询 schema，超出这两张工单范围。
- `SortModeControl`（排序控件）虽然共享 `.dimension-filter-dim` class 名，但不是过滤维度，未受悬停/toggle 改动影响，仍是点击开合面板。
- 未改动查询/AND-OR 组合逻辑本身（worker 端跨字段 AND、字段内值 OR 早已如此实现），只改了 UI 侧「点击时如何构造这一组值」。

## 测试

- 新增 `tests/unit/dimension-filter-selection.test.ts`（10 例）：覆盖默认覆盖、覆盖后清空唯一项、Shift OR 累加、Shift 移除已选项、格式字段大小写不敏感等。
- 新增 `tests/unit/dimension-enable-toggle.test.ts`（5 例）：覆盖启用→记住并清空、关闭→恢复、无记住值时 no-op、多轮启停记住最新值、恢复后二次关闭不重放旧值。
- 命令与结果：

```
npx vitest run --config vitest.config.ts tests/unit
# Test Files  90 passed (90)
#      Tests  855 passed (855)
```

（含既有 `active-discovery-filters` / `filter-presets` / `color-filter-presets` 等回归测试，全部保持绿）。

- `npx eslint src/renderer/DimensionFilterBar.tsx src/renderer/FilterTagPicker.tsx src/renderer/dimension-enable-toggle.ts src/renderer/dimension-filter-selection.ts tests/unit/dimension-enable-toggle.test.ts tests/unit/dimension-filter-selection.test.ts` → 0 错误（修复前曾报 `react-hooks/refs` 12 处错误，已通过上述重构消除）。
- `npm run typecheck` → 本次改动的文件 0 错误。仍报 `src/renderer/MoveDialog.tsx(68,46)`（`directAssetCount` 缺失）一条错误，经确认该文件本会话未被任何人改动（`git status` 无差异），是仓库既有基线问题，与本工单无关，不在本次范围内修复。（App.tsx 当时并行有另一 agent 的未提交改动，过程中一度出现的 `previewScrollPositionRef` 错误已由对方在本会话期间自行修复，本次改动完全未涉及 App.tsx。）

## 未执行/遗留

- Computer Use / 真实 Electron 悬停与 Shift+点击手感验收未执行（当前环境无桌面控制能力），需要移交人工 QA 或具备 Computer Use 能力的 agent：
  - 悬停开合面板的实际手感（150ms 关闭延时是否合适、跨维度快速移动是否有闪烁）。
  - 单击启用/关闭的视觉反馈是否清晰（按钮从 `is-active` 变为非激活态，用户是否能理解这是「暂时关闭」而非「清空」）。
  - Shift+点击的可发现性——纯键盘修饰键交互没有 UI 提示，产品是否需要在面板里加一行说明文案（未在两张工单文字中出现明确要求，暂不新增）。
- FILTER-009（多标签过滤）验收步骤已同步更新为「Shift+点击追加」，但尚未有人类重新走一遍新步骤；已在清单标注。
- 「更多」维度按钮把 8 个字段（favorite/sourceUrl/availability+exclude/四个数值 range）打包一起启停；若产品后续希望这些子字段可以分别独立开关，需要拆分维度按钮，超出本次裁决范围。
