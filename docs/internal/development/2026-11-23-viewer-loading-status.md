# 查看器长等待提示

工单 Serpent-cbdf62。之前切换资产会保留当前内容并预载目标，目标仍无法显示时没有通用提示。现在首次打开和切换资产使用同一提示。1 秒后仍未有内容可呈现时显示「正在加载…」。可呈现的占位图、已就绪媒体和终态错误均结束等待。快速连续切换时，计时跟随当前目标。

| 需求 | 实现 | 自动化 | 人工与平台 |
| --- | --- | --- | --- |
| 1 秒后显示，快速完成无需显示，切换时重新计时 | [状态组件](../../../src/renderer/viewer-loading-status.tsx) · [查看器切换层](../../../src/renderer/AssetPreviewModal.tsx) | [计时单测](../../../tests/unit/viewer-loading-status.test.tsx) · [Windows Electron 文本切换](../../../tests/e2e/browse-feedback.test.ts) | 待人类验收 |
| 等待时保留之前已解码的画面，目标就绪后撤下提示 | [查看器切换层](../../../src/renderer/AssetPreviewModal.tsx) | [Windows Electron 图片切换至文本](../../../tests/e2e/browse-feedback.test.ts) | 待人类验收 |
| 首次打开模型同样提示，FBX 源文件就绪后结束等待 | [模型查看器](../../../src/renderer/3d-viewer/viewer-surface.tsx) | [Windows Electron 阻塞、释放后验证真实 FBX 几何](../../../tests/e2e/model-viewer.test.ts) | 普通样本已自动覆盖，超大模型同步解码、安装包与 macOS 未执行 |

## 测试记录

- `npm exec -- vitest run --config vitest.config.ts tests/unit/viewer-loading-status.test.ts tests/unit/viewer-preview-policy.test.ts`，8 项通过。
- `node scripts/run-e2e.mjs tests/e2e/browse-feedback.test.ts tests/e2e/model-viewer.test.ts -g 'shows delayed viewer feedback|decodes source FBX|Enter closes only' --trace off`，Windows 隐藏 Electron 3 项通过，覆盖图片切换至延迟文本、首次打开延迟 FBX、回车快速查看退出。
- 对改动的查看器与测试执行 ESLint，0 个错误，查看器保留 2 条既有 Hook 依赖警告。
- 扩展运行 `media-preview.test.ts` 的图片旅程在查看器打开前失败。卡片缩略图测试预期 `object-fit: cover`，实际为 `contain`。本次未修改卡片布局。
- `npm run typecheck` 仍受既有 CLIP SQLite 绑定类型错误影响。
