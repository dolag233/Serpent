# 0030 切片规格：3D 模型支持（常见格式 + 3D 预览 + HDRI/PBR）

> 状态：**正式规格（2026-08-05 产品负责人确认全部决策，工单已开）**
> 日期：2026-08-05
> 调研依据：`docs/research/2026-08-05-3d-model-preview-research.md`
> 决策记录见 §8；工单见 §7 映射表（epic：Serpent-n4ua）。

## 1. 背景与目标

用户需求（原话提炼）：**支持 FBX、OBJ 等常见 3D 格式，需要支持正常 3D 预览**；带贴图的模型支持**最简单 PBR 实时渲染**，光源直接来自 **HDRI 环境贴图**，且**可以选择 HDR 贴图**（至少包含 studio、自然两套预设）。

目标画像：游戏美术 / 影视后期 / 设计师用 Serpent 管理模型资产（FBX 工程、OBJ 素材、GLB 成品、STL 打印件），要求：浏览态有缩略图、打开后有可交互的 3D 视窗、材质在 HDRI 光下看起来「正常」（金属反光、粗糙度响应、法线细节）。

## 2. 范围

### 包含（v1）

- 4 类格式端到端支持：**FBX、OBJ/MTL、glTF/GLB、STL**（注册、入库、卡片、查看器、贴图渲染）。
- **FBX 转换管线（v1 主路径，用户确认方向）**：Worker 内 ufbx（WASM，MIT）解析 FBX → 提取内嵌贴图（`.fbm` 约定）与外部贴图 → 导出 **GLB 缓存**（贴图嵌入 GLB）→ Renderer 统一 GLTFLoader 原生 PBR 渲染。**不需要 Autodesk SDK**（Godot 4.3 / Blender 迁移实践验证）。three.js FBXLoader 仅作转换失败兜底。
- 3D 查看器：轨道相机（消费者约定）、自动取景、重置、PBR 渲染、HDRI 环境光（studio + 自然预设可切换）、曝光、主题背景、接地阴影、统计信息、加载上限保护、错误态。
- 伴生贴图解析：OBJ+MTL 与 FBX 外部贴图按相对路径解析并渲染（超过 Eagle/Billfish 的「只渲染内嵌纹理」）。
- **缩略图：导入后离屏批量渲染（用户拍板）**——共享离屏 BrowserWindow（WebGL + `paint` 事件）串行渲染入库；失败兜底通用 3D 图标，首次打开查看器截图作补充回填。

### 不包含（v1）

- 3ds Max / Maya / .blend 等 DCC 工程文件（Eagle 也明确不支持；最多后续做「可入库、通用图标」）。
- 材质逐通道检视、SSAO、网格地面、正交视图（增强项）。
- 云端/跨设备相关（不适用，Serpent 本地库）。

## 3. 格式分级

| 级别 | 格式 | 理由 |
|---|---|---|
| **T1（v1 必做）** | FBX、OBJ/MTL、glTF/GLB、STL | 用户点名（FBX/OBJ）+ 行业共识核心集（§2.1 矩阵）；glTF 是 PBR 事实标准、渲染效果最好；STL 解析最简单、3D 打印常见 |
| T2（P1 顺延） | PLY、DAE、3DS | three.js 均有 loader，工作量小；Eagle/Pixcall 均支持 |
| T3（P2 起） | USD/USDZ、3MF、BLEND、CAD（STEP/IGES/IFC） | USDZ 是 Apple 生态主推但 loader 复杂；CAD 只有 Pixcall/Connecter 覆盖，非共识项 |

## 4. 视窗功能规格（v1）

| # | 功能 | 规格 | 验收要点 |
|---|---|---|---|
| 3D-01 | 轨道相机 | 左键拖拽=旋转（带阻尼）、滚轮=缩放（以光标为中心）、右键拖拽=平移、双击=重置视角 | 全部鼠标操作在真实应用可用；旋转不平滑视为缺陷 |
| 3D-02 | 自动取景 | 打开时按包围盒计算相机位置/距离，模型完整可见 | 不同尺寸模型打开后均在视口内 |
| 3D-03 | 相机约束 | 极角限制防翻顶；FOV/缩放距离上下限 | 拖拽不会导致模型「翻过头顶」丢失 |
| 3D-04 | 触控/触控板 | 单指旋转、双指捏合缩放、双指平移；触控板滚动=缩放 | macOS 触控板 + Windows 精密触控板 |
| 3D-05 | 显示模式 | 默认着色（PBR）；线框切换为 P1 增强项 | 着色模式为默认与唯一必须 |
| 3D-06 | 背景 | 背景跟随应用主题（亮/暗），与光照环境分离 | 与 app 主题面板一致，不引入突兀第三色 |
| 3D-07 | 接地阴影 | 柔和接地接触阴影传达地面，不画网格 | 模型下方有柔和阴影 |
| 3D-08 | 抗锯齿/DPI | 显式 `antialias` + `setPixelRatio(min(dpr,2))` | 高 DPI 屏不模糊 |
| 3D-09 | HDRI 环境 | studio + 自然两套 1K CC0 预设；工具栏可切换 | 切换后材质观感明显变化且无报错 |
| 3D-10 | 曝光 | 曝光可调（1.0 默认）；neutral 色调映射 | 过曝/欠曝可救回 |
| 3D-11 | PBR 材质 | metal-rough：albedo/normal/metallic/roughness 参与着色；AO/emissive 有则用；glTF 原生，OBJ-MTL/FBX 映射到 Standard 材质 | 带贴图模型有正确光照响应；无贴图模型有默认材质不黑不白 |
| 3D-12 | 贴图解析 | OBJ+MTL 与 FBX 外部贴图按相对路径解析（含子目录）；解析不到时材质降级并提示 | 模型同目录贴图正常显示；贴图缺失不崩溃 |
| 3D-13 | 统计 | 三角面/顶点/材质数/贴图数/文件大小，工具栏开关 | 与模型实际情况一致（以加载结果为真源） |
| 3D-14 | 上限保护 | 文件大小（如 >300 MB）、面数（如 >100 万）、贴图尺寸（>2K 降级）提示或拒绝 | 超大模型打开不冻结 UI；有明确错误态 |
| 3D-15 | 错误态 | 解析失败/文件损坏/贴图缺失分别给出可操作的提示；渲染失败有重试 | 不白屏、不无限 loading |
| 3D-16 | 缩略图 | 卡片先用通用 3D 图标；首次打开查看器成功渲染后自动截图缓存为缩略图 | 打开过的模型卡片出现真实缩略图；未打开过的是图标 |
| 3D-17 | 动画（P1） | 检测到 AnimationClip 才显示播放条（播放/暂停/循环） | 带动画 FBX/GLB 可播放；静态模型无动画 UI |
| 3D-18 | 自定义 HDR（撤回） | 当前范围不提供本地 `.hdr` 自定义环境入口 | 选择器不显示“自定义”；仅保留随应用提供的 HDRI 预设 |
| 3D-19 | 截图导出（P1） | 导出当前帧 PNG | 导出文件可打开 |

## 5. HDRI/PBR 规格

- **预设**：Poly Haven（CC0）1K 等距圆柱投影 .hdr 两套——「studio」（室内柔光棚拍棚）与「natural/户外自然光」。随应用打包（≈3 MB）。
- **渲染管线**：`HDRLoader` 加载 → `PMREMGenerator.fromEquirectangular` → `scene.environment`；`scene.background` 独立（跟随应用主题）。`renderer.toneMapping = NeutralToneMapping`（three.js r155+），`exposure` 默认 1.0 可调。
- **材质映射**：
  - glTF/GLB：GLTFLoader 原生 PBR（含扩展材质按支持能力渲染）——**FBX 转换产物也走此路径**（ufbx→GLB 保留 PBR 材质：emissive、occlusion、normal map 转换良好；老式 Lambert/Phong 部分属性按 glTF 转换限制处理）。
  - OBJ/MTL：MTLLoader 输出 Phong 后统一转 `MeshStandardMaterial`（map_Kd→albedo、map_Ks→specular 近似、bump/map_Bump→normal、map_d→alpha）；MTL 无 metal-rough 信息时给中性默认值（metalness≈0.0、roughness≈0.8，保证 IBL 下观感正常）。
  - FBX：主路径 ufbx→GLB（上述 glTF 路径）；**转换失败兜底** FBXLoader（Blinn-Phong→Standard 映射），贴图路径经伴生解析重写为 serpent:// URL。
  - STL：默认中性 PBR 材质（与主题区分度良好的灰/蓝灰）。
- **已知局限（如实告知用户）**：FBX 老式 Lambert/Phong 材质的部分属性（Ambient/Diffuse/Specular/Shininess）不会自动进入 glTF PBR（格式本身限制）；OBJ MTL 无 PBR 定义是格式本身限制。

## 6. 架构对接点（现状 → 改动）

| 现状 | 改动 |
|---|---|
| `src/shared/media-formats.ts` 只有 image/video 注册表 | 新增 `MODEL_EXTENSIONS`（fbx/obj/gltf/glb/stl）+ 类型守卫与 MIME 映射 |
| `asset.mediaType` 枚举 `image/video/audio/text/other`（`src/shared/asset-types.ts`） | 新增 `'model'`（Zod schema、Worker `detectMediaType`、Renderer 消费方） |
| `thumbnail-support.ts`：`other` 无缩略图 | `'model'` 进入缩略图体系（capture 产物存为新 artifact kind，如 `model_thumbnail`）；未捕获时显示 3D 图标 |
| 查看器 `ViewerPrimarySurface`（`viewer-preview-policy.ts`）：`other` → unsupported | `'model'` → 新 surface（3D 视窗挂载点）；resolution 返回 `serpent://source/<libraryId>/<assetId>` URL |
| `serpent://source` 按 assetId 寻址（`src/main/index.ts` 协议注册） | 模型打开需「伴生贴图映射」：Worker 返回模型所在目录的相对路径 → assetId/URL 映射，Renderer loader 用它重写贴图请求；只读查询、无任意路径能力 |
| Worker 缩略图队列（sharp/OIIO/FFmpeg 派生） | 3D 缩略图不在此队列（GPU 渲染在 Renderer/离屏窗口）；capture 经 IPC 存 artifact |
| 格式过滤/搜索（filter field `format`） | 模型扩展名进入格式过滤取值集合；搜索不变 |
| 卡片徽标/角标（`asset-card-badges.ts`）、i18n | 新增 3D 徽标与文案（中/英） |
| 依赖：无 WebGL/3D 库 | 新增 `three`（r185，MIT）；打包资源新增 2 个 .hdr |
| App.tsx 巨型文件纪律（纪律 #8） | 3D 视窗抽独立模块目录 `src/renderer/3d-viewer/`（组件、loader 注册表、HDRI 预设、统计、相机策略、URL 重映射） |

## 7. 分片计划

> 每片交付：代码 + 测试 + 开发日志；状态流转按 `docs/development-process.md`。切片完成需规格条目四列齐（需求 | 实现 file:line | 测试 test:line | 人工/平台证据）。

| 切片 | 工单 | 优先级 | 依赖 |
|---|---|---|---|
| A 格式注册与资产管线 | `Serpent-fu2i` | P1 | — |
| B FBX 转换管线 | `Serpent-5ygi` | P1 | ← A |
| C 3D 查看器核心 | `Serpent-qvc6` | P1 | ← A、B |
| D HDRI 环境光与 PBR | `Serpent-v363` | P1 | —（建议紧跟 A） |
| E 缩略图离屏批量 | `Serpent-hnmg` | P1 | ← C |
| F 动画与增强 | `Serpent-hy3a` | P2 | ← C、B |
| G 扩展格式与质量 | `Serpent-1bdg` | P3 | ← A |
| （总 epic） | `Serpent-n4ua` | P1 | — |

### 切片 A — 格式注册与资产管线打通（P0，前置）

- `media-formats.ts` 新增 MODEL_EXTENSIONS；Worker `detectMediaType` 支持 `'model'`；`asset-types.ts` 枚举扩展；卡片 3D 徽标；格式过滤取值；i18n。
- 查看器 resolution：`'model'` 资产返回渲染 URL（FBX 为转换产物 URL，其余为 `serpent://source`）+ 伴生贴图映射 payload（Worker 目录查询）。
- 测试：unit（注册表/类型判定/映射 payload）、worker（目录内伴生资产解析、越界拒绝）、E2E（导入四类格式 → 卡片出现 → 打开进入 3D surface 不报错）。

### 切片 B — FBX 转换管线（P0）

- ufbx WASM vendored 构建（Emscripten，平台无关单二进制，随 resources 分发，同 FFmpeg 路径）；Worker 转换任务：FBX 解析 → 内嵌贴图提取（`.fbm` 约定）→ 外部贴图解析 → GLB 导出（贴图嵌入）→ 缓存到 `.serpent/`（版本化缓存键，失效策略沿用现有派生管线）；转换失败 → 记录错误，Renderer 走 FBXLoader 兜底。
- 测试：真实 FBX 样本矩阵（Blender/Max/Maya 导出、内嵌 vs 外部贴图、ASCII vs 二进制、>7.0 与极老版本）转换 → GLB 可被 GLTFLoader 加载；worker 集成测试；失败路径。

### 切片 C — 3D 查看器核心（P0）

- `src/renderer/3d-viewer/`：ViewerSurface 组件、OrbitControls 策略（LMB/滚轮/RMB/双击/阻尼/极角/自动取景）、loader 注册（GLTF 主路径 + OBJ+MTL/STL/FBX 兜底）、贴图 URL 重映射、主题背景、接地阴影、MSAA+DPR、统计（3D-13）、上限保护与错误态（3D-14/15）。
- **渲染核心抽共享模块**（查看器与切片 E 离屏缩略图共用）：场景装配/环境/相机/截图函数独立成纯模块。
- 测试：unit（相机策略纯函数、统计计算、URL 重映射、上限判定）、E2E（打开各格式 → canvas 挂载、无错误日志；WebGL 像素断言不可靠，真实渲染以 Computer Use 截图验收）。

### 切片 D — HDRI 环境光与 PBR（P0）

- HDRLoader + PMREM 管线；studio/自然两套 1K CC0 捆绑；工具栏 HDRI 切换 + 曝光；NeutralToneMapping；OBJ-MTL→Standard 转换映射；STL 默认材质。
- 测试：unit（管线装配、预设清单、曝光/映射纯函数）、E2E（切换环境不报错）；视觉效果 Computer Use 截图。

### 切片 E — 缩略图批量（P0，用户拍板导入后批量渲染）

- 共享离屏 BrowserWindow（`offscreen: true` + WebGL + `paint` 事件，复用切片 C 渲染核心）+ 串行队列 + 超时 + 失败兜底（通用 3D 图标）；导入后入队批量生成；与现有缩略图队列协调（不重复生成、并发限制、优先级）；首次打开查看器截图作补充回填与「刷新缩略图」入口。
- 测试：离屏渲染 smoke（真实窗口验证 paint 帧非空——平台实测项，见调研 §4.8-3/5）；DPI/分辨率断言；队列取消/失败恢复。

### 切片 F — 动画与增强（P1）

- AnimationClip 检测 + 播放条（播放/暂停/循环）；截图导出 PNG；右键「刷新缩略图」。自定义 `.hdr` 导入已撤回，不进入当前实现。

### 切片 G — 质量与扩展（P2，另行立项）

- T2 格式（PLY/DAE/3DS）；模型统计持久化到 extracted_metadata；动画缩略图取任意帧；转换管线质量矩阵扩展（骨骼/动画→GLB 动画保留验证）。

## 8. 决策记录

| # | 决策 | 结论 | 拍板 |
|---|---|---|---|
| 1 | **FBX 渲染路径** | **ufbx（WASM）转换管线为 v1 主路径**（MIT、无 Autodesk SDK、保留贴图、社区共识：Godot 4.3 默认 ufbx / Blender 迁移中）；FBXLoader 仅兜底。用户追问确认：内嵌贴图解压不需要 SDK（ufbx/assimp 均有实现）、FBX→GLB 可嵌入保留贴图 | 已拍板（2026-08-05） |
| 2 | 缩略图策略 | **导入后离屏批量渲染**（共享离屏窗口 + paint 事件 + 串行队列），失败兜底图标 + 首次打开截图补充 | 已拍板（2026-08-05） |
| 3 | v1 格式集 | T1 四类：FBX、OBJ/MTL、glTF/GLB、STL（PLY/DAE/3DS 留 P2） | 已拍板（2026-08-05） |
| 4 | 动画播放 | 不进 v1，P1 做（AnimationMixer + 检测到 clip 才显示播放条） | 已拍板（2026-08-05） |
| 5 | 自定义 HDR | 不提供本地 `.hdr` 自定义环境；选择器仅保留内置 HDRI 预设 | 已拍板（2026-08-06） |

## 9. 风险与对策

| 风险 | 等级 | 对策 |
|---|---|---|
| ufbx WASM 构建与 glTF 导出器工程成本 | 高 | 这是切片 B 的核心工程量（vendored Emscripten 构建 + ufbx 场景 → GLB 导出）；先做最小可用导出器（几何 + 材质 + 贴图 + 坐标轴），动画/骨骼留 P1 验证；Babylon.js 论坛 WASM+WASI 桥接草案作参考 |
| ufbx 对部分 FBX 解析失败（极老版本等，Godot #101649 先例） | 高 | 转换失败不阻塞入库：错误记录 + Renderer 走 FBXLoader 兜底渲染；真实样本矩阵回归（Blender/Max/Maya 导出、内嵌 vs 外部贴图、ASCII vs 二进制） |
| FBX 转换产物缓存一致性（外部贴图变化/文件更新） | 中 | 缓存键含源内容指纹 + 转换器版本；外部变化刷新 revision 时失效重转（沿用现有派生管线语义） |
| FBX 解析攻击面（CVE-2024-20677 先例） | 中 | ufbx WASM 跑在沙箱 Worker；文件大小上限 + 转换超时；不引入原生 Autodesk SDK |
| 伴生贴图解析跨进程复杂度 | 中 | 只读、相对路径白名单解析；解析失败材质降级而非报错；Worker payload 单测覆盖 |
| 大模型内存/GPU | 中 | 面数/贴图/文件上限（§4 3D-14）；`webglcontextlost` 监听重建 |
| 离屏缩略图平台差异（DPR/paint/节流、16 上下文上限） | 高（已拍板承担） | 共享单窗口串行队列（不每资产开窗口）；显式单帧渲染 + 超时，不依赖持续 rAF；paint 帧为空/超时 → 兜底图标；切片 E 先做真实平台 smoke（调研 §4.8-3/5）再铺量 |
| HDRI 合规 | 低 | Poly Haven CC0 1K，保留来源记录 |
| Renderer 包体增大 | 低 | three 按需 import（jsm 树摇）；~几百 KB 可接受 |

## 10. 参考

- 调研全文：`docs/research/2026-08-05-3d-model-preview-research.md`
- 现有媒体管线：`docs/research/media-preview-stack.md`
- 查看器切片：`docs/implementation/0022-image-sequences-and-viewer-transforms.md`
