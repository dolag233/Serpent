# Agent 插件开发与测试 Playbook

> 给实现/测试插件的 Agent 用。人类开发者见 [`plugin-development-guide.md`](plugin-development-guide.md) 与 [`plugin-api-reference.md`](plugin-api-reference.md)。  
> 验收口径（产品 2026-08-01）：**插件 / 脚本 / MCP / Gateway 以自动化测试为准；该范围要求的测试绿即视为通过**，不依赖人类逐步点验。

## 1. 开工前

1. 读本文件 + 上述两份人读文档 + `docs/implementation/0024-script-plugin-platform.md`（需要时）。  
2. 主仓：`/Users/dolag/Development/Serpent`（本地磁盘；禁止 NAS/SMB 跑 Electron）。  
3. 插件源码：与 Serpent **同级 sibling**（如 `Serpent-Plugin-ImageUpscaler`），**不要**放进主仓目录。  
4. Node：`.nvmrc`（24.x）；主仓依赖已 `npm ci`。  
5. 工单：`bd ready` → `bd update <id> --claim`；插件平台相关见 `Serpent-upsn` / `Serpent-8csl` 等。

## 2. 最小插件包

```text
my-plugin/
  serpent-plugin.json
  entry/main.js    # 已编译；standard / trusted 均可加载
  README.md
  LICENSE
```

清单必填：`id`、`version`、`engines.serpent`、`engines.pluginApi`、`runtime.mode`（`standard`|`trusted`）、`runtime.entry`、`permissions`、`contributes`。

入口：

```js
exports.activate = async function activate(serpent) { /* ... */ };
exports.deactivate = async function deactivate() {};
```

- 领域读写走 `serpent.*`（Automation Gateway）。  
- 读/写资产字节：`content.read` / `content.write` → `readContent` / `replaceContent`（写回有计划确认）。  
- 模型/缓存：`data.files` → `serpent.data.getDirectory({ scope? })`  
  - user：`{userData}/plugin-data/<pluginId>/`  
  - library：`<库>/.serpent/plugin-data/<pluginId>/`  
- ONNX / 原生 / 任意 `fs`：用 `trusted`；仍优先用 `serpent.*` 改库，禁止 shell `mv` 覆盖 `Assets/`。

主仓夹具参考：`tests/fixtures/plugins/*-probe/`。

## 3. 联调（可选，非验收替代）

`npm start` → 设置 → 插件 → 选范围 → 本地安装 → 信任 → 开库激活。

## 4. 测试分层（必须达标才算「自动化验收通过」）

| 档 | 何时 | 怎么跑 |
|----|------|--------|
| A 类型/契约 | 任何清单/API 变更 | `npx tsc --noEmit`；相关 `tests/unit/plugin-*.test.ts` |
| B Gateway/Host | 接线、权限、Guest API | `npx vitest run <定向文件>`（如 `automation-command-gateway`、`quickjs-sandbox-prototype`、`plugin-trusted-host`） |
| C Worker | 读盘、replace、revision | 定向 `tests/worker/…`；ABI 不对时 `npm run rebuild:native` |
| D Electron E2E | 安装/信任/激活/跨进程 | `node scripts/run-e2e.mjs tests/e2e/plugin-*.test.ts`（或扩展用例）；**隔离** `SERPENT_E2E_USER_DATA_PATH`；后台跑，勿抢用户前台 |
| E 媒体 | 预览/缩略图/写回后可见 | 断言实际解码（图：`complete && naturalWidth > 0`），禁止只断言 DOM/job |

默认**不要**全量 `npm test` / `verify:mainline`，除非主仓合流或触及核心媒体门禁。

计划确认类 E2E 可参考既有 `SERPENT_E2E_AUTOMATION_CONFIRM=1` 等缝（见自动化 E2E）。

## 5. 验收如何记

- 清单 ID：`PLUGIN-*` / `AUT-*`（脚本/MCP 同轨）。  
- 状态用 **`自动化验收通过`** 或 **`自动化证据不足`** / **`自动化未通过`**（见 `human-acceptance-checklist.md` 规则）。  
- Agent **可以**在证据齐时设为「自动化验收通过」；**不要**把 UI 壳层条目标成人类通过。  
- 回复必须列出：跑过的命令、通过数、未跑项（packaged / Windows 单独写「未执行」，不冒充通过）。

## 6. 禁止

- 无自动化证据声称完成  
- 用本机 `mv`/`cp` 覆盖库内文件冒充 `replaceContent`  
- 在 SMB 上跑 Electron  
- 把插件源码提交进 Serpent 主仓（夹具/探测插件除外）  
- 未认领工单就开干；与其他 agent 抢同一 `bd` 单

## 7. 最短任务卡（可复制）

```text
1. 读 docs/agent-plugin-playbook.md + plugin-api-reference.md
2. Sibling 仓实现可安装包（serpent-plugin.json + 编译 entry）
3. 权限最小化；写回用 content.read/write；模型用 data.getDirectory
4. 主仓定向 vitest；跨进程则补/跑 plugin E2E（隔离 userData）
5. 更新 human-acceptance-checklist 对应 PLUGIN-* 为自动化验收通过/不足，附命令摘要
6. bd 备注；不关单若 packaged/Windows 仍是该单验收条件
```
