# 切片 0007 QA 报告

> 状态：托管资产最小主线通过；完整规格未通过
> 日期：2026-07-13

## Build under test

- 固定提交范围：`8dc2470...cdc2247`
- 补充对象：当前 working tree 的公共 UI E2E

## 自动化结果

| 门禁 | 结果 |
| --- | --- |
| 公共 UI E2E `organization-search-trash` | 1/1 通过 |
| Unit | 144/144 通过 |
| Worker | 430/430 通过（另 1 项真实系统回收站测试默认跳过） |
| 全量 Electron E2E | 10/10 通过 |
| Package/verify/packaged smoke | 通过（packaged 1/1） |
| Lint | 通过 |
| Typecheck | 通过 |

公共 UI E2E 在真实 Electron 窗口中删除托管资产、进入回收站、恢复至原位置，并确认资产重新
出现在所有资产视图；链接文件夹 E2E 还将临时源文件实际移入系统回收站并确认记录消失。
测试未直连数据库。

持久恢复 Worker 测试覆盖 SQLite 删除事务失败后重启自动对账、链接根离线时保留记录、重复
ID 拒绝、移动后抛错、离线根可重试和部分失败。macOS 通过环境门禁实际执行 native
system-trash helper（49/49）。

重新定位回归覆盖 managed 单项/批量选择外部候选后复制回原托管路径、原目录重建、外部源保留、
刷新、关闭重开、`resolveAssetPath` 实际字节和新 revision；linked 单项更新相对路径身份。

## 平台与未完成项

- macOS：系统回收站自动化与实际 helper 通过；永久删除、批量重新定位的人工 QA 待执行。
- Windows：无 runner，未验证，尤其不能推断 long path、占用文件和系统回收站行为已通过。
- 仍需验证冲突恢复、自动清理及 `keepMetadata=false` 的公共 UI 行为。

## 结论

托管资产主线与链接源系统回收站删除通过；批量重新定位和多项恢复等完整规格仍未完成，因此不是 accepted。
