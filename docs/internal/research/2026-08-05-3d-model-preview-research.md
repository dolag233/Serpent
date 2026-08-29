# Serpent 3D 模型支持 — 竞品分析、视窗规格与技术选型调研

> 调研日期：2026-08-05
> 方法：三路并行调研（竞品 DAM 3D 支持、嵌入式 3D 视窗功能/交互规格、Electron + three.js 技术选型），结论均附来源 URL；无法验证的说法明确标注「未验证」。
> 背景：Serpent（Electron + TypeScript + SQLite + Vite + React，MIT，对标 Eagle/Billfish）需要支持 FBX、OBJ 等常见 3D 格式的正常预览；带贴图模型支持最简单 PBR 实时渲染，光源来自 HDRI 环境贴图，可切换（至少 studio + 自然）。

## 1. 结论摘要（TL;DR）

1. **格式**：DAM 行业共识的核心集是 **OBJ / FBX / glTF-GLB / STL**；高频附加为 DAE、PLY、3DS、USD/USDZ、3MF、BLEND。建议 v1 支持 FBX、OBJ/MTL、glTF/GLB、STL 四类，其余作后续增强。
2. **预览模式**：行业标准做法是「**按需生成缩略图 + 内置 WebGL 查看器交互预览**」双轨，**不做导入时全量渲染**（Eagle 插件按需刷新、Connecter OpenGL 查看器、Windows 3D Viewer 同模式；动画模型默认取首帧）。
3. **视窗交互**：采用**消费者约定**（Sketchfab / model-viewer / Marmoset Viewer / OrbitControls 一致）：左键拖拽=旋转、滚轮=缩放、右键拖拽=平移、双击=重置视角；打开时按包围盒自动取景、极角限制防翻顶、旋转带阻尼。不照搬 DCC 的 Alt 组合键。
4. **光照**：**IBL/HDRI 环境光是 PBR 预览的标准**（金属/光滑材质需要环境反射；单张环境贴图同时提供漫反射与镜面反射）。环境贴图 ≤1K 足够。色调映射用 **neutral（Khronos PBR Neutral）** 色彩最准，ACES 有色偏。曝光可调。
5. **材质**：PBR metallic-roughness 工作流；**albedo/baseColor + normal + metallic/roughness 必须参与着色**，AO/emissive/specular 有则用。glTF 是 PBR 事实标准格式。
6. **技术**：**three.js r185（MIT）** 为渲染引擎；**Poly Haven HDRI 全部 CC0**（1K 约 1.4 MB），捆绑 studio + 自然两套零合规负担；**FBX 采用 ufbx（MIT）解析并转换为 GLB**——开源社区的实践共识（Godot 4.3 起默认 ufbx 导入器并弃用 FBX2glTF，Blender 正在迁移到 ufbx）；ufbx 原生支持内嵌贴图提取，**不需要 Autodesk SDK**；转换后渲染器统一走 GLTFLoader 原生 PBR。three.js FBXLoader 仅作转换失败兜底。
7. **缩略图**：v1 采用「**首次打开查看器时截图 + 磁盘缓存**」（零 GPU 边角问题）；P2 再用共享离屏 BrowserWindow + `paint` 事件批量生成（`capturePage` 截隐藏窗口不可靠，已有多处已知 bug）。
8. **安全**：FBX 解析器有真实攻击面（微软因 CVE-2024-20677 在 Windows 3D Viewer 默认禁用 FBX）；three.js 解析在沙箱 Renderer 内进行，需加文件大小/面数/贴图上限与超时保护（参考 Space Thumbnails 的 >300 MB 或 >5 s 放弃策略）。

---

## 2. 竞品分析：DAM 桌面应用的 3D 支持

### 2.1 格式支持矩阵

| 产品 | 3D 格式 | 缩略图/预览 | 查看器能力 | 贴图/附属文件 | 备注 |
|---|---|---|---|---|---|
| **Eagle**（主对标） | 可导入：fbx, obj, 3ds, 3mf, dae, ifc, ply, stl, glb；官方插件扩展：glb/gltf, fbx, vtk, obj, stl, dae, ply, 3dm, 3mf, amf, lwo, 3ds, vox, pcd, xyz, spline, usdz/usdc, bvh, ifc, kmz, hdr, exr；主推 glb/gltf（效果最好） | 内置 360° hover 预览；**完整渲染缩略图需官方「3D 格式扩展」插件**，右键「更多 > 刷新缩略图」按需生成（非导入时自动）；动画模型默认取首帧 | 旋转/缩放；动画默认播放（多动画切换、拖进度条、任意帧设缩略图）；glb/gltf 支持 PBR 材质 + HDR 环境（1.9.0 起可更换环境贴图）；可配置各格式默认预览视角 | 支持格式**内嵌纹理**渲染（glb/gltf/fbx）；外部贴图（OBJ+MTL）不随模型打包/复制，模型与贴图在库中是独立素材 | 明确**不支持 3ds Max/Maya 等 DCC 工程文件缩略图**；3mf Production Extension 不支持；kmz 只预览不生成缩略图 |
| **Billfish**（主对标） | **未找到任何 3D 格式原生预览证据**；3D 文件只能走「支持导入」（无缩略图，需右键自定义封面） | 无 | 无 3D 查看器 | 不处理 | 2022–2025 用户持续呼吁 FBX/OBJ/glTF/STL（论坛原话：「唯一限制我不用 billfish 用 eagle 的就是你们还不支持 3D」）；云端库不能上传自定义导入的 3D 文件 |
| **Pixcall** | 官方插件：glTF, GLB, FBX, OBJ, STL, 3DS, PLY, DAE, **STEP, IGES, BREP, IFC**, 3MF, AMF（CAD 面最广） | 插件机制，安装后在详情页预览；缩略图生成时机未验证 | 官方文档未描述（未验证） | 未找到说明（未验证） | 0.9.5 另有 HDRI 预览插件 |
| **Connecter**（3D 资管专业工具） | 默认最广：3DS, C4D, DAE, FBX, GLB, gLTF, OBJ, USD/USDA/USDC/USDZ, 3DM, 3MF, ABC, BLEND, BVH, LW/LWO/LXO, MAX, MA, MB, PLY, SKP + CAD：DWG, DXF, IGES, SAT, STEP, STL；任意扩展名可自加 | 4 种途径：① 读 3ds Max 内嵌预览；② Max 插件视口截图；③ 无头 Max + V-Ray/Corona 等渲染（默认 20 min 超时）；④ **内置 OpenGL 查看器交互预览后截图** | FBX/gLTF/USD 支持**动画预览**；OBJ/GLB/3DS/C4D/DAE/STL 仅静态；查看器可调光照、背景/环境色、着色器、相机，可截图作快照 | **同类中最深**：MEF 工具对 .max/.mat（及 .3dm）索引全部外部依赖（贴图、XRef、代理、IES 等），支持批量重链/替换/复制/剥离路径 | 交互预览仅覆盖约 10 种主流格式；MEF 不覆盖 glTF/FBX/OBJ 的外贴图（未验证） |
| **PureRef** | **不支持任何 3D**（官方明确「不是当前计划的功能」） | — | — | — | 3D 美术用其放 2D 参考图；3D 本体在 DCC 中查看 |
| **Adobe Bridge** | CC Libraries 清单含 OBJ、GLB、DN、SBSAR；FBX/glTF/USD **无原生缩略图/预览/元数据**（UserVoice 长期请求） | 仅 OBJ 有缩略图（单用户报告，未验证） | 无 3D 查看器 | 不处理 | 3D 支持长期停滞 |
| **Windows 11 3D 查看器** | FBX, STL, OBJ, GLB, GLTF, PLY, 3MF；**2024-02 起 FBX 默认禁用**（CVE-2024-20677，CVSS 7.8，官方建议改用 GLB） | 资源管理器仅 **3MF** 原生缩略图；STL/OBJ/FBX 需第三方 Shell 扩展（如 Space Thumbnails：Filament+Assimp 渲染，>300 MB 或 >5 s 自动放弃） | 轨道旋转/平移/缩放（鼠标/触摸/笔）、测量、动画面板（播放/暂停/循环/逐帧/调速、骨骼与关键帧）、着色模式（平滑/线框/纹理）、**环境与光照（3 光源可调 + IBL/HDRI 环境 Studio/Forest/Sunset，9 个可保存主题）** | USDZ 内嵌；OBJ/FBX 外部贴图不处理 | 微软 2026 年弃用该应用（单一来源，未验证）；非 Win11 预装 |
| **macOS Quick Look / 预览** | **USDZ 为官方主推**（RealityKit/Storm 渲染器，完整 UsdPreviewSurface PBR）；预览 App 可开 OBJ/STL/PLY（社区共识，Apple 未直接确认）；FBX/DAE/3DS 需第三方扩展（Eyemesh 等） | 系统自动生成（USDZ 原生路径） | 旋转/缩放/AR 放置/接触阴影/动画；无无线框/网格/统计 | USDZ 为 ZIP 内嵌；OBJ+MTL 由 Model I/O 加载（具体行为未验证） | Quick Look 生成器有内存上限（iOS 约 100 MB，社区报告） |
| **Blender 资产浏览器**（参照系） | 仅 .blend；外部格式须先 Import 再标记资产 | 标记资产时自动生成预览图（Material Preview 模式 = 内置 studio HDRI + EEVEE） | 集成在 Blender 视口内 | .blend 可打包内嵌贴图 | 非 .blend 需第三方插件（如 Import Anything） |

### 2.2 关键观察

- **没有任何一款主流 DAM 在导入时全量渲染 3D 缩略图**。Eagle 用插件按需刷新、Connecter 用查看器截图或无头 Max、Windows 用第三方扩展；「首帧/当前帧截图 + 内置查看器」是通用模式。
- **贴图处理上行业普遍「不做」**：只渲染格式内嵌纹理（GLB 内嵌、FBX 内嵌）；OBJ+MTL 外部贴图被当作独立素材各自管理。唯一深入处理的是 Connecter MEF（且仅限 3ds Max/Rhino 工程文件）。→ Serpent 的链接/托管双模型 + 相对路径伴生贴图解析，将**超过大多数竞品**。
- **统计信息是 DAM 差异化价值**：Sketchfab Model Inspector（多边形数/贴图数/材质类型）是买家核对模型规格的标准工具；Connecter、Windows 3D Viewer 也有统计/测量。
- **格式共识**：必选 OBJ/FBX/glTF-GLB/STL；高频 DAE/PLY/3DS/USD/3MF/BLEND；CAD（STEP/IGES/IFC）只有 Pixcall/Connecter 覆盖，属加分项。
- **平台层不给力**：Windows/macOS 均无主流 3D 缩略图原生路径（仅 3MF/USDZ），第三方扩展是常态——这是 Serpent 的机会，也是成本。

来源：Eagle 官方帮助与插件页（tw.eagle.cool）、Eagle 博客《organize-3d-files》、Billfish 官方帮助/论坛、Pixcall 官方文档、Connecter 官方支持站与博客、PureRef 官网/论坛、Adobe CC Libraries 文档与 Bridge UserVoice、Microsoft 支持（CVE-2024-20677）、Wikipedia 3D Viewer、Apple USD/Quick Look 文档、Blender 手册。具体 URL 见文末来源索引。

---

## 3. 3D 视窗功能/交互规格

> 参照：Windows 3D Viewer、Quick Look、Sketchfab、model-viewer、three.js OrbitControls、Unity/Unreal 资源预览、Blender 资源浏览器、Adobe Dimension、Marmoset Viewer。

### 3.1 相机交互（消费者约定）

| 操作 | 鼠标 | 键盘 | 触控/触控板 |
|---|---|---|---|
| 旋转 | **左键拖拽**（所有参照一致） | 方向键 | 单指拖拽 |
| 缩放 | **滚轮**（以光标为中心） | Page Up/Down | 双指捏合 |
| 平移 | **右键拖拽**（或 Ctrl+左键；Win 3D Viewer 用 Shift+拖拽） | Shift+方向键 | 双指拖拽 |
| 重置视角 | **双击**（Sketchfab/Marmoset） | Z（Sketchfab） | 双击 |

要点：

- **左键=旋转、滚轮=缩放、右键=平移、双击=重置** 是 Sketchfab、model-viewer、OrbitControls、Marmoset Viewer 的事实标准；DAM 嵌入式预览应选这套消费者约定，**不用 DCC 的 Alt 组合键**（会与快捷键冲突，目标用户也不是 DCC 专家）。
- **打开时按包围盒自动取景**（model-viewer 默认 `camera-orbit` 半径 `auto`；OrbitControls `saveState/reset`）。
- **极角限制防翻顶** + FOV/距离约束（OrbitControls `minPolarAngle/maxPolarAngle`）。
- **阻尼（damping/inertia）是质量标志**（model-viewer 临界阻尼、OrbitControls `enableDamping`）。
- **触控板滚动=缩放**是 Windows/macOS 双平台可用的事实约定（触控板双指滚动产生 wheel 事件），天然覆盖。

### 3.2 视口显示

- **着色（shaded/PBR）是默认且唯一必须的显示模式**；线框切换是大部分查看器有的可选项（Sketchfab 数字键 5；Unity Wireframe）。
- 嵌入式查看器**不用网格地面**，用**接地柔和阴影**传达地面（model-viewer `shadow-intensity`/`shadow-softness`；网格属编辑器功能）。
- **背景与光照环境分离**（model-viewer 分离 `skybox-image` 与 `environment-image`）；背景色可配。
- **抗锯齿必须显式开启**：three.js `antialias` 默认 false（MSAA）；配 `setPixelRatio(min(dpr, 2))` 防 HiDPI 模糊。
- 阴影：柔和接地阴影即可，不做复杂阴影。

### 3.3 光照（IBL/HDRI）

- **IBL 是 PBR 预览的标准**，理由（多来源一致）：① 金属/光滑表面需要环境反射，方向光使材质「平淡无光」；② HDRI 每个像素都是光源（天空+地面+反弹光），方向光只有硬边阴影；③ HDR 存 >1.0 亮度，高光不钳死；④ 预过滤环境贴图（cubemap mipmap 对应粗糙度）实现能量守恒镜面响应；⑤ 固定中性环境使所有资产预览可对比——**DAM 的核心需求**。
- **工程先例**：Blender Material Preview 模式（驱动资源浏览器缩略图）就是默认套内置 studio HDRI（`Forest.exr`）+ EEVEE；model-viewer 无环境图时用内置中性环境且校准到接近 baseColor。**环境贴图 ≤1K（1024×512）足够**（model-viewer 内部钳制）。
- **色调映射**：`neutral`（Khronos PBR Neutral，model-viewer 4.0+ 默认）色彩最准；ACES 色偏（亮黄/青不可达）。DAM 预览默认 neutral。
- **曝光**：可调（model-viewer `exposure`）。AO：v1 用接地阴影即可，SSAO 属增强。

### 3.4 PBR 材质显示最低要求

- 行业标准通道集：**base color/albedo、normal、metallic/roughness**（metal-rough 工作流）或 specular/glossiness；另加 ambient occlusion、emissive、opacity、specular（Sketchfab Model Inspector 的完整清单；Unity Standard/glTF PBR）。
- **glTF metallic-roughness 是 Web 嵌入式查看器的事实标准**（Khronos 规范即基于 metal-rough）。
- 分级：v1 最低 **albedo + 光照响应正确**（金属/粗糙度数值参与着色）；normal map 显著提升观感；「逐通道切换查看」是 Sketchfab 键 2 式增强，不在 v1。

### 3.5 视口周边 UI

- 工具栏（可隐藏）：最小集 = **重置视角、HDRI/环境切换、统计开关、全屏**；有动画时加播放条（Sketchfab 底部栏模式）。
- **统计信息**（三角面/顶点/材质/贴图数/文件大小）是 DAM 选型核对价值（Sketchfab Model Inspector 为唯一完整实现者），可在视口角落或资产信息面板展示。
- 截图导出：主流查看器均无内置按钮；three.js canvas 天然可导出 PNG。v1 不做，增强期提供。
- 动画：**检测到动画 clip 才显示播放条**（Sketchfab 默认循环播放；model-viewer `autoplay`/`animation-name`/crossfade）。

### 3.6 性能边界（用于上限保护）

| 指标 | 参考值 | 来源依据 |
|---|---|---|
| 优化良好的电商模型 | 15k–40k 三角面 | Coohom |
| 移动/AR 上限 | <150k 面；~100k 顶点 | model-viewer 社区、uMake |
| Apple Quick Look 建议 | **<25 MB / <100k 顶点 / 2K 贴图** | WWDC23 |
| 贴图分辨率 | **2K 桌面端事实上限**（4K 单张 >60 MB VRAM） | Coohom、studyraid |
| 材质数 | <20（每材质一个 draw call） | studyraid |
| 缩略图生成超时 | **>300 MB 或 >5 s 放弃** | Space Thumbnails |
| LOD 参考 | LOD0≈35k / LOD1≈20k / LOD2≈8k | uMake |

v1 不做事中 LOD（DAM 内嵌预览体量可控），但**加载器必须设面数/贴图尺寸/文件大小上限与降级策略**。

### 3.7 v1 必备 vs 增强（优先级清单）

**v1 必备**：LMB 旋转（阻尼）+ 滚轮缩放（光标中心）+ RMB 平移；双击重置；打开自动取景；极角限制；触控/触控板（单指旋转、双指捏合/平移）；中性 IBL 环境（≤1K，与背景分离）+ 曝光 + neutral 色调映射；接地柔和阴影；PBR metal-rough（albedo/normal/metallic/roughness 参与，AO/emissive 有则用）；默认 shaded；背景可配；显式 MSAA + HiDPI；最小工具栏（重置/环境切换/统计/全屏）；统计信息（三角面/顶点/材质/贴图）；加载上限保护（>100k 面或 >2K 贴图提示或降级）。

**后续增强**：动画播放控制；材质逐通道检视/MatCap/UV checker；多 HDRI 切换 + 灯光旋转；截图导出 PNG；SSAO；资产级保存视点/缩略图角度；网格/正交视图；运行时 LOD/贴图流式；AR 预览。

---

## 4. 技术选型

> 版本基线（2026-08-05 实测 npm registry）：`three@0.185.1`（r185）、`electron@43.3.0`。

### 4.1 three.js Loader 现状（r185，全部 MIT）

| Loader | 大小 | 能力与局限 |
|---|---|---|
| **FBXLoader** | 111 KB | 二进制（≥6400）与 ASCII（≥7.0）FBX；几何容错尚可；**材质为旧式 Blinn-Phong 映射到 MeshStandardMaterial，现代 FBX 内嵌 PBR（metal-rough）支持有限**；贴图必须与 FBX 同目录且路径正确；动画/骨骼支持但 **r159 起存在 initialRotation 回归**（修好一种导出器 flavor 会破坏另一种）；官方明言 "FBX needs to die"，预期无实质改进 |
| **OBJLoader + MTLLoader** | 22.9 + 11.4 KB | MTL 解析到 **MeshPhongMaterial（非 PBR）**：`map_Kd`→map、`map_Ks`→specularMap、`bump/map_Bump`→bumpMap、`map_d`→alphaMap；**`map_Ka` 不解析**；`nor` 关键字不支持（issue #17414）；**单 mesh 多 usemtl 只应用最后一个材质**（issue #8203）；MTL 本身无 PBR 定义，PBR 化需自行后处理转 MeshStandardMaterial |
| **GLTFLoader** | 115 KB | **唯一原生 PBR 加载器**（metal-rough → MeshStandard/MeshPhysical）；扩展丰富：clearcoat/transmission/volume/ior/specular/anisotropy/iridescence/unlit/lights_punctual/texture_transform/quantization/instancing/webp/avif；Draco/KTX2/meshopt 需手动注册解码器 |
| **STLLoader** | 10.7 KB | 自动识别二进制/ASCII；**非索引三角形汤**（`computeVertexNormals` 需先 mergeVertices）；标准 STL 无材质/UV/颜色（仅非标准 Magics 颜色可读） |
| **HDRLoader** | 12 KB | **r180 起 RGBELoader 更名为 HDRLoader**（旧名只剩兼容 shim）；`.hdr` Radiance RGBE，默认 HalfFloat |

### 4.2 FBX 策略：直接加载 vs 转换管线（含 2026-08-05 补充调研）

用户追问后补充验证的三件事：

1. **FBX 内嵌贴图解压（`.fbm`）不需要 SDK**。`.fbm` 文件夹只是 DCC 工具（Maya/3ds Max/FBX SDK）导入时把 FBX 内嵌媒体解压到同名文件夹的行业约定（[Autodesk Maya 文档](https://download.autodesk.com/global/docs/maya2013/en_US/files/GUID-6B99E42D-1296-41DD-A103-899F858FBDF0.htm)、[StackOverflow: FbxImporter 自动生成 .fbm](https://stackoverflow.com/questions/56556347/how-can-i-load-embedded-textures-within-a-fbx-file-with-fbx-sdk)）；解压本质只是读取 FBX 内部的嵌入数据，**有多个无 SDK 的成熟实现**：ufbx 原生支持读取内嵌图像（Blender 新 ufbx 导入器 [PR #132406](https://projects.blender.org/blender/blender/pulls/132406) 将 "Embedded/packed images" 列为 ufbx 解析能力，2025-03 修复了内嵌贴图加载 bug）、assimp 亦有 `GetEmbeddedImage()`（[magnum-plugins PR #128](https://github.com/mosra/magnum-plugins/pull/128)）。
2. **FBX→glTF 转换可以保留贴图**。FBX2glTF 在 `--binary`（GLB）模式下**默认把所有贴图嵌入 GLB**（[Godot issue #72503](https://github.com/godotengine/godot/issues/72503) 佐证）；`--pbr-metallic-roughness` 默认选项从 FBX 提取 PBR 属性（[FBX2glTF 文档](https://github.com/ezhangle/FBX2glTF)）。注意 FBX 老式 Lambert/Phong 材质的部分属性（Ambient/Diffuse/Specular/Shininess）不自动转换到 glTF PBR，但 emissive、occlusion、normal map 转换良好（[Godot 文档](https://docs.godotengine.org/en/4.3/tutorials/assets_pipeline/importing_3d_scenes/available_formats.html)）。
3. **开源社区的答案正在收敛为 ufbx**。**Godot 4.3（2024-08）默认 FBX 导入器切换为 ufbx**，彻底移除 FBX2glTF 依赖，经数万 FBX 文件测试；PBR 材质/光照精度提升（在 FBX 格式限制内）、单位转换、几何 pivot、动画与骨骼 rest 大量改进（[Godot 官方博客](https://godotengine.org/article/introducing-the-improved-ufbx-importer-in-godot-4-3/)）；**Blender 正在开发 C++ ufbx 新导入器**（[PR #132406](https://projects.blender.org/blender/blender/pulls/132406)、[issue #132402](https://projects.blender.org/blender/blender/issues/132402)）替换自研 Python 解析器。ufbx = 单文件 C 库、MIT/Public Domain、无外部依赖（bqqbarbhg 维护，v0.18.x 活跃）。已知边界：极老 FBX（如 Milkshape 6000）可能失败（Godot issue #101649，Blender 同样读不了该文件）。

| 方案 | 评价（更新后） |
|---|---|
| **ufbx 解析 + 自组 FBX→GLB（推荐 v1 主路径）** | MIT、无 Autodesk SDK、原生提取内嵌贴图；**可编译 WASM**（官方文档化流程：CMake + Emscripten；单文件 C 库、零依赖；Babylon.js 论坛已有 WASM+WASI 虚拟文件系统桥的 FBX→GLB 草案：[draft-fbx-to-gltf-converter](https://forum.babylonjs.com/t/draft-fbx-to-gltf-converter/63083)）→ **WASM 平台无关，一个二进制全平台可用，可跑在沙箱 Worker 内**；无官方 npm 包，需自行 vendored 构建（[ufbx-doc 构建文档](https://github.com/oamaok/ufbx-doc)）。工程成本集中在「ufbx 场景 → glTF 导出」导出器编写（中等偏上） |
| three.js FBXLoader（兜底） | MIT、零外部二进制；PBR 有限、动画有 r159 回归、版本碎片化；**保留为转换失败/离线兜底** |
| FBX2glTF（facebookincubator / godotengine fork） | 质量好、CLI 成熟，但预编译二进制内嵌 Autodesk FBX SDK 2020 专有代码（MIT 分发红旗）；facebookincubator 版实质停更（维护分 0/10）、godotengine fork 因 Godot 改用 ufbx 而停更——**被开源社区淘汰的路线** |
| assimp CLI | BSD-3、活跃；glTF 2.0 **导出为 partial**（材质/动画不完整）；assimp2gltf 仓库已 404 |
| obj2gltf（CesiumGS） | Apache-2.0、Node CLI（OBJ→GLB 专用，支持 metal-rough 转换）；OBJ 转换可用 |
| Blender headless | 转换质量最好但 GPL-2 + 200 MB+ 二进制，不适合 MIT 应用捆绑 |

**结论（更新）**：FBX 主路径 = **Worker 内 ufbx（WASM）解析 FBX → 提取内嵌/外部贴图 → 导出 GLB 缓存**（首次打开或导入时生成，缓存失效策略沿用现有派生管线）；Renderer 统一 GLTFLoader 渲染（原生 PBR + HDRI IBL）。FBXLoader 仅兜底。OBJ/MTL 无需转换（MTL 映射到 Standard 材质即可），STL 直接渲染。

### 4.3 HDRI 环境光管线（three.js）

- 加载：`HDRLoader`（.hdr，默认 HalfFloat）/ `EXRLoader`（.exr）；`TextureLoader` 不加载 HDR。
- 预滤波：`pmremGenerator.fromEquirectangular(hdrTexture).texture` → `scene.environment`（MeshStandardMaterial 自动使用）；`scene.background` 可同源也可独立。用完 `texture.dispose()` + `pmremGenerator.dispose()`。
- 色调映射：`renderer.toneMapping`；ACES 实现中曝光在 tone map 前乘 `exposure / 0.6`；环境过曝发白先降 exposure。three.js r155+ 有 `NeutralToneMapping`（对应调研 §3.3 的 neutral）。
- 坑：half-float 上限 65504，高亮 + Bloom 可能 NaN 黑斑，需 clamp；"bad initial token" 多为文件损坏/路径错误。

### 4.4 Poly Haven HDRI（可捆绑分发的免费光源）

- **许可证：CC0（公有领域）**——商用、免署名、免注册；API `api.polyhaven.com`、直链 `dl.polyhaven.org`。
- 格式：等距圆柱投影（equirectangular），可选 HDR/EXR/tonemapped JPG。
- 实测体积（"Lakes" HDRI，2026-08 API）：

| 分辨率 | HDR (RGBE) | EXR |
|---|---|---|
| 1K (1024×512) | ~1.4 MB | ~1.2 MB |
| 2K (2048×1024) | ~5.6 MB | ~4.7 MB |
| 4K (4096×2048) | ~23.2 MB | ~18.6 MB |
| 8K | ~93.4 MB | ~73.4 MB |

→ **捆绑 1K 的 studio + 自然两套 ≈ 3 MB**，零合规负担。

### 4.5 缩略图方案（Electron）

| 方案 | 评价 |
|---|---|
| **① 懒生成 + 磁盘缓存（v1 推荐）** | 资产首次在查看器中打开时截图（正常可见窗口、无离屏魔法），PNG 缓存到库目录（`.serpent/` 衍生产物），之后卡片直接读缓存。零 GPU 边角问题；契合「用户只会打开感兴趣的几个模型」；与 Eagle「按需刷新缩略图」同模式 |
| **② 共享离屏窗口 + paint 事件（P2 批量）** | `webPreferences: { offscreen: true }` GPU 模式是官方支持路径；页面无变化时不产生帧，契合「渲染一帧→收图→销毁/复用」；**`capturePage` 截隐藏窗口不可靠**（Electron 12/13 BrowserView 回归、23 移除 incrementCaptureCount 后离屏返回 0×0、新版可能永不 settle——多 issue），不可作主路径；**WebGL 上下文上限 ~16 个**（Chromium 40939743），必须复用共享窗口 + 串行队列 + 超时；SwiftShader 自动回退已弃用，无 GPU 环境需显式 `--enable-unsafe-swiftshader` |
| ③ OffscreenCanvas + Worker | Chromium 支持 worker 内 WebGL，可 transfer ImageBitmap；**Electron 沙箱渲染器可用性未验证** |
| ④ 不推荐 | `headless-gl` 等原生 Node WebGL（ABI/平台负担大） |

### 4.6 性能/内存预算（数量级）

- 几何：非索引 100 万三角形 ≈ 3M 顶点 ≈ **108 MB**（pos+normal+uv）；索引化 + Draco 可降至 1/3–1/10；STL 永远非索引。
- 贴图：RGBA8 2K = 16 MB、4K = 64 MB/张；一张 4K baseColor + 4K normal + 4K ORM ≈ 190 MB VRAM。
- HDR：4K RGBE 文件 ~23 MB，解码 32 MB，上屏再 32 MB，PMREM mip 链另计；**运行时 PMREM 会抵消 EXR 压缩收益**。
- **桌面端预算：4K 环境（32 MB）+ 每模型 2K 贴图（~48 MB），单查看器 ~150 MB VRAM 可承受**。

### 4.7 Electron 已知坑（Windows/macOS）

- WebGL2 已是底线（r163 移除 WebGL1；r180 起 WebGPURenderer 入核心但自动回退 WebGL）；**继续用 WebGLRenderer，Electron 43 WebGPU 默认状态未核实**。
- Windows 默认 D3D11、macOS 默认 Metal（ANGLE）；第三方普遍实现 GPU 崩溃重试链。
- `disableHardwareAcceleration` 副作用随版本漂移（Electron 38 起透明窗口行为变化）。
- GPU 进程崩溃 → `webglcontextlost`，须监听重建。
- 离屏/隐藏窗口 DPI 与 `devicePixelRatio` 关系有已知混乱（经验性，需实测）；three.js 用 `setPixelRatio` 固定渲染比例。
- `backgroundThrottling: false` 只对可见窗口有效，**不要依赖它支撑隐藏窗口渲染**；缩略图渲染做成显式一帧 + 队列 + 超时。

### 4.8 明确的不确定项

1. ~~FBX2glTF archive 状态~~ → 已确认实质停更（facebookincubator OpenSSF 0/10；godotengine fork 因 Godot 改用 ufbx 停更），不再作为候选。
2. ~~ufbx 官方 FBX→glTF CLI~~ → 确认不存在；需自组导出器（WASM 桥接草案见 §4.2 Babylon.js 论坛）。
3. Electron 离屏窗口内 WebGL 的 rAF 是否受 Windows 隐藏窗口节流影响（无权威资料，平台实测）。
4. Electron 43 WebGPU 默认启用状态。
5. 离屏窗口 paint/capturePage 与 DPR 的像素关系（经验性，实施时实测）。
6. OffscreenCanvas + Worker 在 Electron 沙箱渲染器的可用性。
7. ufbx WASM 自建构建（Emscripten 版本/体积/与 Vite 集成）的具体数值——需在切片 B 用真实样本验证；ufbx 对极老 FBX（<7.0 / Milkshape 6000 一类）的失败率需样本矩阵实测（Godot issue #101649 先例）。
8. Windows 3D Viewer 弃用消息仅单一来源（百度百科），Wikipedia/Yahoo 记 2026-02 宣布弃用（不阻塞本任务）。

---

## 5. 来源索引（核心）

**竞品**：Eagle 帮助中心（tw.eagle.cool/support）、Eagle 3D 格式扩展插件页（community-tw.eagle.cool/index.php/plugin/89fb801f...）、Eagle 博客 organize-3d-files、Billfish 帮助（daoruyujiexiqubie / yunshangchuangeshi）与论坛、Pixcall 文档（docs.pixcall.com/docs/plugin/plugin-3d-viewer/）、Connecter 支持站（Default-Asset-Formats / Manage-External-Files / Generate-Custom-Preview）与博客、PureRef 官网、Adobe CC Libraries 格式文档 + Bridge UserVoice、Microsoft CVE-2024-20677 支持页、Wikipedia View 3D、Space Thumbnails (github.com/EYHN/space-thumbnails)、Apple USD/Quick Look 文档、Blender 手册（asset_browser）。

**视窗规格**：Sketchfab 博客（7 Essential Settings / Model Inspector / 5 Feature Easter Eggs / Viewer API）、modelviewer.dev（stagingandcameras / lightingandenv / DeepWiki）、three.js 文档（OrbitControls / WebGLRenderer / GridHelper）、Marmoset Viewer 支持页与 Toolbag 快捷键、Windows 11 3D Viewer 使用指南（Cursa）、Cesium 博客 IBL、Foundry Modo IBL 文档、PlayCanvas IBL 文档、Qt Quick 3D IBL 文档、Blender StackExchange（Material Preview studio HDRI）、Unity 文档（Muse Texture / MaterialValidator / StaticMeshEditor）、WWDC23 "Create 3D models for Quick Look"、Coohom 优化文章、uMake 优化指南、model-viewer GitHub #2716、studyraid model-viewer 性能。

**技术**：three.js r185 源码（examples/jsm/loaders/）、three.js forum（FBXLoader animation issue #85789 / can't load #68027 / RGBELoader 讨论 / 环境发白 #42572）、three.js GitHub（MTLLoader #8203 / #17414）、r180 release notes、FBX2glTF（facebookincubator / godotengine）、ufbx、assimp、obj2gltf（CesiumGS）、Blender、Electron offscreen rendering 文档、Electron issues（#30666 / #37611 / #36376 / #31016 / #48064）、Chromium issue 40939743、Poly Haven（polyhaven.com / dev.polyhaven.com）。
