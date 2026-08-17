# Input Capture Probe

固定的标准插件探测器，用于验证 `serpent.input.capture` 的 application 键盘捕获
和 IME composition 事件。插件收到最多 8 个事件后自动释放；按应用捕获保留的
Escape 也会触发 Host 侧释放。

事件通过插件存储写入 `.serpent/plugin-data/`，便于人工验收时检查。
