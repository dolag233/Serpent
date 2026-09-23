# 2026-09-23 忽略设置预览

> 工单：`Serpent-490c96`  
> 状态：实现完成，待人类验收  
> 分支：`dev`

## 现象

资源库设置的忽略规则只有文本框。改 `.*/` 或删掉一行时，看不出会新挡住什么、会重新显示什么。用户不要把已撤回的「管理忽略项目」弹窗加回去，预览要嵌在同一块面板里。

## 参考

官方 `Serpent-Plugin-Renamer` 用 Host `ui.list` 做原文件名 / 新文件名对照：匹配段蓝色 `match`，改动段黄色 `change`，列表可滚动、交替行，超过 500 项截断并提示。忽略预览复用同一套列表与高亮，不另起弹窗。

## 实现

- Worker 用当前已保存规则和草稿各编译一份匹配器，对托管文件夹/资产和链接树（含空目录）求差：新增忽略、取消忽略、仍然忽略。
- 设置页在规则文本下方用 Host 标准列表两列展示「当前忽略 / 保存后」。将消失的项标蓝，将新挡住的项标黄；未变的两侧同文。
- 草稿一改就立刻请求预览；连打时旧请求作废，只展示最新一次。可见行上限 500，与重命名插件一致。
- 规则文本不再在失焦时保存；只有点「保存」才写入。未改动时保存按钮不可点。
- 没有恢复「管理忽略项目」按钮或独立弹窗。

## 2026-09-23 复验：立刻预览、禁止失焦保存

用户反馈：改完规则要马上看到修改后的忽略内容；鼠标点其他空白处不能自动保存，只能显式点保存。

根因：文本框 `onBlur` 会调用保存，点预览或空白处等于提交草稿，预览被已保存规则覆盖；另外预览还加了 300ms 防抖。

修复：去掉失焦保存；预览随草稿立刻发出请求。

## 命令

| 命令 | 结果 |
| --- | --- |
| `npx vitest run --config vitest.config.ts tests/unit/gitignore-preview.test.ts tests/unit/gitignore.test.ts tests/unit/ignore-handler.test.ts tests/unit/main-ignore-command.test.ts tests/unit/interactive-scheduler.test.ts` | 5 files / 39 passed |
| `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/gitignore-managed.test.ts` | 1 file / 8 passed（含草稿相对已保存规则的增/减） |
| `npm run test:library-availability` | 9 files / 227 passed、1 skipped；`database-recovery` 里备份节流用例先失败后单测复跑通过，与本改动无关，记为疑似 flaky |
| packaged / Computer Use | 未执行 |
