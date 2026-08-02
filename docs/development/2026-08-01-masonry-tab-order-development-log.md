# 2026-08-01 瀑布流键盘顺序开发记录

> 工单：`Serpent-c8yc`。本记录覆盖瀑布流资产卡片的 Tab/Shift+Tab 顺序，不代表 Windows/macOS 人工验收通过。

## 需求与实现

瀑布流为了保持列布局，DOM 按列渲染；浏览器原生 Tab 因此会走列优先（例如 A、D、B、E、C），与用户看到的从左到右、从上到下顺序不一致。资产卡片现在在瀑布流模式拦截 Tab，并按当前可见资产数组的视觉阅读顺序将焦点移动到下一/上一张卡片；边界处放行原生 Tab 以离开画布。平铺模式和原地重命名输入保持原行为。

实现位置：`src/renderer/App.tsx`、`src/renderer/masonry-focus-order.ts`。顺序解析抽为纯函数，避免把新的键盘状态逻辑继续塞入巨型组件。

## 当次验证

- `npm run typecheck`：通过。
- `npm run lint -- --quiet`：通过。
- `npx vitest run --config vitest.config.ts tests/unit/asset-grid-layout.test.ts`：12/12 通过。
- 后台 Electron：`node scripts/run-e2e.mjs tests/e2e/selection-marquee.test.ts --grep=masonry.Tab.follows`：1/1 通过，真实瀑布流中 Tab 从 `marquee-00.txt` 到 `marquee-01.txt`，Shift+Tab 返回。

## 已知范围

- 真实 Windows/macOS 人工操作尚未执行；验收清单保持“待人类验收”。
- 本条 E2E 使用文本资产作为选择顺序夹具，避免媒体缩略图解码干扰键盘顺序验证。
