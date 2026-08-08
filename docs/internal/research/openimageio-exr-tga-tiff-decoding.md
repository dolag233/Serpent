# OpenImageIO vs sharp：EXR/TGA/TIFF 解码技术调研

> 调研日期：2026-07-13
> 范围：Node 24、Electron 43、utilityProcess、macOS arm64 + Windows x64。
> 来源约束：仅引用 sharp/libvips、OpenImageIO、OpenEXR、OpenColorIO 官方文档、源码仓库与 npm 注册表。

## 结论

**EXR 和 TGA 必须走 OpenImageIO（OIIO）的 `oiiotool` CLI 子进程路径，不能依赖 sharp。** TIFF 简单用例可以用 sharp，但高位深、多页、浮点 TIFF 同样应走 OIIO。

1. **sharp 覆盖 PNG/JPEG/GIF/普通 TIFF 缩略图与元信息**：预编译包直接支持，npm 即用。[sharp 预编译格式](https://sharp.pixelplumbing.com/install/#prebuilt-binaries)
2. **OIIO `oiiotool` CLI 覆盖 EXR/TGA/复杂 TIFF**：子进程从 utility worker 调用，`shell: false`，参数用数组。
3. **不引入 node-oiio native addon**：将全部像素强制转为 UINT8，丢失 EXR 浮点 HDR 数据；系统预装 OIIO 且未维护。[node-oiio-2020](https://www.npmjs.com/package/node-oiio-2020?activeTab=readme)
4. **OCIO 色彩管理内置于 oiiotool**：OCIO 2.2+ 支持 `ocio://default` 内置 config，无需捆绑外部 LUT。[OCIO 2.2 release](https://opencolorio.readthedocs.io/en/v2.4.2/releases/ocio_2_2.html)
5. **随应用分发版本锁定的 oiiotool 静态二进制**：置于 `extraResources`，CI 记录 SHA-256。

核心取舍：**维持 CLI 进程边界，不对 C++ 库做 Node native binding**。进程崩溃不拖垮 worker，恶意文件不触及 Node.js 堆，升级只需替换二进制。

## sharp 的 EXR/TGA/TIFF 现状

sharp 预编译包（v0.34.x）支持的格式：[sharp install 文档](https://sharp.pixelplumbing.com/install/)

| 格式 | 输入 | 输出 |
|------|:----:|:----:|
| JPEG, PNG, WebP, AVIF, **TIFF**, GIF | 是 | 是 |
| SVG | 是 | 否（栅格化） |
| **EXR, TGA** | **否** | **否** |

libvips 上游支持 OpenEXR 和 TGA，但 sharp 预编译 vendor tarball 未启用。通过 `SHARP_FORCE_GLOBAL_LIBVIPS` 可用自行编译的 libvips，但代价是放弃跨平台预编译便利性、手动维护编译链，以及 libvips 的 LGPL-2.1-or-later 合规负担。[libvips 官方](https://github.com/libvips/libvips)

## OpenImageIO 的能力与许可证

### 格式覆盖（与 Serpent MVP 相关的格式）

[OIIO README](https://raw.githubusercontent.com/AcademySoftwareFoundation/OpenImageIO/main/README.rst)

| 格式 | MVP 需要 | 说明 |
|------|:---:|------|
| OpenEXR (.exr) | 是 | scene-linear HDR、multipart、任意通道 |
| TIFF (.tif) | 是 | sharp 也可处理普通 TIFF |
| Targa (.tga) | 是 | sharp 不支持 |
| JPEG, PNG, GIF | 是 | sharp 也可，OIIO 作为后备诊断 |
| PSD, DPX, JPEG XL, RAW 等 | 否 | 未来可扩展 |

### 许可证：MIT 兼容

| 组件 | 许可证 | SPDX |
|------|--------|------|
| OpenImageIO (当前 99.75%) | Apache-2.0 | `Apache-2.0` |
| OpenImageIO (遗留 <2%) | BSD-3-Clause | `BSD-3-Clause` |
| OpenEXR | BSD-3-Clause | `BSD-3-Clause` |
| OpenColorIO | BSD-3-Clause | `BSD-3-Clause` |

[OIIO THIRD-PARTY.md](https://raw.githubusercontent.com/AcademySoftwareFoundation/OpenImageIO/v2.5.8.0/THIRD-PARTY.md)、[OpenEXR 许可证](https://openexr.com/en/rb-3.1/license.html)、[OCIO 许可证](https://opencolorio.readthedocs.io/en/v2.4.0/guides/contributing/contributing.html#copyright-notices)

Apache-2.0 + BSD-3-Clause 均与 MIT 兼容，分发只需保留 notice。对比 libvips 的 LGPL-2.1-or-later，OIIO 的许可证更简单直接。

### 版本活跃度

ASWF 托管，按月发布。截至 2026-07，最新 v3.1.11.0（2026-03-01），LTS v3.0.16.0。Homebrew 提供 macOS arm64 预编译 bottles，Python wheels 发布到 PyPI。无反模式的风险。[OIIO Releases](https://github.com/AcademySoftwareFoundation/OpenImageIO/releases)

## node-oiio native addon 不适合

npm 上的 `node-oiio` 和 `node-oiio-2020`（v1.5.0，最后更新 2020）明确声明：

> No attempts are made to retain all data for floating point image formats. Everything is assumed to fit into UINT8 per channel per pixel.

这对 EXR 是致命的——EXR 价值在于 scene-linear float HDR，压为 UINT8 即丢弃全部动态范围。此外：需系统预装 `libOpenImageIO`、无 OCIO 集成、无预编译二进制（纯 node-gyp）、不适配 Node 24 N-API。**不可用。**

## 推荐 API 模式：oiiotool 子进程

### 架构

```
utilityProcess: media-worker (Node.js)
  ├─ sharp（同进程）
  └─ spawn oiiotool（短命子进程，每任务）
```

### 核心封装

```typescript
import { execFile } from 'node:child_process';

const OIIOTOOL = path.join(process.resourcesPath, 'bin', 'oiiotool');

function execOiiotool(args: string[], timeoutMs = 30_000): Promise<{
  exitCode: number; stdout: string; stderr: string; signal: string | null;
}> {
  return new Promise((resolve) => {
    const child = execFile(OIIOTOOL, args, {
      timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024,
      shell: false, windowsHide: true,
    }, (err, stdout, stderr) => {
      resolve({ exitCode: err?.code ?? -1, stdout, stderr, signal: err?.signal ?? null });
    });
  });
}
```

关键约束：参数用字符串数组 `shell: false`；wall-clock 超时 + kill(SIGTERM/SIGKILL)；`maxBuffer` 限制；先写临时文件再原子改名。

### EXR 解码与 OCIO 显示变换

```typescript
async function decodeExrPreview(
  inputPath: string, outputPath: string, maxSize = 512,
  colorConfig?: string, inputCS = 'scene_linear', exposureEV = 0,
) {
  const args: string[] = [];
  if (colorConfig) args.push('--colorconfig', colorConfig);
  args.push('--iscolorspace', inputCS);
  if (exposureEV !== 0) args.push('--mulc', String(Math.pow(2, exposureEV)));
  args.push('--ociodisplay', 'sRGB', 'ACES 1.0 - SDR Video');
  args.push('--resize', `0x${maxSize}`, '-i', inputPath, '-o', outputPath);
  return execOiiotool(args, 30_000);
}
```

曝光补偿在 display transform 前以 `2^EV` 作用于线性域，不在 8-bit sRGB 后再调。

### TGA 解码（display-referred，无需 OCIO）

```typescript
async function decodeTgaPreview(inputPath: string, outputPath: string, maxSize = 512) {
  return execOiiotool(['-i', inputPath, '--resize', `0x${maxSize}`, '-o', outputPath], 15_000);
}
```

### 元信息探测

```typescript
async function probeImage(inputPath: string) {
  const { stdout } = await execOiiotool(['-v', '-i', inputPath], 10_000);
  return parseIinfoOutput(stdout); // 宽高、通道数、位深、色彩空间、数据窗口
}
```

枚举可用色彩空间：`oiiotool --colorconfig <path> --colorconfiginfo` 输出可解析列表。

## OCIO 内置 config

OCIO 2.2+ 支持 URI 内置 config，无需捆绑 .ocio 或 LUT 文件。[OCIO 2.2 release notes](https://opencolorio.readthedocs.io/en/v2.4.2/releases/ocio_2_2.html)

| 环境变量 | 效果 |
|----------|------|
| `OCIO=ocio://default` | 默认内置 CG config |
| `OCIO=ocio://cg-config-v4.0.0_aces-v2.0_ocio-v2.5` | 指定版本（需 OCIO 2.5+） |

内置 CG config 提供：`ACEScg`、`ACES2065-1`、`scene_linear`（默认假定的输入空间）、sRGB 显示与 `ACES 1.0 - SDR Video` 视图。

Serpent 默认使用 `OCIO=ocio://cg-config-v4.0.0_aces-v2.0_ocio-v2.5` 环境变量；用户可在资源库设置中指定自定义 config 文件覆盖。色彩空间无法确定时假设 `scene_linear` 并在 UI 中显式展示这一假设，允许覆盖。

## 跨平台构建与分发

推荐全静态链接（`-DBUILD_SHARED_LIBS=0 -DLINKSTATIC=1`），避免运行时查找动态库。

### macOS arm64

```bash
brew install cmake boost imath openexr libtiff opencolorio libjpeg-turbo zlib fmt
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release \
  -DUSE_PYTHON=0 -DUSE_QT=0 -DBUILD_SHARED_LIBS=0 -DLINKSTATIC=1 -DOIIO_BUILD_TOOLS=ON
cmake --build build -j $(sysctl -n hw.ncpu) && cmake --install build --prefix ./dist
```

产物 `./dist/bin/oiiotool`，用 `otool -L` 验证无外部 dylib 依赖。

### Windows x64

方案一：vcpkg — `vcpkg install openimageio[tools,opencolorio]:x64-windows-static`（端口 v2.3.10.1，够用但有已知 Boost 链接问题 [issue #39533](https://github.com/microsoft/vcpkg/issues/39533)）。

方案二：CMake 自动拉取依赖：

```powershell
cmake -S . -B build -G "Visual Studio 17 2022" -DCMAKE_BUILD_TYPE=Release ^
  -DOpenImageIO_BUILD_MISSING_DEPS=all -DUSE_PYTHON=0 -DUSE_QT=0 ^
  -DBUILD_SHARED_LIBS=0 -DLINKSTATIC=1 -DOIIO_BUILD_TOOLS=ON
cmake --build build --config Release && cmake --install build --config Release --prefix ./dist
```

[OIIO INSTALL.md](https://raw.githubusercontent.com/AcademySoftwareFoundation/OpenImageIO/main/INSTALL.md)

### Electron 打包

- `oiiotool` 放 `extraResources/bin/`，不在 ASAR。[Electron ASAR 限制](https://www.electronjs.org/docs/latest/tutorial/asar-archives)
- 运行时：`path.join(process.resourcesPath, 'bin', 'oiiotool')`。
- macOS 纳入 codesign/notarization。
- macOS utilityProcess 可能需 `allowLoadingUnsignedLibraries: true`。[utilityProcess API](https://www.electronjs.org/docs/latest/api/utility-process)

### CI 验证

记录 SHA-256 和 `--version`；EXR/TGA/TIFF 样本 smoke test（读、缩放、OCIO 变换、输出）；验证超时/取消传播和 OCIO 内置 config 可用；生成 SBOM。

## 与 sharp 的分工

| 任务 | 工具 | 原因 |
|------|------|------|
| PNG/JPEG 缩略图 | sharp | 快、预编译、npm 即用 |
| GIF 缩略图/元信息 | sharp | 同上 |
| 普通 TIFF 缩略图 | sharp | 优先快路径 |
| TIFF 高位深/多页/浮点 | oiiotool | sharp 可能丢精度 |
| EXR + OCIO 显示变换 | oiiotool | 唯一可靠路径 |
| TGA 缩略图 | oiiotool | sharp 不支持 |
| 图片元信息探测 | iinfo / oiiotool -v | 统一入口 |

## 参考来源

- [sharp 安装与预编译格式](https://sharp.pixelplumbing.com/install/)
- [libvips 官方仓库](https://github.com/libvips/libvips)
- [OpenImageIO README](https://raw.githubusercontent.com/AcademySoftwareFoundation/OpenImageIO/main/README.rst)
- [OpenImageIO INSTALL.md](https://raw.githubusercontent.com/AcademySoftwareFoundation/OpenImageIO/main/INSTALL.md)
- [OpenImageIO Releases](https://github.com/AcademySoftwareFoundation/OpenImageIO/releases)
- [OpenImageIO THIRD-PARTY.md](https://raw.githubusercontent.com/AcademySoftwareFoundation/OpenImageIO/v2.5.8.0/THIRD-PARTY.md)
- [OpenEXR 许可证](https://openexr.com/en/rb-3.1/license.html)
- [OCIO 许可证](https://opencolorio.readthedocs.io/en/v2.4.0/guides/contributing/contributing.html#copyright-notices)
- [OCIO 2.2 内置 config](https://opencolorio.readthedocs.io/en/v2.4.2/releases/ocio_2_2.html)
- [OCIO CG Config](https://opencolorio.readthedocs.io/en/stable/configurations/aces_cg.html)
- [node-oiio-2020 (UINT8 限制)](https://www.npmjs.com/package/node-oiio-2020?activeTab=readme)
- [oiiotool 文档](https://openimageio.readthedocs.io/en/v3.1.13.0/oiiotool.html)
- [Electron utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process)
- [Electron ASAR](https://www.electronjs.org/docs/latest/tutorial/asar-archives)
- [vcpkg openimageio port](https://vcpkg.link/ports/openimageio)
- [vcpkg static linking issue](https://github.com/microsoft/vcpkg/issues/39533)
- [Homebrew openimageio](https://formulae.brew.sh/formula/openimageio)
