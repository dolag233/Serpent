# 文件名中间省略开发记录

## 工单与范围

- 工单：`Serpent-kmgw`
- 用户反馈日期：2026-08-05
- 范围：资产卡片和 Inspector 的长文件名保留开头、末尾三字符与扩展名，中间使用省略号。
- 当前状态：实现完成，定向 Electron E2E 已通过；Computer Use、packaged 和 Windows 尚未执行。

## 根因

`splitFilenameForDisplay` 已经正确拆分 stem 的前缀、末尾三字符和扩展名，但卡片的普通显示路径仍把前缀拆分结果包成额外的内联 `span`。`text-overflow: ellipsis` 作用在包含这些子节点的 flex 前缀上时，浏览器不能稳定按预期生成中间省略；短名称还可能因为前缀的 flex 尺寸参与方式出现错误间距。Inspector 和卡片没有共用完全相同的高亮渲染路径。

## 实现

- `src/renderer/App.tsx`
  - 无搜索词时直接渲染纯文本节点，使前缀 flex 项可以可靠触发 `text-overflow: ellipsis`。
  - 保留有搜索词时的 `mark` 高亮路径。
- `tests/e2e/browsing-preferences.test.ts`
  - 新增真实 Electron 用例，导入长文件名并检查卡片与 Inspector 的末尾字符、扩展名、`text-overflow` 和前缀溢出几何关系。
- `docs/internal/qa/human-acceptance-checklist.md`
  - 新增 `TITLE-001`，等待用户本人验收。

## 验证记录

已执行：

```text
node scripts/run-e2e.mjs tests/e2e/browsing-preferences.test.ts --grep "middle ellipsis"
```

结果：`1 passed (4.3s)`；卡片与 Inspector 断言均通过。

`verify:mainline` 已执行两次。静态门禁通过；全量 `npm run test` 在 100k 资产单字符搜索性能用例上分别出现 1161ms/1253ms（阈值 1000ms），导致主线门禁未通过。按主线 Electron 测试脚本单独运行该文件为 `5 passed (19.63s)`；该性能门禁的并行负载波动与本工单无代码路径关系，仍需独立质量工单处理，不能写成主线全绿。

Computer Use、当前 HEAD packaged 构建、Windows 平台和用户本人验收尚未执行。

