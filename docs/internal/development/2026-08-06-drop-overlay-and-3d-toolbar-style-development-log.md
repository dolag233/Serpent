# 2026-08-06 拖拽提示与 3D 工具栏样式修复记录

## 用户反馈

- 文件拖拽导入提示使用大面积浅色背景，遮挡底下的资产预览；要求透明。
- 3D 查看器中环境光控件与显示模式下拉控件外观不一致；HDRI 选择器左对齐时可能与其他 toolbar 控件重叠。

## 实现

- `src/renderer/styles.css`
  - `.external-drop-overlay` 移除主题色 wash 和 `backdrop-filter`，改为主题画布色
    50% 不透明度的半透明背景；
  - 保留虚线边框、图标和提示文案作为拖拽状态指示。
- `src/renderer/3d-viewer/viewer-surface.css`
  - HDRI 触发器统一采用显示模式 select 的高度、边框、圆角、背景和字号；
  - 环境光控件设为相对定位容器；
  - HDRI picker 改为右侧锚定，避免以 toolbar 左边界为定位基准造成重叠；
  - 环境光名称保持单行省略。

## 验证

```text
node scripts/run-e2e.mjs tests/e2e/model-viewer.test.ts
```

结果：`3 passed (13.5s)`，包含环境光/显示模式 computed style 一致性断言、HDRI 预览实际解码和切换名称验证。

`external-drop-overlay` 的 50% 半透明背景属于 CSS 视觉变化，需通过真实 Finder/资源管理器拖拽进行人工确认。
Computer Use、packaged 和 Windows 尚未执行。

