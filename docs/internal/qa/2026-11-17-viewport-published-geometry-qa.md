# 可见窗口几何与挂载通知 QA

关联 `Serpent-f4622e`，仅本轮Renderer增量。主agent负责串行真实验证；[完整开发记录与四列追溯](../development/2026-11-17-viewport-published-geometry.md)、[设计](../implementation/2026-11-17-viewport-published-geometry.md)、[独立审查](../reviews/2026-11-17-viewport-published-geometry-review.md)。

- 定向5文件34单测通过，含缺notify的确定性RED/GREEN、三种stale owner的3RED/GREEN；局部lint0errors/1既有warning。
- 最后typecheck仅既有CLIP四错，未宣称全仓通过；未跑无关Worker、资源库底线、20k、全量或发布门禁。
- 真实授权源仅链接读取，隔离catalog/profile；最终当前Renderer `8871687329288078e2bf698733704ffb14aa324dc8e262bc8804c4c9204839f6`。
- 无计数普通两源旅程通过（29.5/25.5秒），4次远跳、原生wheel实际1600px、创建、末页25/25与30/30真实解码。
- 最终强化parity两源通过（29.6/23.3秒），平铺/瀑布流各顶部/中段/底部，每点当前图片≥90%解码；91次同步报告/2133比较项及12个checkpoint均0差异。
- 上版几何绿但部分0decoded的测试漏洞与三次通知缺口失败均保留在开发记录；最终未使用合成scroll诊断干预。
- 本轮所有新建测试数据、输出和控制脚本清理完成，最终工作区Electron0。历史受阻目录不在本次清理范围。
- 本轮新增行与新文件的定向本机路径/已知私有标识/凭据模式扫描0命中；不是全仓提交脱敏门禁。最终Git状态已核对，保留原有其他轨道修改，没有stage、commit或push。

读取冗余约减少95%～96%；无计数帧P95 A10.9→10.5ms、B21.3→21.9ms，**不能判为稳定FPS改善**。GPU隐藏捕获有仪器和运行时cadence差异，不是前台OS显示帧率。

`CANVAS-VISIBLE-045` 待用户验收。未操作前台Computer Use（用户明确不需要）；caption/缩放/选择外观、当前并发切库、packaged、macOS、长期原实例未验证。用户要求本增量完成后停止，整体性能任务保持未完成并暂停；不提交或推送。
