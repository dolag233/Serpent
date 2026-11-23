# 画布测量与重排所有权审查

范围：本次 `viewport-window` observer生命周期、`canvas-reflow-restore` session终结、preview-return interruption与App接线，以及直接测试。实现涉及同一性能目标的两个Renderer增量，不扩展到其他Worker、RAW、CLIP或队列改动。

审查者：一名独立Luna，沿用用户已授权的模型；Standards与Spec同次审查，主agent汇总其结论及随后真实测试证据。没有用户验收、packaged/macOS或前台结论。

## Standards

未发现具体阻断。viewport稳定监听和committed callback发布分离，cleanup保留owner检查。重排session以frameRef为键，清理RAF、输入监听和ref，终结通知至多一次；静默替换不会让旧callback清掉新owner。通知取消的reentrant callback可开始新session，旧收尾不会再次取消它。

preview-return交接抽独立helper；先使旧generation失效，置空cancel ref、取消browse/focus恢复、清closing id与hold，再同步重置UI恢复状态。App仅负责连接既有恢复入口；没有新增主题样式、数据库或跨进程能力。测试和记录不包含真实素材名称、路径或凭据；新测试目录清理，不触碰原素材。

## Spec

未发现具体阻断。无anchor/hold拒绝的新尝试现在有终态，打开中的viewer不能被浏览重排接管；显式卡片/面板操作能接管关闭后的preview保护，随后捕获新anchor。自动width observer仍遵守preview hold。单测覆盖新callback同key、取消/替换/通知次数、监听清理、viewer-open与generation顺序。

独立静态审查结束时最终当前构建E2E尚待完成。随后主agent核对真实probe末端断言结果：28,930项隐藏Windows Electron、两布局底部非序列JPEG/PNG实际解码、返回近底部、缩放自然显示。该证据补入[开发记录](../development/2026-11-16-preview-reflow-ownership.md)，不倒写成审查者当时已运行E2E。此前一次未获取诊断的viewer超时仍不能按重跑通过关闭，动画/序列未因此覆盖。

## 保留项

不声称完整优化。UpdateLayoutTree总耗时近似不变，CPU样本归类变化不等于总量下降。原生clamp精确交错未单独注入；原用户实例同负载、动画/序列、packaged/macOS未验证。全仓typecheck仍有4项其他CLIP轨道错误。相关Renderer单测与真实probe范围见开发记录；不运行无关Worker或资源库门禁。
