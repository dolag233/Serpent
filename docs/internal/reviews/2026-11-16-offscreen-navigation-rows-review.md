# 普通目录行按需渲染审查

范围为 `Serpent-7582e4` 的NavRow class和CSS，沿用同一名独立Luna完成Standards/Spec静态核对，不审查其他累计改动。

未发现静态产品阻断。class仅加在普通NavRow外层，另外三个编辑wrapper和合集递归外壳不受影响；只用既有行高token，不新增颜色/尺寸fallback。行高28px与占位一致，22px disclosure不会扩大外层高度。

`:focus-within`和`data-insert-edge`匹配实际状态，覆盖优先级有效，没有后续同属性覆盖。它们对移除paint containment、保留外扩焦点及插入线是必要的，不能删去。popover通过body portal，不位于该行的containing context中。

审查保留真实跨屏Tab及辅助技术边界。主agent随后完成当前构建真实交互：1,045行中961行内容实际跳过，focus/Tab/定位、托管目录F2、插入线事件和25/25图片解码通过。同构建四轮可见/auto交叉对照也通过，滚动p95中位数55.7→46.35ms；样本少且仍卡顿，不能宣称宏观性能完成。四秒滚动用程序化scrollTop，原生输入、前台、OS drop、辅助技术和packaged/macOS未验证。

证据、先前不理想的普通旅程及完整限制见[开发记录](../development/2026-11-16-offscreen-navigation-rows.md)。未用户验收、未提交推送。
