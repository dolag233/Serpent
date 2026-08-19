# 2026-08-19 PDF 查看器百叶窗与 IME 关窗

> 关联：`Serpent-8ca259`、`Serpent-fb30ca`、验收 `VIEWER-029` / `FILTER-027`

## PDF 查看器（百叶窗）

用户在 17 页 PDF 上看到一排圆角细条。探针 DOM 正常（17 wrap、0 占位符、canvas 位图完整），但视觉仍是百叶窗。

根因：`.pdf-viewer-pages` 是纵向 flex；子项默认 `flex-shrink: 1`。17 页被压进视口高度，wrap 再 `overflow: hidden` + `border-radius`，看起来就是被裁切的圆角条纹。探针量到的 canvas CSS 高度是元素自身盒子，不是被裁切后的可见高度，所以会「量起来正常、看起来是百叶窗」。

修复：

- 页 wrap 使用 `--pdf-page-height` 作为明确像素 `height` / `min-height` / `flex-basis`，不再依赖 flex 里的 `aspect-ratio`（`min-height: 0` + `overflow: hidden` 仍会把纸面压成圆角细条）
- 页宽 100% 铺满查看区，高度随比例，列超出后在 `.pdf-viewer-pages` 内滚动
- `.preview-content.is-document-mode { place-items: stretch }`，文档查看器铺满舞台
- 等宿主有宽度后再按该宽度渲染，窗口缩放时重算页盒

## IME（微软拼音过滤标签关窗）

标签过滤面板在拼音组合阶段关闭。根因是悬停浮层把 IME 候选窗当成「指针离开 / 失焦 / Escape」：

- `focusout`/`pointerout` 的 `relatedTarget === null`（候选窗是独立 HWND）
- 组合中的 Escape / keyCode 229 / `key === "Process"`

抽出 `ime-safe-dismiss.ts`，过滤条在组合期间不关；对话框 Escape、右键标签选择器、Inspector 加标签、侧栏重命名等同类关闭路径一并跳过 IME 键。

## 测试

定向：

```bash
npx tsc --noEmit
npx vitest run tests/unit/pdf-viewer-layout.test.ts
```

`pdf-viewer-layout` 4 项通过；`tsc --noEmit` 通过。

Electron E2E `tests/e2e/document-preview.test.ts`：多页 fixture 曾把对象编号写成 `offsets.length`（第一页变成 `2 0 obj`，Root `1 0 R` 不存在 →「无法加载 PDF」）。已改为从 `1` 起编号。

```text
npx tsc --noEmit
npx vitest run tests/unit/pdf-viewer-layout.test.ts   # 4 passed
npx vitest run tests/unit/ime-safe-dismiss.test.ts    # 4 passed
node scripts/run-e2e.mjs tests/e2e/document-preview.test.ts
# 3 passed (13.1s)：多页 PDF 布局 + 单页 PDF + HTML iframe
```

## 未执行

真实 17 页 PDF 人工查看、微软拼音真机、packaged、`test:library-availability`（本增量未改 library-service）。
