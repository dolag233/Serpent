# 浏览器扩展原图保存增量

## 行为

旧行为：右键只使用浏览器上下文菜单给出的当前图片 URL；拖拽使用元素中最大的 `srcset` 或当前地址。两种入口可能保存不同分辨率，且没有统一的原图偏好。

新行为：扩展选项页新增默认关闭的「保存图片时优先下载原图」。开启后，右键从刚右击的页面元素读取原图候选，拖拽从同一媒体解析器读取；候选来自明确的原图属性、指向图片文件的父链接，以及 Pinterest 图片尺寸路径。原图请求失败或返回非图片时，回退到当前图片，并在保存反馈中说明。关闭开关维持原有保存地址；视频与本地文件不受影响。页面没有暴露可识别的原图地址时，扩展不能凭空取得源文件。

## 验证

| 需求 | 实现 | 自动化 | 人工/平台证据 |
| --- | --- | --- | --- |
| 全局开关、默认关闭 | `extension/preferences.ts`, `extension/options.ts`, `extension/options.html` | `tests/unit/extension-preferences.test.ts` | 真实选项页未执行 |
| 右键、拖拽共用原图候选 | `extension/media-target.ts`, `extension/content-script.ts`, `extension/background.ts`, `extension/radial-menu.ts` | `tests/unit/extension-media-target.test.ts`、`tests/unit/extension-context-media.test.ts` | 真实浏览器与桌面联动未执行 |
| 原图失败回退、反馈及 URL 元数据 | `extension/save-client.ts` | `tests/unit/extension-client.test.ts` | 真实站点未执行 |

当次命令与结果：`npx vitest run tests/unit/extension-media-target.test.ts tests/unit/extension-preferences.test.ts tests/unit/extension-client.test.ts tests/unit/extension-context-media.test.ts`，4 文件、44 测试通过；`npx tsc -p tsconfig.extension.json --noEmit` 通过；受影响文件定向 `npx eslint` 通过；`npm run extension:build` 生成并校验可安装扩展通过。Electron/Worker 层未改动，按最小化测试原则未运行其套件。未操作用户前台浏览器或 Serpent，真实 UI、Firefox 和 Computer Use 待人类验收。

## 独立双轴审查

Luna 对 Standards 与 Spec 同时审查，提出两处 P2：图片父链接可能指向视频、右键跨 frame 消息桥接缺少直接测试。现已把图片父链接限定为图片扩展名，并添加视频链接反例；右键桥接抽为共用模块，新增 frame 定向与消息匹配测试。修正后的定向门禁结果见上表。真实浏览器联动仍待人类验收，不标记最终 accepted。
