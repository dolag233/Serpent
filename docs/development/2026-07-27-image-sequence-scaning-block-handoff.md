# 2026-07-27 序列帧真实导入反馈（Scaning Block）

## 工单

| ID | 内容 | 状态 |
|----|------|------|
| **Serpent-jxnb** | Epic：序列帧导入与查看体验收口 | open |
| **Serpent-sxk3** | 对话框默认焦点（独立 P1，本回合不实现） | open |
| Serpent-2eg1 | 单帧拖入误报大量内容重复 | 实现中（同批哈希跳过） |
| Serpent-vwr7 | 合成一套资产 + `00000~00150` 命名 | 实现中（displayName） |
| Serpent-6s02 | 导入前确认（范围 / FPS=30 / 分辨率一致） | 实现中（probe+dialog） |
| Serpent-vijg | 回收站删主序列泄漏剩余帧；恢复 | 实现中 |
| Serpent-8wus | 网格堆叠预览 | 实现中 |
| Serpent-50xn | 预览闪烁 | 实现中（卡片/查看器改为解码后 Canvas 绘制） |
| Serpent-ue5f | 查看器应可播放 | 实现中（Canvas 播放 + 暂停时 client preview） |
| Serpent-2w1a | 多种帧号后缀 | 实现中 |

## 本回合已落地

1. **命名**：`trailing`（含 `_0`/`001`/`name.####`）与 `parens`（`(n)`）；补零位宽严格；未补零可变位宽同组。显示名 `formatImageSequenceDisplayName`。
2. **默认 FPS 30**：`DEFAULT_IMAGE_SEQUENCE_FPS`；自动建序列与导入确认默认 30。
3. **去重**：序列批次内跳过同批内容哈希与库内内容哈希误报（prepare + resolve）。
4. **导入确认**：`probeImageSequenceImportOffer`（sharp 分辨率一致）→ Main 持有路径 → Renderer 仅见 offerId/元数据 → 确认后导入范围+FPS；「只导入所选」不扩展。E2E 仍自动 expand。
5. **回收站**：选中序列成员 trash 扩展整组；restore 后 `createDetectedImageSequences`。
6. **UI**：卡片与查看器序列播放统一使用单 Canvas；目标帧解码前保留上一帧，避免 `img.src` 切换造成空白/闪烁。
7. **元数据与操作**：序列卡片 `byteSize` 汇总全部帧；角标增加时长；序列右键可修改 1–240 FPS；导入 reveal 被用户主动清选时取消延迟回选。

## 2026-07-28 增量验证

- `npm run typecheck`：通过。
- `npm run lint`：通过。
- 定向 Renderer 单测：通过（194 files / 1518 tests，含既有全 unit 集合）。
- 定向 Worker 序列测试：通过（1 file / 10 tests）。
- image-sequence Electron E2E：本回合执行中，结果待补；Computer Use/用户复验未执行。

## 人类验收

见 `docs/qa/human-acceptance-checklist.md`：`IMAGESEQ-001`～`IMAGESEQ-004`。

## 建议复验素材

`D:\Resources\...\Scaning Block`：拖 `_00010` → 确认窗 → 整段 0~150、30 FPS、一名 `…_00000~00150`；删序列卡不泄漏单帧；查看页可播。
