# 2026-08-05 用户反馈修复：3D 组件缺失 + 标题显示 + 格式过滤 — 开发日志

> 关联切片：0030（3D 模型支持）；分支：`codex/slice-002-asset-ingestion`
> 工单：`Serpent-g05n`（FBX WASM）、`Serpent-pjx2`（模型缩略图）、`Serpent-1d4w`（格式过滤）、`Serpent-kmgw`（标题显示）、`Serpent-61je.3`（HDRI 预览）、`Serpent-91pn`（Info 通知布局）
> 会话：主 agent（Windows，E:\MyRepositories\Serpent）

## 用户反馈（2026-08-05）

1. 打开模型提示「FBX 转换失败（转换组件不可用，请重新安装应用后重试），已使用兼容模式加载」
2. 模型没有缩略图
3. 格式过滤应支持更多格式（含 3D）
4. 资产标题显示完全错误：短名 `ZKH09734.ARW` 显示为「ZKH09 左对齐 + 734.ARW 右对齐」；期望长名中间省略 `wertyuiasddf...dad.mp4`

## 根因与修复

### 1. FBX 转换组件不可用（Serpent-g05n，已关闭）

**根因**：`resources/ufbx/`（ufbx.wasm + glue）在 `.gitignore` 中，且无 npm script / 打包 hook 自动构建；本机既无产物也无 Emscripten SDK。`prepackage`/`premake` 的 `media:verify` 不校验 ufbx，允许打包出无转换组件的「残废包」——用户「重新安装应用」也救不了。

**修复**（提交 `3181efe`）：
- **ufbx WASM 产物入仓库**（产品负责人拍板：WASM 平台无关单二进制，随 git 分发）。`resources/ufbx/`：ufbx.wasm 326KB + glue 9.6KB + ufbx.c/h 源 + LICENSE（MIT）+ acquisition.json 溯源收据
- `.gitignore` 移除 `resources/ufbx/`
- 新增 `scripts/verify-ufbx-wasm.mjs`（存在性 + SHA-256 对 lock），接入 `prepackage`/`premake`——缺组件即打包失败并给构建指引
- `CLAUDE.md` 环境约束更新：产物随仓库分发，仅重建/升级 ufbx 需要 Emscripten 6.0.5
- 本机安装 Emscripten 6.0.5（用户协助下载 wasm-binaries.zip 649MB，放入 emsdk downloads 缓存）→ `node scripts/build-ufbx-wasm.mjs --emsdk <dir>` 构建

**SHA 差异调查**：本机构建产物与开发机（huangqingsong）的 lock 哈希不一致（wasm `33033b20` vs `d490c5b0`；**js glue `82a9376d` 完全一致**）。glue 一致证明工具链与 flags 相同；wasm 二进制差异为 LLVM 编译的构建路径类非确定性（clang 在 -g0 下仍嵌入源树路径等元数据）。无功能影响：fbx-conversion worker 测试 19/19 通过。lock 已更新为本次产物哈希并附 note；后续机器构建若哈希不同，按 lock 注释核对即可。

**验收**：`npm run test:worker tests/worker/fbx-conversion.test.ts` 19/19；model-viewer E2E FBX 转换旅程 2/2（无兼容模式提示、统计面板真实几何数据）。

### 2. 模型缩略图（Serpent-pjx2，正式 P1，重新开启）

**排查结论**（2026-08-06，主 agent + 真实 Electron 日志）：
- 代码链路（slice E）完整：Worker 入队 → `processModelThumbnailJob` → Main 共享离屏窗口 → `thumbnail` artifact 落库；`enqueueThumbnailJobs` 入队 SQL 已含模型扩展名。
- 第一层阻断已修复：`scripts/run-e2e.mjs` 增加 `vite.offscreen-preload.config.ts` 构建，确保 `.vite/build/offscreen.js` 存在。随后通过 Main 预授权 `serpent://source` 源文件，避免离屏渲染期间再次请求 Worker 造成重入等待。
- 稳定复现后的最终根因：`src/main/index.ts` 将 `ipcMain.on` 直接接到只接收 `payload` 的 `onFrameMessage` 回调。Electron 实际回调参数为 `(event, payload)`，导致 Main 把 `IpcMainEvent` 当成帧消息解析并丢弃；离屏页面虽然已经完成 `OBJ/MTL` 加载、渲染和 PNG 生成，Worker 仍等待到 `MODEL_RENDER_TIMEOUT`。
- 修复：Main 增加事件参数解包适配器，并在取消监听时移除同一个包装函数；未改变 Worker/Renderer 的协议结构或路径权限边界。
- 证据：`node scripts/run-e2e-isolated.mjs tests/e2e/model-thumbnail.test.ts` → `1 passed (2.7s)`；同次 `model-viewer` 对比旅程 → `2 passed (4.8s)`；E2E 使用隔离 `SERPENT_E2E_USER_DATA_PATH`，断言 `img.asset-thumbnail` 的 `complete`、`naturalWidth > 0` 与 `naturalHeight`。
- 2026-08-06 补齐格式矩阵 E2E：OBJ/MTL、glTF + 外部 `.bin` companion、运行时生成 GLB、STL、FBX 共 `5 passed (10.7s)`；每项均断言卡片缩略图实际完成解码且 `naturalWidth > 0`。
- 矩阵首次加入 glTF 时，真实日志复现 offscreen CSP 拦截内嵌 `data:` buffer（`Fetch API cannot load data:...`）并返回 `MODEL_LOAD_FAILED`。根因是 `index.html` 与 `offscreen-thumbnail.html` 的 `connect-src` 未允许 glTF 合法的内嵌 data URL；已在两个 Renderer CSP 中加入显式 `data:`，并同步 CSP 单测。外部 companion buffer 也保留在矩阵中覆盖路径重写。
- 同次矩阵曾受遗留 `electron-forge start` 与 E2E 共用 `.vite` 的构建竞态影响，日志显示 preload/renderer 文件被清空导致页面关闭；停止遗留开发实例和旧循环后复跑稳定通过。
- 当前状态：`Serpent-pjx2` 的导入后离屏缩略图自动生成与实际解码已具备自动化证据，已加入 `MODEL-001` 待人类验收。Computer Use、packaged 与 Windows 尚未执行；不能据此宣称 0030 切片整体完成。
- 2026-08-06 当前工作树复测：`node scripts/run-e2e.mjs tests/e2e/model-thumbnail.test.ts tests/e2e/model-viewer.test.ts tests/e2e/import-conflict-flows.test.ts` → `9 passed (15.7s)`；其中模型缩略图矩阵 5 项、查看器 OBJ/FBX/HDRI 3 项、导入冲突流程 1 项均通过。定向 3D/CSP 单测 → `9 files / 78 tests passed`。日志中的字体 data URL 警告与 WebGL 弃用警告未导致测试失败，需后续独立处理。

### 2a. HDRI 选择器 UI（Serpent-pd6k，正式 P1）

2026-08-06 用户反馈：当前 HDRI 值控件布局异常，环境光名称被窄布局拆成竖排显示。当前值区域应只显示环境光照名称，不显示缩略图；打开选择器时才显示预设缩略图，且缩略图应明显大于当前版本。选择器中的「自定义」入口删除。正式规格已同步撤回 3D-18 自定义 HDR 能力，当前选择器仅保留内置 HDRI 预设。

**实现**：
- HDRI 当前值触发器移除缩略图，仅保留水平单行名称；长名称使用中间区域省略，不再被窄布局拆成竖排。
- 选择器预设缩略图统一为 `144×82`，选择器宽度调整为 `300px`，名称使用 caption 字号并限制显示宽度，保留四个内置预设。
- 移除「自定义」入口及对应中英文文案；旧版本持久化的 `custom` 值读取时回退到默认内置预设，避免继续暴露已撤回能力。
- 新增 3D 查看器 E2E：验证当前值无缩略图、选择器四个预设均有较大缩略图、无「自定义」、切换预设后名称更新。

**验证**：最终 `npm run typecheck`、`npm run lint` 通过；`npm run test:unit` 结果 `304 files / 2255 passed / 1 skipped`；`node scripts/run-e2e.mjs tests/e2e/model-viewer.test.ts` 结果 `3 passed (8.4s)`，包含实际图片解码断言；首次加入 UI 用例时，键盘 Space 激活路径的失败上下文显示误打开 `cube.mtl` 查看页，已改为直接双击模型卡片进入查看页并复跑通过。Computer Use、packaged 与 Windows 仍未执行。
- 2026-08-06 当前工作树复测同一 `model-viewer.test.ts` → 3 项通过（OBJ、FBX、HDRI 名称/放大预览）；实际缩略图解码由同批次 `model-thumbnail.test.ts` 覆盖。Computer Use、packaged 与 Windows 仍未执行。

### 2b. HDRI 右键拖拽旋转（Serpent-xjcy）

当前工作树已具备该工单要求的交互链路：`OrbitControls` 释放右键相机操作，画布在 capture phase 处理右键或 Ctrl+左键 pointer 事件并累计横向拖拽量，`environmentYaw` 通过 `scene.environmentRotation.y` 改变环境光方向；中键仍保留给相机 dolly，系统 context menu 被阻止。新增手势策略单测覆盖右键、Ctrl+左键和普通左键排除，`MODEL-003` 验收步骤扩展为两种旋转方式；真实 Computer Use、packaged、Windows 尚未执行，工单保持进行中。

### 2c. 2026-08-06 最新 3D 与 Info 反馈收口

用户新增反馈覆盖离屏缩略图光照、查看器提示语义、HDRI 操作和选择器比例，以及顶部 Info 通知的空白区域。实现范围如下：

- 离屏缩略图不再显式关闭 HDRI；`renderModelThumbnailFrame` 使用默认内置环境光，HDRI 请求失败时仍沿用接触阴影 key light 降级，避免模型变成黑帧。
- 3D 查看器的高三角面、超大贴图、FBX 降级和缺失贴图提示统一通过 `Notice tone="info"` 渲染。自定义 `.model-viewer-notices` 的背景/边框样式已移除，仅保留查看器内定位样式。
- HDRI 光源旋转抽出纯手势策略：保留右键拖拽，并新增 macOS 触控板及 Windows 通用的 Ctrl+左键拖拽。事件使用 capture phase 在 `OrbitControls` 前拦截，避免同一手势同时旋转模型和环境光。
- 顶部 Info 通知改为内容自适应宽度，短消息不再固定占用 `520px` 的整段横向空间；长消息仍受最大宽度限制。

**验证**：

- `npm run typecheck` → 通过。
- `node scripts/run-vitest-with-electron.mjs run tests/unit/environment-rotation-gesture.test.ts tests/unit/offscreen-page-renderer.test.ts tests/unit/3d-viewer-limits.test.ts tests/unit/ui-patterns.test.ts` → `4 files / 30 tests passed`。
- `node scripts/run-e2e.mjs tests/e2e/model-thumbnail.test.ts tests/e2e/model-viewer.test.ts` → `8 passed (15.2s)`；模型缩略图 5 种格式均实际解码，HDRI 选择器 4 张预览均完成解码并满足新尺寸断言。
- `node scripts/run-e2e.mjs tests/e2e/pbr-texture-preview.test.ts` 首次复跑暴露测试 fixture
  生成相同像素内容，真实导入冲突对话框因此阻断卡片；改为每个 fixture 使用不同背景值并将
  卡片等待提升到 15 秒后，当前 HEAD 定向 E2E `1 passed (4.4s)`。
- 通知回归测试先以旧布局复现 `520px > 420px`，修复后宽度断言通过；同次测试随后在既有智能合集菜单定位处失败，未将该次运行记为完整通过。
- `npm run verify:mainline` 中途复现上下文菜单 pointer/portal 竞态并修复；当前 HEAD 最终复跑通过：
  单元/Worker `352 files passed / 3076 tests passed`、搜索性能 `5 passed`、主线 Electron E2E
  `72 passed / 3 skipped`。
- 当前 HEAD `npm run package` 在 `prepackage` 的 `media:verify` 被 macOS arm64 媒体 bundle
  未晋升为不可变 HTTPS + SHA pin 阻断；未跳过 provenance，暂无 packaged 证据。
- Computer Use、packaged、Windows 仍未执行；需由人类验收确认缩略图亮度、Ctrl+拖拽旋转和 Info 视觉密度。

### 3. 格式过滤预设 chip 扩展（Serpent-1d4w，已关闭）

**根因**：`DimensionFilterBar.tsx` 预设 chip 硬编码 7 个（png/jpg/webp/gif/mp4/mov/text），自由文本过滤虽可用（`expandFormatFilterTokens` + LIKE，无白名单）但 chip 未覆盖 audio/3D/RAW/psd/exr 等。

**修复**（提交 `83ed613`）：新增 `src/renderer/format-filter-presets.ts` 从 `IMAGE/VIDEO/AUDIO/MODEL` 注册表派生分组 chip（图像/视频/音频/3D 模型/文本），注册表扩展自动同步；i18n 中英各 5 键；分组样式。验证：typecheck/lint 0、单测 18/18（含新 4 个：注册表全覆盖 + 无点 token + 去重 + text 独立）。

### 4. 资产标题显示完全错误（Serpent-kmgw，已提交）

**根因**：`.asset-filename-prefix` 的 `flex: 1 1 auto`——`flex-grow: 1` 在短名时把前缀拉宽填满整行，尾段/扩展名被推至最右：`ZKH09734.ARW` → 「ZKH09（左）+ 大段空白 + 734.ARW（右）」。Inspector 侧（`.inspector-hero-compact .asset-filename-prefix`）早已用 `flex: 0 1 auto`（带注释），卡片侧漏同步。

**修复**（提交 `7aaa139`）：`.asset-filename-prefix` 改 `flex: 0 1 auto`——名称放得下时三段紧排，溢出时前缀收缩 + 中间省略号（`wertyuiasddf...dad.mp4`）。

## 基础设施修复：beads Dolt 与 JSONL 镜像脱节

发现本地 Dolt 缺 346 条 JSONL-only 工单记录（`bd list` 查不到 3D 工单、`bd create` 后 auto-export 拒绝覆盖）。按规则处理：
- `bd dolt pull` 从远端同步（首次 SSL 抖动失败，重试成功）
- 剩余 1 条 `Serpent-hf1t`（Mac 侧主题工单，JSONL-only）→ 导出单条快照 → `bd import <snapshot> --json` 增量 upsert（未用 `bd init --from-jsonl` 覆盖式重建）
- auto-export 恢复，`.beads/` 镜像随代码提交同步

## 未完成 / 待办

- pjx2 及 pd6k 的人类验收、Computer Use、packaged 与 Windows 平台验证
- pd6k HDRI 当前值/选择器 UI 的 Computer Use、packaged、Windows 与人工验收
- kmgw 的 E2E 视觉复现（本机 E2E 手动流程被原生对话框阻塞，需 SERPENT_E2E_* hook；修复已提交，用户实机确认中）
- 临时测试 `tests/e2e/tmp-*.test.ts` 验证后清理或转正
- packaged 验证（.hdr 哈希发射、离屏窗口、GLB 产物）仍为 0030 未执行项

### 5. schema 版本兼容性根治（Serpent-033e，2026-08-07）

**事故**：本机资源库被未合入代码的 v34 迁移升级（应用时间 2026-08-05 23:24），v33 构建打开时抛 LIBRARY_VERSION_TOO_NEW 直接拒绝 → 用户打不开资源库。产品要求：公开后不允许因 schema 版本打不开库。

**根因链**：① 版本门禁（migrateDatabaseUnserialized）对 `version > SUPPORTED` 直接 throw；② UI 只有模糊失败（"The recent library could not be reopened"）；③ 无迁移纪律约束。

**修复**（ADR-0028，提交 bdb63bd）：
- **只读降级**：openLibrary 先只读探测 user_version，高于支持版本 → SQLite readonly 连接打开（跳过迁移/校验/watcher/恢复等全部写路径），summary 带 readOnly/libraryVersion/supportedSchemaVersion 透传 renderer 显示全局提示条
- **写拒绝**：SQLite 连接级只读保证写失败（SQLITE_READONLY），publicErrorForWorkerFailure 统一映射为 LIBRARY_READ_ONLY 可操作错误（含 i18n 中英）
- **只读关闭**：closeLibrary readOnly 分支跳过 cancelJobs 等写清理
- **迁移纪律**（ADR-0028）：只加不改（新表/新列可空或默认/新索引；禁删改现有结构），保证只读降级永远安全
- 既有测试 `rejects a database created by a newer schema version` 更新为只读语义；新增 tests/worker/library-schema-readonly.test.ts 4 用例
- 事故库恢复：`.serpent/library.db.bak-v34` 备份后 user_version 降回 33（v34 未增删表、核心查询全通），冒烟验证后用户可打开

**用户补充要求（2026-08-07）**：只读降级只是兜底，**完全兼容旧版本数据**才是正道——"如果以后也会出现不兼容旧版本数据的情况就麻烦了"。已将「数据兼容性纪律」写入 CLAUDE.md（系统提示词，强制）+ 强化 ADR-0028 原则：新代码打开旧库自动无损迁移、旧数据升级后全功能可用是硬目标；迁移只加不改；迁移验收必须证明旧库升级无损；违反不合并。

### 6. 缺失衍生件自动补生成（Serpent-5xbg，2026-08-07）

**需求**（用户）：检测到文件未完成处理（缩略图/代理/poster 生成失败）就自动后台处理，**不依赖导入时**——生成失败（ffmpeg 暂不可用、进程被杀、任务取消）后必须能自愈。产品决策：**不做定期扫描**，改为**资产加载时检测**（打开库 + 浏览可见即触发）。

**根因**：enqueueThumbnailJobs 的入队条件 `NOT EXISTS (status IN ('ready','failed'))`——**failed artifact 永久挡住重新入队**，失败后无任何后续触发点（MEDIA-003 组件修复仅覆盖组件缺失且单会话一次）。

**实现**（提交 12326e1）：
- 新模块 `src/worker/derived-artifact-repair.ts`：`requeueRetryableFailedArtifacts`——单条 SQL 找出「可重试 failed 衍生件」（源 available + error_code 不在持久失败集 + 上次失败 ≥ 30 分钟节流 + 无 active job）→ invalidate（现有入队 SQL 自动重新匹配）。**持久失败**（SOURCE_NOT_FOUND/FILE_TOO_LARGE/UNSUPPORTED_FORMAT/FBX_NOT_FBX 等 10 码）保持 failed 标记永不重试
- `enqueueThumbnailJobs` 新增 `retryFailed` 选项；openLibrary startup + scheduleThumbnailScene 全部场景带 `retryFailed: true`——**打开库/浏览到即自动补生成**
- 测试：tests/worker/derived-artifact-repair.test.ts 5 用例（可重试重入队、持久失败不重试、节流、源缺失不重试、幂等）
- 测试期间发现并验证了两个既有正确行为：资产刷新按 mtime+byte_size 旋转 revision、reconcileMissingArtifactFiles invalidate 缺失文件 artifact——fixture 需构造精确匹配

### 7. FBX 分文件 metalness/roughness 贴图丢失（Serpent-a5ic，2026-08-07）

**用户反馈**：带贴图 FBX（jk黑丝女主，56MB Max 导出，.fbm 4 张 4096 PNG）加载后贴图未正确显示；"之前可以，用了 ufbx 之后不行"。

**根因**：ufbx-bridge.c 的 metallicRoughness 合并条件 `mr_tex = (metal_tex == rough_tex)`——**仅同一文件时合并**；分文件模型（`_metallic.png` + `_roughness.png`）两张都被丢弃 → GLB 材质无 metallicRoughnessTexture → metalness=0/roughness=1 无金属质感。之前 FBXLoader 兜底路径是 Blinn-Phong 近似，观感尚可。

**修复**（提交 089a46d）：
- C 桥输出独立 `metalnessTexture`/`roughnessTexture` scene 索引（WASM 重建 + lock 哈希更新，glue 不变）
- glb-builder：不同文件时用 sharp **像素合成** metallicRoughness 纹理（R=255、G=roughness、B=metalness、A=255，尺寸取 metalness 图）；合成前按文件名后缀校验交换（本地化 DCC 导出器的槽位映射可能反——用户模型实测桥把 metalness 指到了 _roughness.png，文件名修正后通道正确）
- embedded 纹理直接从桥 blob 区读取（resolveExternalTextures 跳过 embedded）
- 测试：direct-descriptor 合成用例（1×1 灰度源 → 断言合成像素 B=0/G=128/R=255/A=255 + matching 警告消除）；用户模型验证：metallicRoughnessTexture 引用 ✓、B 通道均值=metalness 源（11.9=11.9）、G=roughness 源（113.8=113.8）
- fixture 尝试（手写 ASCII FBX 模拟 ufbx PBR 属性识别）失败回退：ufbx 的材质属性表（blender/3dsMax/glTF 变体）与手写格式不匹配，测试改为直接构造 descriptor
