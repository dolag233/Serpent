# ARW 查看器色调修复交叉审查

2026-11-14，独立审查角色：Luna。审查范围为本轮未提交改动；同时检查 Standards 与 Spec。实现者没有自签人类验收。

## Standards

- 未发现高置信度的 OIIO 参数、曲线数学、成功/失败 artifact 版本及缓存前缀缺陷。新代码只更改 ARW 查看器；卡片与其他 RAW 格式仍保持既有参数。
- 审查发现工作区根目录有试验 OIIO 标准输出误生成的 23 字节 `-` PPM 文件，另有三个忽略的基准图。已核实归属并尝试清理，自动审批拒绝文件删除，暂未达到仓库的测试产物洁净要求。没有把这些文件纳入 Git。
- 审查本轮新增文档与工单，未发现本机路径、用户名、真实样本名或凭据。

## Spec

- 审查指出亮度分布拟合只能直接证明全局色调改善，不能凭此宣称相机 JPEG 的完整色相、白平衡或局部处理已经复现。实现者补测三张同方向样本的平均 CIE Lab 色差与色度平面差，均未恶化；Luna 复核后撤回最初的 P1 规格缺口结论。用户看过新效果并表示「看起来效果还行」，[RAW-VIEWER-SPEED-001](../qa/human-acceptance-checklist.md) 改为「待人类验收」，保留真实应用完整旅程；packaged、Windows 未验证。
- 审查指出真实样本自动测试只检查最终 CDF 阈值，未直接证明拟合优于中性 RAW。现已在同一 RAW 上增加无落盘中性探测和相对改善断言，四张真实样本再次通过；算法单测增加两个亮度模式朝目标移动的断言。
- 多样本测试还发现部分竖拍 ARW 内嵌预览与全尺寸 RAW 方向不一致；单独记录 `Serpent-6e41b6`，不把横竖强行缩放后的像素误差解释为色彩回归。

## 验证

- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/unit/raw-viewer-color-match.test.ts`：3 passed。
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/video-exr.test.ts -t RAW`：12 passed / 64 skipped。
- 四张真实 ARW 分别设置 `SERPENT_REAL_RAW_TEST_FILE`，运行 `-t 'decodes a real RAW'`：每张 1 passed / 75 skipped，均比中性 RAW 更接近内嵌预览。
- `npm run test:library-availability`：9 files / 238 passed / 1 skipped。
- `npm run typecheck`、变更文件 ESLint、`git diff --check`：通过。

结论：自动化与代码审查支持「全局色调显著改善」，不支持「相机色彩已完整复现」或「真实应用画质已通过」的结论；待用户复验。
