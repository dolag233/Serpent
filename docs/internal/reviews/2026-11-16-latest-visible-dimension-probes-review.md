# 当前可见尺寸探测：独立双轴审查

工单 `Serpent-00a35e`。单一独立 Luna xhigh 审查者，只读同时覆盖 Standards 与 Spec，未执行测试。实现与测试分别由主agent和两个Luna开发/测试角色完成；前轮RAW及Renderer投影不是本轮审查范围。

## Standards

未发现本范围可证实阻断。复用 `ViewportPriorityOverlay` immediate union、原header单飞与限额，独立小coordinator替代Worker入口内联drain，没有新开并行任务系统或跨进程能力。coordinator先安装异步ownership再启动，可处理同步拒绝和onIdle重入；stop与index实例身份同时约束publish/onIdle，旧实例不会删除或发布到重开的实例。

数据库/文件操作仍由LibraryService拥有，predicate不传给共享底层I/O，关闭不单方面取消其他consumer需要的读。原图直出、Sharp/FFmpeg预算与原有2/3/4header限额未改；没有新增临时生产文件、删除或源文件写入路径。

## Spec

未发现本范围规格偏差。已接受的snapshot在legacy同visible早退前刷新全部consumer focused+visible union；旧generation不替换wanted。未领取集合replace，而非追加历史视口；service在领取前与shared read完成后动态检查，暂离后恢复、仍由另一consumer需要的项目不会误取消。

一项非阻断的性能观察：update有意把仍active的ID放回pending，避免已经跳过的项后来再次wanted却丢失。成功写入的metadata会被后续候选查询过滤，不再次读头；失败/无尺寸的项目可能在重复报告下重试。这是需继续量化的失败资源成本，尚无证据构成本轮回归。

主agent补充证据：纯coordinator8 passed，Worker/handler21 passed，库可用性238 passed/1 skipped，20k mixed3 passed；本轮定向ESLint零错误零警告，全仓类型仅其他开发四项既有错误。只读真实28,930项隐藏Windows Electron前后各1 passed，快速连跳header读取175→119、metadata写182→117，末页首图374→238ms、九成791→682ms；普通四跳存在更慢点、burst最大帧亦增加，不宣称全局稳定提速。当前位置和实际解码覆盖均有断言，源和新临时产物生命周期明确。前台按用户要求未执行，packaged/macOS未执行，独立审查不等同用户验收。
