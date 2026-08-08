# UI direction 0004: Calm errors and copy UX principles

> Status: active product/UX constraint  
> Date: 2026-07-25  
> 关联：TOAST-003/005、`FatalAlertDialog`、`Serpent-rk65`、REQ-EXT-002（扩展已无配对码）

Serpent 的错误与确认文案应**说清楚发生了什么、下一步能做什么**，而不是用夸张语气让用户紧张。用户已经在处理自己的素材；产品语气是冷静、具体、可行动的同事，不是警报器。

## 1. 禁止「耸人听闻」的标题

以下表述**不得**作为对话框或阻塞提示的默认标题：

- 「严重错误」「致命错误」「Critical error」「Fatal」
- 暗示灾难、崩溃、数据已毁的措辞（除非事实已核实且用户必须立即知晓）

阻塞对话框（`FatalAlertDialog` / `role="alertdialog"`）的标题必须**点名操作**：

| 场景 | 中文标题示例 | 英文示例 |
|------|--------------|----------|
| 打开资源库失败 | 无法打开资源库 | Couldn't open library |
| 创建资源库失败 | 无法创建资源库 | Couldn't create library |
| 导入失败 | 导入失败 | Import failed |
| 继续导入失败 | 无法继续导入 | Couldn't continue import |
| 校验导入失败 | 无法校验导入 | Couldn't validate import |
| 导入资源库包失败 | 无法导入资源库 | Couldn't import library |
| AI 批量全失败 | AI 分析失败 | AI analysis failed |

正文写**具体原因**（权限、路径、磁盘、错误码映射后的可读说明），不要重复恐吓标题。

## 2. 阻塞弹窗 vs 顶部 error 条

| 级别 | 何时使用 | 标题 |
|------|----------|------|
| **静默** | 用户试探性操作、无实际效果可预期（如空剪贴板粘贴） | — |
| **顶部 error 条** | 单次操作失败、用户可继续工作 | 无独立标题；正文即原因 |
| **阻塞对话框** | 必须确认后才能继续当前流程（开库失败、导入管线失败、AI 批量全失败） | 具体操作名（见上表） |

常规失败**默认不用**阻塞窗；只有流程确实卡住、需要用户读完后点「知道了」时才用。

## 3. 避免无端焦虑

1. **不说用户的错**：避免「你做了什么导致…」；用中性陈述（「无法读取该文件」「路径不存在」）。
2. **不夸大后果**：未丢失数据时不要写「数据已损坏」；区分「操作未完成」与「库已损坏」。
3. **给可行动下一步**： reinstall、检查权限、换路径、重试、打开设置——至少一条。
4. **预期内的空结果不打扰**：空剪贴板粘贴、取消文件选择（`CANCELLED`）不弹窗、不 error 条。
5. **同一失败不叠多层**：已有阻塞对话框时，不再叠 toast；同一批 AI 失败只弹一次连接类对话框。

## 4. 配对、鉴权等已废弃概念

产品已取消浏览器扩展配对码（`Serpent-1cxv`）。UI 与设置文案**不得**再提「配对码」「配对」「pairing code」；扩展说明只描述：保持 Serpent 运行、打开资源库、安装/加载扩展即可。

## 5. 实现检查清单

新增或修改错误路径时：

1. 标题是否具体到中性的操作名？
2. 正文是否来自 `error.code` / `toMessage` 的具体映射？
3. 空剪贴板、用户取消是否静默？
4. i18n 中英文是否同步、无「严重/Critical」默认兜底？
5. 是否更新 `docs/internal/qa/human-acceptance-checklist.md` 可验收步骤（若为用户可见增量）？

## 6. 变更流程

1. 产品或 UX 在本文件或 backlog 补充约束。  
2. 实现：`dialog.blockingError.*` 标题键 + `showBlockingError(title, message)`。  
3. 全仓搜索 `严重`、`Critical error`、`setFatal(` 无标题调用。  
4. Windows / macOS 各抽一条失败路径人工扫一眼语气。

## 7. 相关文档

- [0003 快捷键 UX 原则](./0003-keyboard-shortcut-ux-principles.md)
