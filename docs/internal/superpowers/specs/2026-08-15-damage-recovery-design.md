# 数据损坏处理与自动恢复设计

> 日期：2026-08-15  
> 状态：Phase 1 与 Phase 2 主要路径已实现；Phase 3/平台证据待收口
> 用户理想（2026-08-15）：不论什么内容丢失，资源库都可以正常打开运行；可恢复的内容丢失进入自动恢复流程；不可恢复的显示文件损坏（裂开）标志。数据库物理损坏通过定时备份（至多 2 份）恢复。

## 1. 目标

1. **库永远打得开**：从"主库损坏 → 备份 → 只读降级 → 抢救重建"逐级降级，任何一层都不直接拒绝用户。
2. **可恢复即自动恢复**：列缺失（宽容读取）、行缺失（重扫入档）、缩略图/派生物缺失（重排队重建）、文件操作中断（journal 恢复）全部静默自动完成。
3. **不可恢复即裂开标志**：源文件无处可找、行级数据无法重建的资产，显示统一的"文件损坏"（broken-file 裂开）状态，而不是消失或静默。
4. **定时备份兜底物理损坏**：每库至多 2 份轮换备份，损坏时自动从备份恢复。

## 2. 现状盘点（已实现的机制）

| 场景 | 现有机制 | 位置 |
| --- | --- | --- |
| 缺列（旧库/列丢失） | lenient-read：`columnsFor` 列探测 + `degradedDefaults` 降级默认值，覆盖列表/标签/合集/搜索/AI 读路径 | `src/worker/lenient-columns.ts`、`library-service.ts` 各读路径（verg.2，0031 §1） |
| 缺行（assets 行丢失） | `refreshManagedAssetsOnOpen` 打开库重扫 `Assets/`，源文件在即自动重新入档 | `library-service.ts:4808` |
| 缺行（asset_metadata 行丢失） | `COALESCE(m.rating, 0)` 等默认值降级 | listAssets/Inspector 读路径 |
| 缩略图/派生物丢失或失败 | `pending` → 重排队；MEDIA-003 组件恢复后自动修复；截断 JPEG 尝试恢复解码；artifact 路径缓存带真实路径校验 | `generateImageThumbnail`、`recoverInterruptedThumbnailJobs` 等 |
| 文件操作中断 | `file_operations` journal + 全套 `recover*`（move/copy/trash/restore/relink/批量替换），重开自动对账 | `recoverFileOperations` 等 |
| 源文件丢失 | `availability: 'missing'` 建模：卡片 `is-missing` 样式、过滤、hover 禁用、Inspector 缺失行；linked 资产 relink 恢复 | `availability-affordance.ts` 等 |
| 缩略图失败展示 | `broken-file` 裂开图标 | `AssetCardMedia.tsx:44` |
| 数据库物理损坏 | 打开时按主库 → backup-1 → backup-2 → 只读 → Assets 抢救降级；失败层写诊断和恢复状态 | `library-service.ts:31426-31764`；`main/index.ts:1490-1497` 恢复状态脱敏 |
| SQLite 在线备份能力 | `connection.backup(destinationPath)`（导出场景临时备份） | `library-service.ts:4908` |

## 3. 差距与设计

### 3.1 打开降级链（库永远打得开）

当前实现已将 `LIBRARY_CORRUPT` 改为逐级降级，每层失败进入下一层并记录诊断：

```
打开库
  ├─ 1. 正常打开（quick_check ok → 迁移 → 完整可用）
  ├─ 2. 主库损坏 → 尝试备份库.1（校验后替换主库）→ 成功则打开并通知"已从备份恢复"
  ├─ 3. 备份.1 也坏 → 备份.2
  ├─ 4. 两份备份都坏 → 只读降级打开（lenient-read 全开，跳过迁移与写入）
  └─ 5. 只读也打不开 → 抢救重建：损坏库移入 .serpent/corrupt-backup/，
       以 Assets/ 目录扫描重建空库（资产文件是数据本体；标签/合集/评分等
       元数据丢失，重建完成后显示恢复报告）
```

每层都需要明确的通知文案（哪一层恢复、丢了什么），遵循冷静文案原则（不阻塞、不焦虑）。

### 3.2 定时轮换备份（至多 2 份）

- 位置：`<库>/.serpent/backups/library.db.1`、`library.db.2`（不入同步范围）。
- 方式：SQLite Online Backup API（`connection.backup`，已有基础设施）。
- 轮换：写 `.1` 成功后把旧 `.1` 移为 `.2`（最坏保留两份最近成功备份）。
- 触发：
  - 打开库成功且距上次备份 ≥ 24 小时 → 立即备份一次；
  - 每 24 小时周期内，首次成功关闭库时备份；
  - 重大破坏性操作前（清空回收站、从磁盘删除、迁移成功后）→ 备份。
- 备份本身 quick_check 校验，坏备份不参与轮换。
- 库目录删除时备份随库删除（语义正确）。

### 3.3 行级损坏可见性（不消失，裂开标志）

- `listAssets` 的 `JOIN revisions` 改为 **LEFT JOIN**：revision 行丢失的资产仍出现在列表，`byteSize=0`、`modifiedAt` 未知，卡片显示裂开图标 +「数据损坏」；同时触发自动修复（源文件在 → 重扫入档重建 revision；源文件也不在 → 转 missing 分级）。
- `current_revision_id` 悬空（指向不存在的 revision）同上述处理。
- 元数据行丢失（标签/评分等）：不影响打开，资产照常显示；不做裂开（属于"静默降级"，恢复报告里记录数量）。

### 3.4 源文件 missing 分级（裂开 + 可恢复入口）

- missing 资产统一显示**裂开图标**；Inspector 提供进入既有 relink 管线的入口。
- 用户明确选择恢复根目录后，系统按原相对路径后缀、唯一同名、同名内容指纹顺序匹配；
  多个同名且指纹不能唯一确认时保持 missing，不猜测绑定。
- Inspector 选中 missing 资产时只检查已知原路径、已知链接根路径和 Serpent 回收区：有内容指纹且唯一匹配时显示“可恢复候选”；候选存在但不能确认内容或未知位置时，显示需要选择恢复位置，继续进入既有 relink 管线。不在打开大型资源库时递归扫描未知目录，避免把恢复扫描加入大库打开和导入热路径；未知位置不被误判为“不可恢复”。
- Inspector 的损坏行显示「数据损坏」和裂开图标；missing 的移除动作继续复用既有资产命令/菜单，未新增破坏性快捷操作。

### 3.5 写路径在损坏库上

- 写入命中缺失列/损坏行时返回可读错误 + 建议「修复资源库」（触发 3.1 第 2 层备份恢复或重扫），不静默吞错。

## 4. 分阶段

| 阶段 | 内容 |
| --- | --- |
| Phase 1 | 已实现：打开降级链（备份恢复 + 只读降级 + 抢救重建）；定时轮换备份（2 份 + 触发时机 + 校验）。待 packaged/Windows/真实破坏重启证据 |
| Phase 2 | 已实现主要路径：LEFT JOIN + 裂开标志 + 自动修复；显式选择恢复根目录后的路径/同名/指纹重定位与 Inspector 入口；Inspector 对已知原路径/回收区做指纹候选探测 |
| Phase 3 | 部分实现：抢救报告写入受保护目录，界面显示源文件数量、元数据损失摘要并可由 Main 打开报告目录；写路径仍以只读/恢复提示为主，真实破坏重启与 packaged/Windows 证据待执行 |

## 5. 验收清单（四列，实现时补齐）

| 需求条目 | 验收标准 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- | --- |
| 打开降级链 | 主库损坏 → 自动用备份恢复并通知；双备份坏 → 只读打开；只读失败 → 抢救重建且库可打开（报告元数据丢失） | `library-service.ts:31426-31764`；`main/index.ts:1490-1497`；`App.tsx:8519-8562` | `tests/worker/database-recovery.test.ts:57-184` | 当次 Worker 注入通过；真实应用完整退出重启、packaged、Windows 待执行 |
| 定时轮换备份 | 至多 2 份轮换；打开 24h 节流备份；破坏性操作前备份；坏备份不参与轮换；备份 quick_check 校验 | `library-service.ts:5121-5238`；`worker/index.ts:701-727` 破坏性命令备份入口 | `tests/worker/database-recovery.test.ts:57-74,274-305` | macOS Worker 通过；packaged/Windows 未执行 |
| 行级损坏可见性 | revision 行丢失的资产不消失，显示裂开 + 自动修复（源文件在则重建） | `library-service.ts:12704-12745,22267-22288`；`availability-affordance.ts:32-66`；`InspectorPanel.tsx:965-1012` | `tests/worker/database-recovery.test.ts:186-229`；`tests/unit/availability-affordance.test.ts` | Worker 注入通过；真实损坏库窗口验收待执行 |
| missing 分级 | 已知原路径/回收区/链接根路径只在选中资产时探测；指纹匹配显示可恢复候选，未知位置继续显式选择根目录，不猜测绑定 | `library-service.ts:22683-22810`；`src/shared/protocol/requests.ts`；`InspectorPanel.tsx:570-599,965-1012`；`App.tsx:6463-6505` | `tests/worker/database-recovery.test.ts:231-272`；`tests/unit/protocol.test.ts`；`tests/e2e/trash-relink-flow.test.ts` | macOS Worker/协议/Electron 提示路径通过；真实损坏库窗口、外部目录、Windows 待执行 |
| 列缺失兼容（回归） | 现有 lenient-read 路径全部保持（已有测试持续绿） | 已有 | 已有 | 已有 |

## 6. 开放问题

1. 备份与同步的交互：备份文件不入 WebDAV 同步（本地兜底），是否需要"备份到远端"二期考虑。
2. 抢救重建后元数据（标签/合集/评分）从备份库救回的可行性：备份库可能只缺主库的尾部数据，理想流程是先试备份恢复再谈重建——是否值得做"备份库 → 只救元数据"的混合恢复（Phase 2 评估）。
3. 定时备份的节流周期（24h 默认）是否需要用户可配（设置页暴露）。
