# 鼠标快捷操作提示审计

审计任务：Serpent-idedb。产品源码基线：2e5e7269。用户指定 Luna xhigh 扫描，主 agent 核对关键来源并整理本报告。当前工具不提供独立 fast 参数。

本轮为静态、只读审计；没有修改交互或提示，没有启动应用、运行测试或生成媒体产物。下列遗漏仅指已检查的实现、相邻界面提示和用户指南，不能视为完整运行时视觉验收。

## 已核实的改进点

| 优先级 | 位置与真实操作 | 当前提示及问题 | 建议与证据 |
| --- | --- | --- | --- |
| P2 | 标签过滤建议的点击、Shift 点击与右键 | 底部确实已有「左键选择、右键排除、Shift 多选」，不能说完全无提示。它未区分选择模式与默认表达式模式；后者实际补全/替换词项，Shift 添加 OR 分支，右键添加排除词项 | 按模式同步底部提示与问号帮助，特别说明 Shift 的表达式效果。实现 `src/renderer/FilterTagPicker.tsx:206`，问号 `:269`；常驻提示 `src/renderer/DimensionFilterBar.tsx:793`，文案 `src/renderer/i18n/catalogs/zh-CN.ts:449`、`en.ts:462` |
| P2 | 3D 环境光方向：右键拖动或 Ctrl+左键拖动 | 工具栏只有环境光选择器，普通用户指南没有写明旋转光源的手势 | 在环境光控件的标准提示或帮助中说明。匹配的是 ctrlKey，macOS 也不能擅自标成 Command。实现 `src/renderer/3d-viewer/environment-rotation-gesture.ts:16`、`viewer-surface.tsx:255`；工具栏 `viewer-toolbar.tsx:149`，指南 `docs/user-guide/basics.md:123` |
| P2 | 视频/音频进度、倍速和音量控件的滚轮操作 | 对应控件主要只有名称或 ARIA 文案，未说明滚轮会跳转、调整倍速或音量；设置固定手势清单只泛写滚动与缩放 | 在对应控件复用标准 hover 提示，并按实际设置表达跳转行为。实现 `src/renderer/VideoPlayerControls.tsx:471`、`AudioPlayerControls.tsx:272`、`VideoPlaybackRateSelect.tsx:56`、`ViewerVolumeControls.tsx:52`；设置 `AppSettingsShortcutsPage.tsx:633` |
| P2 | 资产拖放时按住 Alt/Option 切换复制 | 拖拽影像的加号表达结果，没有说明触发方式；指南缺少修饰键复制说明 | 在拖放相关帮助/状态提示写明平台修饰键。实现 `src/renderer/asset-drag-drop.ts:11`、`:85`、`App.tsx:15660`；加号 `asset-drag-preview.ts:24`，指南 `docs/user-guide/basics.md:101` |
| P2 | 辅助区域的多选：侧栏文件夹、标签管理与 Inspector 标签 | 主画布多选已有指南，但侧栏 Ctrl/Command 点击、标签管理范围/切换选择、Inspector 的 Shift 范围/框选缺少局部可发现提示 | 使用适合该场景的帮助提示，不能复制已过时的 Inspector Ctrl 单击取消选择说明。实现 `src/renderer/NavigationSidebar.tsx:2163`、`TagManagementWorkspace.tsx:369`、`InspectorPanel.tsx:1297`、`use-tag-marquee.ts:25`；标签管理 hover 仅提示双击 `TagManagementWorkspace.tsx:395` |

## 已正确提示与产品决定

- Inspector 标签过滤右键菜单已显示 Ctrl/Command 加鼠标左键图标，处理器使用对应平台修饰键，菜单动作一致。`src/renderer/InspectorTagChip.tsx:26`、`:69`、`:92`。这是固定鼠标手势，不属于可自定义键盘绑定，无须因 runtime shortcut 设置而改写。
- 图片/视频查看器中键平移在设置和指南中有记录；规范明确要求不在查看器里额外写中键提示，故不是遗漏。`docs/internal/ui/0003-keyboard-shortcut-ux-principles.md:89`、`:99`。
- 选择模式的过滤维度 Shift 多选已有底部提示与指南。`docs/user-guide/search-and-filters.md:56` 及英文对应段落。
- 浏览器扩展拖拽保存已有指南。`docs/user-guide/browser-extension.md:32`。
- 未确认鼠标侧键的运行时/平台提示不一致，不能仅因允许绑定侧键就声称存在错误。

3D 镜头平移属于单独的规格疑点：旧规格要求右键平移（`docs/internal/implementation/0030-3d-model-preview-slice.md:43`），当前右键用于旋转环境光，中键为 dolly，验收队列仍提及平移（`docs/internal/qa/human-acceptance-checklist.md:1262`）。本轮不判定它只是提示问题；应确认现行产品决定后再决定改实现或规格。

## 覆盖与后续建议

静态检查覆盖浏览与选择、侧栏、过滤器、Inspector、标签管理、图片/视频/音频/PDF/3D 查看器、工作区鼠标侧键、自定义快捷键设置及浏览器扩展相关实现/说明。没有验证设备差异、tooltip 遮挡、前台焦点、macOS 输入映射或发布包。不能声称所有快捷操作均已在真实应用逐项验证。

建议优先补全播放器滚轮提示和 3D 环境光手势，再处理标签模式说明与拖放/局部多选。复用 HoverTipHost、ContextMenuItem 的 ReactNode shortcut 栏和 Icon；当前只有 mouse-left 图标，后续按实际需要统一添加右键、中键与滚轮。避免把每个普通点击都堆成说明文字。

审计完成，以上为后续修改建议，本轮没有实施这些修改。相关代码测试沿用已提交标签修复的证据；仅新增审计文档和任务记录，不新增测试或人类验收条目。
