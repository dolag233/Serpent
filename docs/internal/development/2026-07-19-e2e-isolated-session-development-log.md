# 2026-07-19 Electron E2E 隔离会话（Serpent-a1b）

## 背景：`showInactive` 为何撤回

2026-07-18 曾尝试把 `BrowserWindow` 的 `show()` 换成 `showInactive()`，让 E2E 窗口不抢前台焦点。结果键盘/焦点相关的真实 Electron E2E（`asset-ingestion`、`asset-pagination`、`browsing-preferences`、`folder-context-menu`）稳定失败：`showInactive` 创建的窗口不会成为 OS 级前台/焦点窗口，Playwright 通过 CDP 发出的键盘事件（Enter/方向键/快捷键）依赖窗口拥有真实焦点才能被 renderer 收到，`webContents.isFocused()` 也保持 `false`。这与「不得削弱真实焦点语义」的验收要求直接冲突，已撤回（`Serpent-a1b` 描述记录了该结论）。

本轮不再尝试用隐藏/inactive 状态伪造隔离；改为只改变窗口**出现的位置**，`show()`/焦点路径完全不变。

## 方案

`SERPENT_E2E_ISOLATED=1` 时：

1. `src/main/index.ts` 的 `createMainWindow` 在构造 `BrowserWindow` 前调用 `resolveE2eIsolatedPlacement`，读取 `screen.getAllDisplays()` / `screen.getPrimaryDisplay()`。
2. 纯函数 `pickIsolatedWindowPlacement`（`src/main/e2e-isolated-window.ts`，Electron-free）在存在非主显示器时，返回一个**完全落在该显示器边界内**的窗口矩形（尺寸 clamp 到显示器大小，居中）；只有一个显示器时返回 `undefined`。
3. 有非主显示器：窗口 `x`/`y`/`width`/`height` 使用该矩形；`show: false` → `ready-to-show` → `window.show()` 完全不变——依然是真实、会拿到 OS 焦点的窗口，只是出现在第二块屏而不是用户当前正在用的主屏。
4. 无非主显示器（单屏 Mac，例如当前开发机型判断依据不足以确认，需按机器实测）：记录一条 `logger.info("e2e.isolated-window", ...)` 说明已回退到主屏，**不会**静默伪装成已隔离；焦点仍会被 E2E 窗口抢走——这是本轮明确的残留限制，见下文。

`scripts/run-e2e-isolated.mjs` 包装 `scripts/run-e2e.mjs`：设置 `SERPENT_E2E_ISOLATED=1` 后转发所有 Playwright 参数；`npm run test:e2e:isolated` 对应完整套件。Linux 下额外探测 `xvfb-run`（且当前没有 `$DISPLAY` 时）自动包一层虚拟 X display，给 CI runner 一个它完全独占的显示环境——这是目前唯一能在没有物理副屏时做到「窗口存在但不影响物理前台」的路径。macOS 没有等价的通用虚拟显示方案，脚本只做清晰的回退日志，不假装解决。

## 为什么这是允许的方向、而不是又一次「隐藏窗口」

- 窗口始终 `show()`，从未 `showInactive()`/`setOpacity(0)`/`minimize()` 等削弱焦点语义的调用。
- 在有副屏的机器上，窗口是该副屏上完全正常、会拿到该副屏 OS 焦点的前台窗口——键盘事件路径与用户手动测试时完全一致，只是不与用户当前正在操作的主屏窗口抢焦点。
- 单屏时诚实回退并留痕，不产出「已隔离」的假阳性证据。

## 文件

- `src/main/e2e-isolated-window.ts`（新增）：纯几何函数 `pickIsolatedWindowPlacement`。
- `src/main/index.ts`：`createMainWindow` 接入 `resolveE2eIsolatedPlacement`；仅新增 `x`/`y`/`width`/`height` 计算与日志，`show()`/`ready-to-show`/焦点相关代码零改动。
- `scripts/run-e2e-isolated.mjs`（新增）：设置 env + 转发 Playwright 参数 + Linux `xvfb-run` 探测。
- `package.json`：新增 `test:e2e:isolated` 脚本（与 `test:e2e` 相同用例列表，走隔离 wrapper）。
- `tests/unit/e2e-isolated-window.test.ts`（新增）：覆盖单屏/居中/clamp/负坐标显示器/多副屏选取。

## 如何运行

```bash
npm run test:e2e:isolated
# 等价于
node scripts/run-e2e-isolated.mjs [playwright 参数，默认对齐 test:e2e 的用例列表]
```

单个用例：

```bash
node scripts/run-e2e-isolated.mjs tests/e2e/asset-ingestion.test.ts
```

判断是否命中隔离路径：查看 `~/Library/Logs/Serpent/serpent.log`（或 packaged/E2E 覆盖的 `SERPENT_E2E_USER_DATA_PATH` 下等价日志路径）中 `scope: "e2e.isolated-window"` 的记录；`message` 会明确说明「已放到副屏」还是「无副屏已回退主屏」。

## 验证（四列）

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 有副屏时窗口完全落在副屏边界内、居中、尺寸 clamp | `src/main/e2e-isolated-window.ts:41` `pickIsolatedWindowPlacement` | `tests/unit/e2e-isolated-window.test.ts`（5/5，居中/clamp/负坐标偏移/多副屏首个非主屏均覆盖） | 未执行——本机（Apple M1，单 GPU 报告）疑似单显示器，未能实测多屏路径；需在实际接副屏的机器或 CI 上用 `SERPENT_E2E_ISOLATED=1` 跑一次真实 E2E 并确认窗口出现在副屏、键盘用例仍通过 |
| 无副屏时清晰回退 + 记录日志，不伪装隔离 | `src/main/index.ts` `resolveE2eIsolatedPlacement` 的 `else` 分支 | 无（依赖真实 `screen` API，未做集成测试） | 未执行——需在单屏机器上跑一次并检查 `serpent.log` 出现回退记录 |
| `show()`/`ready-to-show`/焦点路径未被削弱 | `src/main/index.ts` `createMainWindow`（仅新增 `x`/`y`/`width`/`height`，未触碰 `show`/`ready-to-show`/`focus`） | 现有 `asset-ingestion`/`asset-pagination`/`browsing-preferences`/`folder-context-menu` E2E（未在本轮重跑，见下） | 未执行——本轮未重跑真实 Electron E2E（会弹前台窗口，遵循「测试后台执行、不抢占用户前台」纪律，未在未征得同意前强制弹窗；需要后续在专用机器/CI 或征得同意后跑 `npm run test:e2e:isolated` 全量核对键盘用例仍 100% 通过） |
| `npm run typecheck` | — | 通过（本次改动后全量重跑） | 命令输出已确认 0 error |
| `npm run test:unit` | — | 通过（881/881，含新增 5 个） | 命令输出已确认 |
| `eslint` | — | 通过（改动文件） | 命令输出已确认 |

## 残留风险 / 未决

1. **单显示器 macOS 仍会抢焦点。** 这是本方案明确承认、未解决的残留限制：没有额外的 macOS 虚拟显示或独立登录会话方案时，单屏开发机上运行真实键盘/焦点 E2E 依然会把窗口弹到前台并抢走焦点。跟进方向见下方 follow-up。
2. **未在真实多屏环境验证。** 本机是否有第二块显示器未能在当前 sandbox 下确认（`system_profiler`/直接跑 Electron 探测脚本被 sandbox 的 codesign 检查拦截，`task_name_for_pid` 失败）；纯几何函数已用单测覆盖分支，但「真的接一块副屏后窗口是否如预期出现在副屏且键盘用例仍通过」未做端到端验证。
3. **未重跑受影响的键盘/焦点 E2E。** 本轮改动理论上不触碰 `show`/焦点代码路径（只加了位置），但按验收纪律，「未触发即未验证」——没有实际重跑 `asset-ingestion`/`asset-pagination`/`browsing-preferences`/`folder-context-menu`，不能写「已验证不回归」。
4. **Linux `xvfb-run` 路径未在 CI 实测。** 逻辑上 `xvfb-run --auto-servernum` 应该能给 Electron 一个完全独立的虚拟显示，但本仓库目前没有 Linux CI runner 验证这条路径。

## Follow-up

- 若需要「即使单屏 macOS 也不抢占前台」的强隔离（独立 macOS 登录会话 / 专用虚拟显示 / 专用 CI runner 硬件），超出本轮范围，已拆出后续 P2 工单 `Serpent-vpk`（`depends_on: related Serpent-a1b`），不在 `Serpent-a1b` 内继续膨胀范围。
- `Serpent-a1b` 本身作为「副屏隔离 + 文档 + wrapper」的增量交付收口；是否直接关闭由主 agent 决定（见回复中的建议）。
