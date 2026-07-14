# 切片 0004 QA 报告

> 状态：macOS 开发态有条件通过；packaged 与 Windows QA 待补
> 日期：2026-07-13

## Build under test

- 分支：`codex/slice-002-asset-ingestion`
- 固定提交范围：`8dc2470...cdc2247`
- 补充对象：当前 working tree 的公共 UI 与协议版本修复

## 自动化结果

下表为 2026-07-13 的历史基线；2026-07-14 收口新增结果见其后。

| 门禁 | 结果 |
| --- | --- |
| 公共 UI E2E `organization-search-trash` | 1/1 通过 |
| Unit | 141/141 通过 |
| Worker | 418/418 通过（另 1 项平台真实回收站测试默认跳过） |
| 全量 Electron E2E | 10/10 通过 |
| Package/verify/packaged smoke | 通过（packaged 1/1） |
| Lint | 通过 |
| Typecheck | 通过 |

E2E 通过真实 Electron UI 完成导入、标签创建/分配/重命名/删除、合集创建/加入/重命名/删除/
成员移除和 Label/评分/喜欢编辑，
未直接访问数据库。该流程同时验证了首次元数据版本 0 及后续版本递增。

### 2026-07-14 收口结果

| 检查 | 结果 |
| --- | --- |
| Protocol + Worker 定向回归 | 96/96 通过 |
| Electron E2E：组织主线 + 重启/冲突 | 4/4 通过 |
| 最终 `verify:mainline` | lint/typecheck/extension 通过；810 passed + 1 skipped；搜索性能 4/4；Electron E2E 22/22 |
| Lint | 通过 |
| Typecheck | 通过 |
| Computer Use | 通过；真实 Electron 操作并保存 2 张截图 |

新增 E2E 证明：字段显式清空与卡片标题即时更新、人工色卡与源链接拒绝原因、快速连续保存不自冲突、标签范围即时刷新、合集递归即时切换、直接/间接成员批量移除反馈、完整应用退出重启、父子合集关系、全部元数据字段持久化，以及真实竞争写入不静默覆盖。

Computer Use 证据：[组织与元数据编辑](evidence/0004-organization-metadata/01-metadata-and-organization.jpg)、[字段清空](evidence/0004-organization-metadata/02-cleared-metadata.jpg)。真实操作同时确认顶部批量条和既有右键菜单需要统一 UX 重构，已记录到 0014。

全量门禁首轮暴露 E2E 误用默认 `userData` 而与并发 Electron 进程争用 `SingletonLock`。Main 现在为未显式传入 profile 的 E2E 按进程创建唯一临时目录；需要重启的用例仍显式共享自己的隔离 profile。修复后完整 22/22 连续通过，该失败未被重试掩盖。

## 平台与未完成项

- macOS 自动化与 Computer Use：通过；packaged app smoke 待执行。
- Windows：无 runner，未验证，不能报告为通过。
- 仍需人工确认元数据面板布局、长文本、错误提示和版本冲突的可理解性。

## 结论

切片 0004 的 macOS 开发态功能、自动化、双轴复审与真实桌面操作通过。结论为有条件通过：packaged app smoke 与 Windows 真实平台 QA 未执行；跨领域的选择栏/右键菜单视觉问题已进入 0014，不在此处静默忽略。
