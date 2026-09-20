# 资产卡片标题区底部留白收紧

日期：2026-09-20

工单：`Serpent-c2e8fb`

## 问题

字体卡片反馈通过后，用户继续发现图像、视频和字体卡片的预览下方仍有明显的标题区底部空白。这个空白与是否显示分辨率字段无关，来自标题区固定的底部内边距；平铺和瀑布流的几何计算也使用同一组标题区度量。

## 修改

- `.asset-caption` 的底部内边距从 8px 收紧为 4px，保留文件名与元数据之间的间距和顶部呼吸空间。
- `asset-caption-band`、`justified-caption-band` 与画布布局常量同步更新，瀑布流两行/三行标题区分别从 42/56px 调整为 38/52px，平铺三行标题区从约 58px 调整为 54px。
- 补充紧凑度量的单元测试，确保两种布局的虚拟几何与实际 CSS 不漂移。

## 验证

```text
npx vitest run tests/unit/asset-caption-band.test.ts tests/unit/justified-caption-band.test.ts tests/unit/canvas-asset-layout.test.ts tests/unit/virtual-browse-canvas.test.ts tests/unit/masonry-preview-frame.test.ts tests/unit/asset-grid-layout.test.ts
通过：6 个文件，57 passed。

npm run typecheck
通过（退出码 0）。

npx eslint src/renderer/asset-caption-band.ts src/renderer/canvas-asset-layout.ts src/renderer/justified-caption-band.ts tests/unit/asset-caption-band.test.ts tests/unit/justified-caption-band.test.ts tests/unit/virtual-browse-canvas.test.ts
通过（退出码 0）。
```

真实窗口、packaged、Windows 和 Computer Use 视觉验收待用户复验。
