# 查看器切换热区收窄

2026-11-13，用户反馈查看器两侧切换范围过大，目标是截图所示左右边缘的竖直居中窄条。

## 原因与修改

原按钮各覆盖查看器宽度的 22% 和几乎全高，箭头却画在最外侧。鼠标在远离箭头的图片区域点击也会切换。靠近唤起判定使用另一套全高范围，和按钮命中区没有完全对齐。

按钮改为左右各占宽度的 8%（限制 56–80 px），高度为居中的 56%。靠近唤起使用同样的宽、高规则；切换后的指针位置重新计算仍保留，因此固定指针连续点击的路径不变。箭头本身、颜色、禁用状态和底部控制条未改。第一版宽度为 11.5%（72–112 px），用户反馈仍偏宽，进一步收窄。

| 需求 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 中部窄条切换，其余图片区域不误切换 | `src/renderer/styles.css` `.preview-nav`；`src/renderer/viewer-navigation-hit-zone.ts` | `tests/unit/viewer-navigation-hit-zone.test.ts`：中心、顶部、底部和窄/宽窗口边界 | 真实 Electron 未执行；用户当前有运行中的开发实例，避免重建共享 `.vite` 或打断前台窗口。 |
| 悬停唤起和按钮命中范围一致 | `src/renderer/AssetPreviewModal.tsx` `readNavNear` | 同一定向测试验证共享几何规则 | 真实鼠标操作待用户复验。 |

## 当次验证

- `npx vitest run tests/unit/viewer-navigation-hit-zone.test.ts`：第一版和收窄后的第二版均为 1 file / 3 passed。
- `npm run typecheck`：通过。
- `npx eslint src/renderer/AssetPreviewModal.tsx src/renderer/viewer-navigation-hit-zone.ts tests/unit/viewer-navigation-hit-zone.test.ts`：0 errors，2 条该组件已有的 hook dependency 警告。
- `git diff --check`：通过。

查看器行为的独立 Electron E2E、agent 前台操作和视觉截图均未执行。用户在 8% 宽度版本后回复「可以，提交推送」，本次热区手感由用户验收通过；自动化平台证据仍限于上述定向测试。
