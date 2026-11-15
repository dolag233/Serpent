# 面板开关和分隔线对齐

Serpent-ojr18。用户要求右侧栏开关左缘对齐右侧栏，拖拽分隔线居中于缝隙并去掉 tooltip。

根因：展开 Inspector 的 toolbar cluster 沿用 island-gap 左内边距，而 Inspector 本体已改成左边无 margin；固定定位的分隔线仍居中于 grid 列边界，没有计入 workspace 两侧的 gap。

修正：展开 Inspector 的开关 cluster 左内边距归零。展开的左右 resizer 分别复用 island-gap 向右/左平移半个缝隙；折叠后的边缘恢复手柄位置保持现有规则。移除四个拖拽/恢复手柄的 data-hover-tip，保留 aria-label 和 separator 语义。拖动逻辑、命中宽度和旧布局不改。

后台 Edge 加载当前完整 CSS 的合成三列布局：左缝中点与拖拽线中心均为 227px，右缝与线中心均为 929px；开关按钮和 Inspector 左缘均为 932px。检查为内存夹具，无截图或媒体文件。git diff --check 通过。纯界面位置/提示调整，不运行 Worker、资源库或 Electron 套件。

| 需求 | 实现 | 检查 | 人工证据 |
| --- | --- | --- | --- |
| 开关及分隔线对齐，去 tooltip | styles.css 的 Islands 面板规则；App.tsx 的 resizer 属性 | 后台浏览器几何检查通过，tooltip 属性已移除 | DOCK-ALIGN-024 待验收；真实应用、macOS、packaged 未执行 |

用户确认最终界面验收通过并授权提交推送；对应验收清单已更新，平台未执行项保持原记录。
