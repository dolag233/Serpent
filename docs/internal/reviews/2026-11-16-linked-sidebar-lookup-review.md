# 链接目录索引审查

范围为 `Serpent-e2e778` 的Sidebar Map及直接单测，审查者为同一名独立Luna，Standards/Spec同次覆盖。未扩大到其他累计改动。

结论：未发现具体产品语义阻断。按原顺序、先has再set保留旧find的first-match；useMemo依赖数组身份，当前state更新使用新数组；离线显隐仍由原统一目录过滤控制，Map只为实际渲染的linked entry取summary。每次render的行闭包取得当前lf，没有忽略callback的memo比较或改变目录排序。

测试在数组替换后检查标签、hover路径、离线relink及context转换名；getter计数和行数证明不再按每行重复全数组查找。这是算法工作量证据，不是端到端帧耗时证据。复制/native-import drop在summary替换后未专门dispatch，保留未验证边界；静态代码仍引用当前summary。

主agent随后串行运行：Sidebar44项通过，相关lint通过；当前构建两真实源带profiler和不带profiler旅程各1 passed，目录显式加载后测量、图片实际解码。全仓typecheck仍有4项其他CLIP错误；前台、原实例同负载、packaged/macOS未验证。详细命令和匿名数据见[开发记录](../development/2026-11-16-linked-sidebar-lookup.md)。整体目标继续，未提交推送、未用户验收。
