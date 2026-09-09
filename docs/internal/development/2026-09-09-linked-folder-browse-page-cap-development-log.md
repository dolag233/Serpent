# 链接文件夹递归浏览停在约 100 项（Serpent-9cfc8c）

## 问题

单个链接文件夹在磁盘和库内有数百个可见资产。打开「递归显示子文件夹内容」后，画布只出现首页约 100 张，其余看不到，也无法选中。

## 根因

Worker 的 `createBrowseSession` / `layoutOnly` 会返回完整 COUNT。问题在 Renderer 的非虚拟化浏览（范围 < 2000）：

1. 首屏把 100 条 summary 写成 compact `browseLayout`，Masonry/Justified 把这份 layout 当作完整几何索引。
2. 全量 `layoutOnly` 返回前，`shouldRunBrowseSentinel` 因 `layoutHydrationComplete === false` 不追加页面。
3. 该请求一旦失败或一直不落地，layout 永远停在 100 条。即便哨兵后来拉到后续页，多出来的 summary 也不进入画布（`layout.length > 0` 时不用 `assets` 兜底）。
4. 哨兵在「完整 layout」假设下会跳到最后一页，而不是按 100、200 顺序补齐。

## 修复

- 首屏条目少于 `total` 时，不要把首页当成完整 layout。
- 非虚拟化范围立刻允许哨兵；layout 未覆盖全程时按下一个未填充 offset 顺序加载。
- 画布用 `resolveBrowseCanvasLayout`：过期的首页 layout 会与已加载 summary 合并，完整 layout 仍然优先。

## 验证

- `tests/unit/browse-window-slots.test.ts`：不完整 layout / 顺序 offset。
- `tests/worker/linked-folders.test.ts`：150 个链接资产、递归 session 第二页、layoutOnly 长度。
- 真实 Electron / packaged 未执行，见验收清单 LINKED-BROWSE-001。
