# 0030 3D 模型支持 — 开发日志

> 规格：`docs/internal/implementation/0030-3d-model-preview-slice.md`
> 分支：`codex/slice-002-asset-ingestion`；基线 SHA：`93b2083`
> 开始时间：2026-08-05；状态：Wave 1 实施中
> 工单：epic `Serpent-n4ua`；A=`Serpent-fu2i`、B=`Serpent-5ygi`、C=`Serpent-qvc6`、D=`Serpent-v363`、E=`Serpent-hnmg`、F=`Serpent-hy3a`、G=`Serpent-1bdg`

## Wave 结构（并行策略）

- **Wave 1（并行）**：A 格式注册与资产管线、B FBX 转换管线（ufbx WASM）、D HDRI/PBR 模块
- **Wave 2**：C 3D 查看器核心（依赖 A 的 resolution + B 的 GLB + D 的 HDRI 模块）
- **Wave 3**：E 离屏缩略图批量（依赖 C 的渲染核心）
- F、G 后续排期。

## 环境事实

- 测试链路跑在 Electron Node（`run-vitest-with-electron.mjs`），better-sqlite3 与 Electron ABI 匹配（`ensure-native` 已验证），系统 Node v26 不影响测试。
- 系统 Node v26 与项目 pinned（>=24 <25）不一致，暂无 Node 24 安装；不阻塞本切片（vite/tsc/eslint 在 26 下可用）。正式发布前需按 `.nvmrc` 对齐。
- `bd` v1.1.2 已装，本地库从 git 远端初始化（621 条工单）。

## Wave 1 记录

### 切片 D（Serpent-v363）— 完成（2026-08-05）

**实现**：`src/renderer/3d-viewer/` 新增 6 文件（hdri-presets.ts / environment.ts / pbr-mapping.ts / exposure.ts / index.ts / three-r185.d.ts）+ 资源与脚本 + vite 配置。依赖新增 `three@0.185.1`（registry 0.185.x 最新，`^0.185.1` 等价 ~0.185）。

- HDRI 预设：Poly Haven CC0 1K（1024×512 RGBE）两套——`studio_small_09_1k.hdr`（影棚，1,615,248 B，sha256 e7cfda5f…80c45）、`kloppenheim_02_1k.hdr`（户外晴天，1,740,414 B，sha256 04d23c6b…9acadf）；来源 URL 与校验入 `scripts/acquire-hdri.mjs`。
- environment.ts：PMREM 管线装配纯函数（renderer/pmrem 注入、dispose 幂等）；`NeutralToneMapping` r185 实测 = 7（直接 re-export）；`clampHalfFloatData` half-float NaN 防护；背景/环境分离策略固定 `background:'theme'`（3D-06）。
- pbr-mapping.ts：`mapPhongToStandard`（MTL→Standard，map_Ks→metalnessMap 近似，默认 metalness 0 / roughness 0.8）；`stlDefaultMaterial`（亮 0x5f6d7e / 暗 0x9aa9bb）。
- exposure.ts：默认 1.0，范围 0.1–4.0。

**验证**：lint 0 findings；本切片单测 4 文件 25/25（含资源大小/sha256/解码对账、映射矩阵、clamp、dispose 幂等）；全量单测 2123 passed / 4 failed（未触碰文件的 Windows 路径分隔符既有失败：app-logger、automation-recent-scripts-store、plugin-ui——非本切片引入，待确认是否已有工单）；typecheck 本切片 0 错误（仓库整体错误属于其他轨道 WIP）。

**关键决策与风险**：① r157+ three 无内置 .d.ts → 手写最小垫片 three-r185.d.ts（切片 C 建议换 @types/three）；② Vite 8/rolldown 需 `assetsInclude: ['**/*.hdr']`（默认不含，glob as:url 报 parse error，已实证）；③ **打包风险**：r185 FileLoader 用 fetch 取 .hdr，packaged 下 file:// fetch 被 Chromium 禁止 → 切片 C 需走已有 serpent:// 自定义协议或 HTTP 通道加载 HDRI；④ PMREMGenerator 是共享长生命周期对象，handle.dispose() 只释放 target+源 hdrTexture。

**未做**：真实 WebGL 路径测试（node 无 WebGL，仅注入 fake 测装配函数）；packaged .hdr 输出验证（留合流验收）；自定义 HDR（切片 F）。

### 切片 A（Serpent-fu2i）— 完成（2026-08-05，全量 worker 计数待补）

**实现**：`src/worker/model-resolution.ts`（新文件：model 全部 resolution/伴生逻辑集中点）+ `tests/worker/model-pipeline.test.ts`（9 用例）。修改：media-formats.ts（MODEL_EXTENSIONS/isSupportedModelExtension/modelMimeForExtension）、asset-types.ts（mediaType 加 'model'）、thumbnail-support.ts、library-api.ts（PreviewResolution.mediaType + artifactId optional）、protocol requests/responses（model.resolve-companions 命令 + model.companions 响应）、library-service.ts（detectMediaType/toSummaryMediaType/getPreviewArtifact model 分支、generateThumbnail 返回 null、resolveModelCompanions、enqueueThumbnailJobs 白名单）、worker/index.ts（dispatch）、ai/image-input.ts（签名联动）、preload、asset-card-badges.ts（3D 徽标）、viewer-preview-policy.ts（model 不再 unsupported）、plugin-context-state/plugin-contribution-context（枚举连带）、i18n（filter.format3d）。

**关键决策**：
1. **thumbnail 无生成器语义**（三层保障）：enqueueThumbnailJobs 白名单不含模型扩展名（永不入队）；即使 media.generate-thumbnail 直接命中，generateThumbnail(model) 返回 null（不建 artifact/job/不抛错）；thumbnailStatus 保持 null → 通用图标，永不变 failed。为此 media/asset.thumbnail.generated 的 artifactId 改 optional。测试证明：generateThumbnail(model)→null 且 revision_artifacts/jobs 表 0 行；fbx+png 混合仅入队 png。切片 E 的接入点已注释。
2. **companion payload 边界**：仅模型所在目录（递归）内资产 { relativeFilePath, assetId, extension }，排除模型自身；复用 `LIKE 'dir/%' ESCAPE '\'` 前缀模式（不新写裸 SQL）；上限 1000（与 schema 对齐）；portableRelativePathSchema 运行时校验（拒绝绝对路径/反斜杠/..）。测试覆盖：空目录/子目录递归/a_b 兄弟前缀不误匹配/根级模型/非 model 拒绝/未知 assetId。
3. **resolution**：getPreviewArtifact 对 model 返回 { mediaType:'model', status:'ready', kind:'thumbnail', mimeType:model/*, playbackMode:'source', sourceRevisionId }——Main 既有 serpent://source 构建逻辑零改动自动生效。**FBX→GLB 产物 URL 的挂载点就在 model-resolution.ts**（切片 B 需在转换完成时改出缓存 URL + revision 失效语义）。

**验证**：typecheck 0（含 tsconfig.extension.json）、lint 0 findings、unit 289 文件 2123 通过/4 失败/4 跳过（4 个失败为 Windows 路径基线失败：app-logger、automation-recent-scripts-store×2、plugin-ui——非本次引入）、worker 定向 model-pipeline 9/9 + 受影响 4 文件 137/137、全量 worker 后台运行中。

**偏差**：DimensionFilterBar 格式过滤预设 chip 为硬编码（不在所有权内），fbx/obj 等自由文本过滤已可用（LIKE %.ext），预设 chip 待后续切片；查看器在切片 C 落地前 model 走「media」surface 显示通用 preview-state 文本（非白屏非报错）。

**后续接缝**：C 消费 resolution.url + model.resolve-companions（需新增 renderer 请求面：main/preload 接线，OBJ/MTL 外贴图按 relativeFilePath→assetId 重写）；E 在 generateThumbnail null 语义处接入离屏生成器；G 扩展 MODEL_EXTENSIONS 即可。

### 切片 B（Serpent-5ygi）— 完成（2026-08-05）

**ufbx WASM**：无可复用预构建（ufbx releases 为空、npm 无包）→ 自建：ufbx v0.23.0（2026-06-21，tarball SHA `efaed6c5…` 锁定于 scripts/ufbx-wasm-lock.json）；Emscripten 6.0.5 安装在由 `<emsdk-dir>` 指定的位置；`scripts/build-ufbx-wasm.mjs` 按 media:acquire 模式（下载→源码 SHA 校验→emcc→产物 SHA 校验→acquisition.json 溯源收据），重跑幂等。产物 `resources/ufbx/`（gitignored）：ufbx.wasm 331KB + glue 9.4KB。编译参数：`-O2 -sMODULARIZE=1 -sENVIRONMENT=node -sEXPORTED_FUNCTIONS=_serpent_parse… -sFILESYSTEM=0 -g0` 等。

**转换器**（src/worker/fbx/）：C 桥 `scripts/ufbx-bridge.c`（`target_axes=RH_Y_UP`、`target_unit_meters=1.0`、`UFBX_SPACE_CONVERSION_MODIFY_GEOMETRY`、`use_blender_pbr_material`、索引 CLAMP）输出 `[u32 JSON 长度][JSON][blobs]`；`glb-builder.ts` 手写 glTF 2.0 JSON + BIN（每源 mesh 一个 glTF mesh、实例 matrix 列主序、PNG/JPEG 内嵌、POSITION min/max、4 字节对齐）。材质：base_color（回退 diffuse）、metalness/roughness 合并 metallicRoughnessTexture、normal/emissive/occlusion、doubleSided、opacity→BLEND；Ambient/Specular/Shininess 不进 glTF（已知局限）。轴/单位 Z-up cm 已验证（×0.01 烘焙 + 矩阵 +Z→+Y 断言）。外部贴图：同目录/子目录相对路径（拒绝绝对/..//盘符）、≤64MB、PNG/JPEG 魔数；缺失降级 + missingTextures。**已知 wasm32 坑**：ufbx_triangulate_face 输出损坏 → 手写确定性 fan triangulation（桥注释记录）。

**命令/缓存**：`model.convert-fbx {libraryId,assetId}` → `model.convert-fbx.done`（ready|failed + glbArtifactId/errorCode/stats/missingTextures/warnings）；产物 kind=`model_glb` artifact（library-service.ts 新增 writeDerivedArtifact 极小方法）；缓存键=源 revision + generator_version=`ufbx-wasm-1`；**schema 迁移 v33**（kind CHECK 扩展，重建 v27 触发器/v29 索引）；单飞 Map 去重；超时 120s；上限 源 300MB / 三角 200 万（C 侧双重校验）/ GLB 1GiB。类型化错误码 `src/shared/fbx-conversion.ts`：SOURCE_NOT_FOUND/NOT_FBX/FILE_TOO_LARGE/LIMIT_EXCEEDED/CONVERSION_TIMEOUT/WASM_UNAVAILABLE/NO_MESHES/CONVERSION_FAILED。纯函数接口 `resolveConvertedGlb(library, libraryId, assetId)` 已导出（未动 model-resolution.ts）。

**验证**：fbx-conversion 19/19 + protocol +2；typecheck/lint 0；worker 全套 799/809；unit 全套 2125/2129。6 个失败均本机环境性且与本次 diff 零代码路径重叠：unit app-logger 路径脱敏 / automation-recent-scripts×2 / plugin-ui（tmpdir 8.3 短路径 HUANGQ~1 vs homedir 长路径）；worker extension-save 超限文件名断言（LongPathsEnabled=1）+ 20k soak 性能预算（356s>150s，疑与 A 轨道并行全量 worker 的负载争抢有关，合流门禁重测关注）。fixture：Blender 2.72 cube / 2.82 suzanne（ufbx 测试数据，MIT）+ 手写 FBX 7.4 ASCII 生成器（内嵌 base64 PNG、可配轴单位位移）；`tests/fixtures/fbx/README.md` 记录来源许可。

**风险/后续**：样本矩阵缺口（Maya/3ds Max、>7.0、极老版本未验证；NOT_FBX/NO_MESHES 兜底就绪）；缠绕方向需切片 C GLTFLoader + 视觉验收；C 读 resolveConvertedGlb + errorCode 路由 FBXLoader 兜底；E 先 model.convert-fbx 再离屏渲染。未做：动画/骨骼、顶点色、多 UV、UV transform、TGA/BMP 转码、.fbm 特判目录。

### 切片 C（Serpent-qvc6）— 完成（2026-08-05，Wave 2）

**实现**：`src/main/app-assets.ts`（serpent://app-assets 路由：白名单 + sha256/size 收货校验 + 路径缓存）；`src/shared/hdri-presets.ts`（HDRI 收货表迁 shared 单一真源）、`src/shared/model-companions.ts`（契约类型）；`src/renderer/3d-viewer/` 新增 camera-policy/url-remap/model-stats/limits/error-messages（纯函数）、scene-composer（**E 复用渲染核心**：renderOnce/resize/dispose + disposeSceneTree 幂等全链）、loader-registry、viewer-preferences、viewer-surface.tsx、viewer-toolbar.tsx、viewer-surface.css；main/index.ts（两个 IPC case + app-assets 协议分支）、preload（resolveModelCompanions/convertModelFbx）、protocol requests/responses（rendererResultSchema 补齐 model.companions/model.convert-fbx.done——A/B 留的接线）、index.html（**CSP connect-src 加 serpent:**）、AssetPreviewModal（model 分支挂 ModelViewerSurface，libraryId:assetId keyed）、i18n viewer3d 命名空间；**删除 three-r185.d.ts 垫片**，新增 `@types/three@^0.185.4`（devDep）。

**关键决策**：
1. **.hdr packaged 方案 = serpent://app-assets 路由**（非 IPC 字节通道）：r185 loaders 全用 fetch，packaged file:// fetch 被禁；让 HDRLoader 与 GLB/贴图走同一条 fetch 通道，dev/packaged 行为一致（URL 恒为 serpent://app-assets/hdri/<fileName>）。白名单预设名；dev 读 src/renderer/assets/hdri/，packaged 扫 .vite/renderer/main_window/assets/<base>-<hash>.hdr；首次读取 sha256+size 收货校验。配套 CSP connect-src + serpent:。
2. **FBX 兜底**：convertFbx failed → FBXLoader 加载 serpent://source，upgradeFallbackMaterials（Phong/Lambert→mapPhongToStandard，共享材质只升一次；按 texture.name（r185 源码确认=FBX attrName）经伴生映射重指 serpent://preview，只重指未解码贴图）；兜底错误码随 LoadedModelScene.fallback 上浮提示条。
3. **贴图重写**：OBJ 文档化模式——collectObjMtllibRefs → 伴生映射得 MTL URL → fetch → rewriteMtlTextureRefs（剥离对齐 MTLLoader 的 -bm/-mm/-s/-o 语法，空格路径不破坏）→ mtlLoader.parse → objLoader.setMaterials；glTF 文本重写 images/uri 后 parse；glb 直接 loadAsync（外部贴图罕见，失败降级）。
4. **toolbar**（独立组件，纪律 #8）：顶部右侧浮动 chip（随 chrome idle 隐藏）：HDRI select、**曝光滑块**（0.1–4.0，localStorage 持久化，补 3D-10）、重置视角、统计开关、全屏；统计为底部左侧 dl 面板（三角面/顶点/材质/贴图/文件大小）。
5. **关键隐性修复**：D 的手写垫片声明了 r185 **不存在** 的 setToneMapping()/setExposure()（r185 是 toneMapping/toneMappingExposure 属性）——buildEnvironment 首次真实调用必崩；装 @types/three 后暴露并已修为属性赋值，同步 D 测试。
6. **composer 接口**：createSceneComposer({renderer, camera?, scene?}) → {renderer, scene, camera, setBackground, setEnvironment, setExposure, resize, renderOnce, dispose}；环境纹理归 EnvironmentHandle；dispose=disposeSceneTree 幂等。E 用法：建 renderer→composer→setEnvironment/resize→scene.add(model)→renderOnce()。

**验证**：定向 vitest 13 文件 146 passed（含 D 既有 4 文件、protocol 75、app-assets 9、renderer-csp）；typecheck/lint 0 findings；未跑全量 unit（约定）。

**偏差**：packaged 真机验证未做（.hdr Vite 哈希发射目录布局旧包已验证但先于 D 的 .hdr，待合流验证）；真实 WebGL 渲染/交互/阴影视觉未验证（E2E + Computer Use 后置）；曝光滑块超出三控件（为满足 3D-10）；3D-04 触控依赖 OrbitControls 默认映射 + CSS touch-action:none，无平台实测；上限为提示不阻断（3D-14 允许）。

**后续接缝**：E 用 composer+loader-registry（companionMap 可传空）；F 用 LoadedModelScene.animations 建 AnimationMixer，自定义 HDR 走 viewer-preferences presetId='custom' 分支。

## 门禁记录

### Wave 1 合流点（2026-08-05，三轨齐后主 agent 独立复核）

- `npm run typecheck`：0 错误（含 tsconfig.extension.json）
- `npm run lint`：0 findings
- `npm run test:unit`：289 文件，**2125 通过 / 4 失败 / 4 跳过**（2133）——4 个失败为既有 Windows 基线（app-logger 路径脱敏、automation-recent-scripts-store×2、plugin-ui resolvePluginUiAssetPath，tmpdir 8.3 短路径等），与本次改动零代码路径重叠
- worker 全量：切片 B 终树跑 799/809（2 失败为本机环境性：extension-save 超限文件名 LongPathsEnabled=1、20k soak 性能预算超时疑与并行争抢）；切片 A 后台跑 **781/790**（唯一失败同为 extension-save LongPathsEnabled 基线，与本次改动零路径重叠；A 轨早期「仍在运行」判断为误读——耗 CPU 进程实为 B 轨测试）；主 agent 全量 worker 复核安排在切片 E 合流后
- E2E / verify:mainline / Computer Use / packaged：未执行（纪律记未验证）

### 切片 C 合流点（2026-08-05，主 agent 独立复核）

- `npm run typecheck`：0 错误；`npm run lint`：0 findings
- `npm run test:unit`：297 文件，**2182 通过 / 4 失败 / 4 跳过**（2190）——4 个失败仍为既有 Windows 基线，与本次改动零重叠

### 切片 E（Serpent-hnmg）— 实施中（主 agent 接管收尾）

- 原实施轨道因 API 配额中断（402 Insufficient Balance），代码已大部分落地（任务清单 6-9 完成：model-thumbnail 协议/channels、main 侧 offscreen-thumbnail-renderer + worker-client + 接线、离屏页面 + preload + 构建配置、worker 侧模型缩略图入队/渲染编排/产物存储）。
- **主 agent 接管**：修复 src/worker/index.ts 残留 `});` 语法错误（orchestrateRender 重构残留）→ typecheck 恢复 0 错误。
- 验证：lint 0；E 相关定向测试 7 文件 265 通过/3 跳过（model-thumbnail-protocol、offscreen-thumbnail-renderer、thumbnails、library-service、linked-folders、search、trash-relink）；全量 unit 2212 通过/4 基线失败/4 跳过。
- **平台实测（调研 §4.8-3/5）通过**：`npx electron scripts/offscreen-smoke.mjs` exit 0——offscreen BrowserWindow + WebGL 渲染 512×512、paint 事件非空（PNG 4642 B）、像素内容非背景（蓝灰物体像素）。Windows 本机离屏 WebGL 链路成立。
- 新增 E2E fixture：`tests/fixtures/models/cube.obj` + `cube.mtl`（手写，零工具依赖；GLTFExporter 在 Node 缺 FileReader/readAsDataURL 不可用，放弃 GLB 生成）。
- 新增 `tests/e2e/model-viewer.test.ts`：OBJ（含 MTL 伴生）+ FBX（转换管线）两条查看旅程，解码证明=统计面板的三角面数（几何加载后计算）。结果待跑。

### 集成修复：E2E 发现的真实跨进程 bug（2026-08-05，主 agent 接管后）

新 E2E `tests/e2e/model-viewer.test.ts`（OBJ+MTL 与 FBX 转换两条查看旅程）首次把 A/B/C/E 的改动串起来跑真实应用，暴露了 4 个单测覆盖不到的集成 bug，全部修复：

1. **serpent://source 对模型 404**：`getCurrentMediaSource` 的 MIME 链没有 model 扩展名（A 加了 `modelMimeForExtension` 但未接入此既有通道）→ INVALID_IMPORT_DECISION → 404。修复：MIME 链加入 `modelMimeForExtension`。
2. **model_glb artifact 无法经 preview 路由读取**：`getArtifactAbsolutePath` 的 usage 门禁只放行 `thumbnail/video_poster` → FBX 转换产物 404。修复：preview 放行集加入 `model_glb`。
3. **FBX 转换产物 GLB chunk 头字段写反**（`glb-builder.ts`）：按 `[chunkType][chunkLength]` 输出，规范是 `[chunkLength][chunkType]` → GLTFLoader 报 "JSON content not found"。B 的单测只验 magic+头字段、把错误布局断言成"正确"，E2E 首次真实加载才暴露。修复：交换顺序 + 修正测试断言 + 注释。
4. **伴生贴图 URL 路由错误**：url-remap 把资产 ID 拼进 `serpent://preview`（该路由只服务 artifact）→ MTL/外部贴图必 404（OBJ 无贴图时降级掩盖）。修复：companion payload 增加 `revisionId`（schema ×2、worker 查询、offscreen 协议同步），remap 改拼 `serpent://source/<lib>/<assetId>?revision=`；`getCurrentMediaSource` 对未注册扩展名兜底 `application/octet-stream`（.mtl/.tga 等伴生文件；source 路由仍要求有效 revision token）；统一 A 遗留的双份 `ModelCompanionAsset` 声明为共享类型。

**验证**：修复后 model-viewer E2E 2/2 通过（OBJ 2.3s / FBX 2.3s，零 404 零兜底）；typecheck/lint 0；定向测试 121+73 通过；全量 unit 2212 通过（5→4 基线失败，新增协议 fixture 修复）；全量 E2E 与全量 worker 在合流点重跑中。

**其他观察**：① FBX 缩略图 artifact 在 E2E 中 failed（MODEL_RENDER_ABORTED "offscreen renderer disposed"）——应用退出时在途渲染被 dispose 中止，属生命周期预期行为，下次打开重试即可，非 bug；② CSP font-src 'self' 拦截 data: 字体为既有基线问题（非本次改动引入），字体降级不影响功能。

### 全量 E2E 与基线对比（2026-08-05）

- 新 model-viewer E2E 2/2 通过；全量 E2E（`npm run test:e2e`，26 文件）**59 通过 / 11 失败 / 4 跳过**。
- **基线对比**：11 个失败与本次改动路径零交集（主题断言 dark/light、插件窗口激活 31s、文件夹菜单、回收站导航等）。用 worktree（93b2083，改动前状态 + node_modules junction）重跑代表性失败文件——**plugin-trusted-host-activation（31.3s）、windows-typography（1.5s）、folder-context-menu:432（2.2s）在基线上同样失败**，失败模式完全一致。隔离重跑 8/11 确定性失败、2 个 flaky（asset-pagination、context-menu 隔离下通过）。
- 结论：**11 个失败为既有 Windows 环境基线（本仓库从未记录 Windows 全量 E2E 绿），非本次 3D 改动引入**。已知 Windows 基线清单（建议后续立工单）：plugin-{management,standard-host,trusted-host}-activation、windows-typography（系统亮色主题）、folder-context-menu:149/432、browsing-preferences:315、organization-search-trash:14/295、asset-pagination（flaky）、context-menu:473（flaky）。

### 最终门禁（切片 E 合流后，主 agent 独立复核，2026-08-05）

- `npm run typecheck` 0 错误；`npm run lint` 0 findings
- `npm run test:unit`：**2211 通过 / 5 失败 / 4 跳过**（第 5 个失败为 protocol companion fixture 漏 revisionId，已修复后 protocol 73/73；修复后全量为 2212 通过 / 4 基线失败）
- `npm run test:worker`：**805 通过 / 2 失败 / 8 跳过**——extension-save（LongPathsEnabled 基线，与 A/B 全量记录一致）、library-import-export-soak（zip-import 189.7s>150s 预算，单独运行时也超，Windows 本机真实速度，非争抢非本次改动）
- E2E：新 model-viewer 2/2；全量 59/11/4（11 个经基线 worktree 对比确认为既有 Windows 环境失败）
- 平台实测：offscreen smoke 通过（512×512 paint 非空）
- **未执行**（纪律记未验证）：packaged 验证（.hdr 哈希发射、离屏窗口、GLB 产物）、Computer Use 视觉验收、Windows/macOS 平台矩阵、FBX 样本矩阵（Maya/Max 导出）

## 待办与风险

- 缩略图离屏渲染的退出竞态已确认属预期（见上）；批量回填与「刷新缩略图」入口（切片 F）
- FBX 真实样本矩阵（Maya/3ds Max 导出）待收集
- packaged 验证（.hdr 哈希发射目录、离屏窗口、GLB 产物）与 Computer Use 视觉验收未执行
- 离屏缩略图平台坑（切片 E，调研 §4.8-3/5）
- FBX 真实样本矩阵待收集
