# Issue #75 双轴独立审查（2026-10-31）

范围：相对 `0991c58d` 的 OIIO 路径修复、链接目录索引/分片读取、调度准入及对应测试。用户选定 luna；仅一个独立 agent 同时审查 Standards 与 Spec，多轮在同一 agent 上复审。审查者只读，没有修改代码或执行测试；自动化结果由主 agent 提供。

## 发现与处理

| 发现 | 处理与证据 | 状态 |
| --- | --- | --- |
| 冷文件夹卡片仍同步载入全根资产和目录 | async browse/refs 接入分片资产投影；parent index 查询直接子项与批量下层目录。`linked-directory-index.test.ts:204` | 已修复，回归通过 |
| 重新链接清空快照后只注册 watcher，不发现已有空目录 | relink async 包装显式等待 root-scoped reconciliation。`linked-directory-index.test.ts:194` | 已修复，回归通过 |
| 并发扫描缺少新旧顺序保护 | 枚举开始前 `beginScan` 分配版本；发布按版本检查，并保护其他写入中的 staging。`:184`、`:219` | 已修复，回归通过；原服务 owner 同时有序列化保护，不宣称原来已证实服务级乱序 |
| linked-folder.list 与自动化命令仍走同步入口 | 新增 async list；IPC、automation executor、dispatch、Worker 入口全部 await。`:247` 验证分片读及 catalog sequence 不变 | 已修复，回归通过 |

## 最终结论

Standards：通过，未发现本次范围的代码阻断项。新能力拆分独立模块，复用原协调 owner、队列与路径/忽略语义；无 UI 样式、用户文案或权限能力新增。

Spec：主路径符合方案，未发现新的代码阻断项。完整目录 generation、异步投影、同 key 合并、显式重链接、旧失败限定恢复已落地。性能测量与真实 Electron 的当前源码结果见[QA](../qa/2026-10-31-issue-75-qa.md)，不能由静态代码审查代替。

主 agent 最终补充 Windows 隔离 Electron 完整退出、源离线、重启再打开资源库的快照保留证据；审查者未亲自执行。真实用户库、原截图 JPG 空白、原会话绝对耗时、macOS watcher、慢盘、packaged 和人眼验收仍缺证据。结论不等于 accepted 或发布通过。
