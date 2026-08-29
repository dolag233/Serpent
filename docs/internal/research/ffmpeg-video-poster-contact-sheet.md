# Electron + TypeScript MVP FFmpeg 视频封面与联系表调研

> 调研日期：2026-07-12
> 范围：提取视频海报帧、多帧联系表以支持 AI 视频分析；Node 24、Electron 43、跨平台 macOS arm64 + Windows x64。
> 来源约束：仅引用 FFmpeg 官方文档、npm 包仓库与许可证原文、Electron/Node 官方文档、可靠构建源（BtbN、evermeet.cx、gyan.dev）。许可证部分是工程合规分析，不是法律意见。

## 结论

Serpent MVP 应采用 **自建或信源明确的 LGPL-only `ffmpeg`/`ffprobe` 可执行文件 + `fluent-ffmpeg` npm 包作为 TypeScript 命令构造层**，从 Library Worker（UtilityProcess）通过 `child_process.spawn()` 调用。

明确不建议：

- **`ffmpeg-static` npm 包**：其下载的预编译二进制来自多个源（John Van Sickle Linux、evermeet.cx macOS、gyan.dev Windows），其中 gyan.dev Windows 构建明确包含 libx264/libx265（GPL）；npm 包元数据列出 GPL-3.0-or-later，其自身 JS wrapper 虽是 BSD-3-Clause，但**整体分发的许可证状态不等于 LGPL-only**。不能直接把该 npm 包打进 MIT 应用。[ffmpeg-static GitHub 仓库与 LICENSE](https://github.com/eugeneware/ffmpeg-static/blob/b5.0/LICENSE)、[npm 包元数据](https://www.npmjs.com/package/ffmpeg-static)
- **`@ffmpeg/ffmpeg`（ffmpeg.wasm）**：官方基准显示 Wasm 单线程比原生慢约 25 倍，多线程约 12 倍；不支持 GPU 硬件加速；2 GB 文件硬上限；在 Electron UtilityProcess 已有原生进程能力的前提下引入 Wasm 是倒退。[ffmpeg.wasm 官方性能文档](https://ffmpegwasm.netlify.app/docs/performance/)
- **Node.js 原生 libav binding**：截至 2026 年中不存在维护良好、生产就绪的 Node.js C++ addon 直接绑定 libav*/libavformat/libavcodec。构建和维护这样一个 addon 的成本远超其收益，且仍要履行 LGPL 义务。

## 三种集成方式对比

| 方式 | 许可证状态 | 性能 | 打包复杂度 | 维护成本 | Serpent 结论 |
|---|---|---|---|---|---|
| `ffmpeg-static` npm + 裸 `spawn` | **不可靠**：下载的二进制可能含 GPL 组件（libx264/libx265），npm 包元数据列 GPL-3.0 | 原生 | 低（需 ASAR unpack） | 低（跟随上游更新） | 不采用：许可证不可靠 |
| `ffmpeg-static` npm + `fluent-ffmpeg` | 同上（`fluent-ffmpeg` 自身是 MIT，但不改变 FFmpeg 二进制的许可证） | 原生 | 低（需 ASAR unpack） | 低 | 不采用：二进制许可证问题 |
| 自建 LGPL-only FFmpeg 二进制 + `fluent-ffmpeg` | **可靠**：可证明的 LGPL-only 构建，JS wrapper 是 MIT | 原生 | 中（需维护构建脚本或锁定信源） | 中（每平台更新二进制） | **推荐** |
| 自建 LGPL-only FFmpeg 二进制 + 裸 `spawn` | 可靠 | 原生 | 中 | 中（需手动构造 CLI 参数） | 备选：减少一层依赖 |
| `@ffmpeg/ffmpeg`（ffmpeg.wasm） | LGPL（Wasm 构建通常 LGPL） | 极差（12-25x 慢于原生） | 低（纯 JS） | 低 | 不采用：性能不可接受 |
| Node.js native libav C++ addon | 理论可行（动态链接 LGPL 库） | 可能最优（无进程启动开销） | 极高（需 N-API、每平台 ABI、线程安全） | 极高（需跟随 FFmpeg API 变更） | 不采用：无现成方案，工程成本过高 |

`fluent-ffmpeg` 自身是 MIT 许可证，它只是一个构建命令行参数并管理子进程的 Node.js 库，不包含任何 FFmpeg 代码。它与任何 FFmpeg 二进制搭配使用时，整体分发许可证由该二进制的许可证决定。[fluent-ffmpeg npm](https://www.npmjs.com/package/fluent-ffmpeg)

## LGPL 合规路线

### FFmpeg 的许可证结构

FFmpeg 核心库（libavcodec、libavformat、libavutil 等）默认是 LGPL-2.1-or-later。但启用 `--enable-gpl` 编译选项或链接任何 GPL 库（libx264、libx265、libpostproc 等）后，**整个 FFmpeg 构建变为 GPL**。FFmpeg 官方明确说明 GPL 组件默认不会启用，需显式 `--enable-gpl`。[FFmpeg LICENSE 文件](https://ffmpeg.org/doxygen/7.0/md_LICENSE.html)、[FFmpeg 法律合规清单](https://www.ffmpeg.org/legal.html)

### 对 MIT 应用的合规要求

Serpent 是 MIT 许可证（ADR-0012）。分发 LGPL 的 FFmpeg 是**允许的**，条件是：

1. **构建层面**：FFmpeg 构建必须显式禁用 `--enable-gpl` 和 `--enable-nonfree`，不链接 libx264、libx265 等 GPL 库，也不链接 libfdk_aac 等 nonfree 库。
2. **动态链接/独立进程**：将 FFmpeg 作为独立的可执行文件通过 `child_process.spawn()` 调用，构成 LGPL 意义上的"独立作品"使用方式。这是最干净的合规模式——比静态链接或动态链接 libav*.so/.dylib/.dll 更安全。
3. **源码提供义务**：必须随分发提供 FFmpeg 精确对应的完整源码，或附上有效期至少三年的书面源码获取要约。保存精确的 configure 参数、任何补丁的 diff、依赖库版本清单。
4. **归属**：在 About 窗口、第三方许可证页面和下载页注明"本软件使用了 FFmpeg 项目基于 LGPLv2.1 的代码"，并包含 FFmpeg 版权声明。
5. **分离清晰**：不声称整个发布包只有 MIT；FFmpeg 二进制和其许可证文件放在独立的 `third-party/` 或 `resources/ffmpeg/` 目录中。
6. **代理输出选择**：使用 WebM/VP9/Opus 输出预览代理，避免在输出端引入 GPL（x264）或专利风险更高的编码器。

### 编解码器专利是独立问题

FFmpeg 官方 Patent Mini-FAQ 明确指出：LGPL/GPL 合规不能回答编解码器专利问题。H.264、AAC、HEVC 等编解码器的专利风险随司法辖区和商业使用场景变化。Serpent 读取用户已有的 H.264/HEVC/WMV 文件、输出 WebM/VP9/Opus 代理的策略可以降低但不能消除这类风险。[FFmpeg Patent Mini-FAQ](https://www.ffmpeg.org/legal.html#Patent-Mini_002dFAQ)

## 可靠 LGPL 构建源

### Windows x64：BtbN FFmpeg-Builds（推荐）

BtbN 提供每日自动构建，明确区分 `lgpl` / `gpl` / `nonfree` 三种变体。LGPL 静态构建不包含 libx264/libx265 等 GPL 库。文件名模式：`ffmpeg-n<version>-<commit>-win64-lgpl-<branch>.zip`。[BtbN/FFmpeg-Builds releases](https://github.com/BtbN/FFmpeg-Builds/releases)

- 许可证：LGPL v3（非 v2.1，见 [FFmpeg-trac #11328](https://ffmpeg.org/pipermail/ffmpeg-trac/2024-November/071862.html)）
- 最低要求：Windows 10 22H2（需要 UCRT）
- 保留策略：每月最后一个构建保留 2 年，最近 14 个每日构建保留
- **注意**：LGPL v3 与 LGPL v2.1 的兼容性需要确认；如果 v3 对 MIT 分发造成额外限制，需评估是否自己构建 LGPL v2.1 版本

### macOS arm64：无现成 LGPL static build，需自建

- **evermeet.cx**：最知名的 macOS FFmpeg 静态构建源，但维护者明确声明**永远不会提供原生 ARM64 构建**。现有 x86_64 构建可通过 Rosetta 2 运行，但有性能损耗且不满足"原生 arm64"要求。[evermeet.cx Apple Silicon 声明](https://evermeet.cx/ffmpeg/apple-silicon-arm)
- **osxexperts.net**：提供 Intel 和 Apple Silicon 静态构建，但未明确区分 LGPL/GPL 变体，需要逐版本验证 configure 参数。
- **自建**：在 macOS arm64 上通过 `./configure --disable-gpl --disable-nonfree` 编译。构建脚本可参考 [WayneKoorts/ffmpeg-macos-universal-binary-builder](https://github.com/WayneKoorts/ffmpeg-macos-universal-binary-builder)。

### Linux（CI 用）：John Van Sickle

John Van Sickle 提供 Linux 静态构建（x86_64、i686、armhf、arm64），是 `ffmpeg-static` npm 包的 Linux 二进制来源。但其构建包含 GPL 组件（如 libx264），不可直接用于 LGPL-only 分发。可参考其[构建脚本](https://johnvansickle.com/ffmpeg/)自行编译 LGPL 变体。

### 建议的最终方案

- **Windows x64**：锁定 BtbN LGPL 静态构建的特定版本（SHA-256 固定），存入 `resources/ffmpeg/win32-x64/`
- **macOS arm64**：自建 LGPL-only 静态构建并存入 `resources/ffmpeg/darwin-arm64/`。CI 在 macOS arm64 runner 上执行编译，产物随发布归档
- **macOS x64**：同 arm64 自建流程
- 每个构建在 CI 中校验 `-buildconf` 不含 `enable-gpl`、`enable-nonfree`、`libx264`、`libx265` 等禁用标志
- 构建脚本、精确 configure 行、补丁 diff 和依赖源码归档随发布包提供

## 推荐的 TypeScript 集成模式

### 架构位置

FFmpeg 进程由 **Library Worker**（`utilityProcess`）通过 `child_process.spawn()` 启动，参数数组传递，`shell: false`。这与已有架构决策（ADR-0018、ADR-0020 及[后台任务架构调研](electron-background-worker-architecture.md)）一致：

```
Renderer (sandboxed, no Node)
  └─ typed commands via IPC
Main (lifecycle, supervision)
  └─ utilityProcess.fork
Library Worker
  ├─ import { spawn } from "child_process"
  ├─ fluent-ffmpeg (构建参数) + execFile (执行)
  └─ TaskQueue { poster, contactSheet, proxy, probe }
```

- Renderer 只接收资产 ID、任务状态和受控的衍生物路径，不接触 FFmpeg
- Main 只管理 Library Worker 生命周期，不直接调用 FFmpeg
- Library Worker 限制 FFmpeg 并发数、wall-clock 超时、最大输出文件大小
- 取消任务时 kill 整个子进程组，清理临时文件

### 依赖清单

```json
{
  "dependencies": {
    "fluent-ffmpeg": "^2.1.3"
  }
}
```

`fluent-ffmpeg` 版本锁定为 MIT 许可证的最新稳定版。FFmpeg 二进制路径通过环境变量或构建时配置注入，不在源码中硬编码。

### 探测（ffprobe）

```typescript
// media-worker/probe.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface VideoProbe {
  format: {
    duration: string;
    bit_rate: string;
    format_name: string;
  };
  streams: Array<{
    codec_type: "video" | "audio" | "subtitle";
    codec_name: string;
    width?: number;
    height?: number;
    r_frame_rate?: string;
    duration?: string;
    pix_fmt?: string;
    display_aspect_ratio?: string;
    side_data_list?: Array<{ rotation?: number }>;
    channels?: number;
    sample_rate?: string;
    tags?: Record<string, string>;
  }>;
}

export async function probeVideo(ffprobePath: string, filePath: string): Promise<VideoProbe> {
  const { stdout } = await execFileAsync(ffprobePath, [
    "-v", "quiet",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    filePath,
  ], { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 });

  return JSON.parse(stdout);
}
```

关键：`execFile` 不是 `exec`，参数是数组而非 shell 字符串，`shell: false`（`execFile` 默认行为）。超时限制防止挂起文件阻塞 worker。[Node.js Child Process](https://nodejs.org/api/child_process.html#child_processexecfilefile-args-options-callback)

### 使用 fluent-ffmpeg 简化命令构造

```typescript
// media-worker/ffmpeg.ts
import Ffmpeg from "fluent-ffmpeg";

export function createFfmpeg(ffmpegPath: string, inputPath: string): Ffmpeg.FfmpegCommand {
  const cmd = Ffmpeg(inputPath);
  cmd.setFfmpegPath(ffmpegPath);
  return cmd;
}

// 探测时使用 ffprobe
export async function ffprobeJson(
  ffprobePath: string,
  inputPath: string,
): Promise<Ffmpeg.FfprobeData> {
  return new Promise((resolve, reject) => {
    Ffmpeg.ffprobe(inputPath, { path: ffprobePath }, (err, data) => {
      if (err) return reject(err);
      resolve(data);
    });
  });
}
```

`fluent-ffmpeg` 的优势是链式 API 构造复杂的 filtergraph 参数，自动处理转义，并在底层使用 `spawn` 执行。但不能用它替代对参数正确性的理解——它的 `run()` / `save()` 仍然真正启动子进程，因此超时、取消、输出大小限制仍需外层管理。

### 海报帧提取

```typescript
// media-worker/poster.ts
import type Ffmpeg from "fluent-ffmpeg";

/**
 * Extract a representative poster frame from a video.
 * Strategy: use the `thumbnail` filter to select the frame with the
 * most typical color histogram from a batch, then pick the best.
 */
export function extractPosterFrame(
  cmd: Ffmpeg.FfmpegCommand,
  outputPath: string,
  options: {
    width: number;            // max width, e.g. 640
    batchSize?: number;       // frames per thumbnail batch (default 100)
    seekPercent?: number;     // skip intro (0-100, default 5 to skip black leader)
    quality?: number;         // JPEG quality 1-100
  },
): Promise<void> {
  const { width, batchSize = 100, seekPercent = 5, quality = 85 } = options;

  return new Promise((resolve, reject) => {
    cmd
      .seekInput(seekPercent)  // skip potential black intro (% of duration)
      .videoFilter([
        `thumbnail=n=${batchSize}`,
        `scale=${width}:-1:flags=lanczos`,
      ])
      .outputOptions([
        "-frames:v", "1",
        "-q:v", String(Math.round(quality / 100 * 31)), // JPEG quality mapping
      ])
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", (err) => reject(err))
      .run();
  });
}
```

`thumbnail` 过滤器对每批 `n` 帧构建 RGB 直方图，计算平均直方图，选取最接近平均的帧作为代表。不涉及人脸/语义分析，纯统计选择。跳过片头百分比避免黑场。[FFmpeg `thumbnail` 过滤器文档](https://www.ffmpeg.org/ffmpeg-filters.html#thumbnail)

备选方案：如果内嵌封面存在（MP4/MOV 的 `cover_art` 流），优先用 `ffmpeg -map 0:v -map -0:V?` 或专门的 `-dump_attachment` 提取，跳过 `thumbnail` 筛选。

### 等间隔抽帧 + 时间编号联系表

```typescript
// media-worker/contact-sheet.ts
import type Ffmpeg from "fluent-ffmpeg";

export interface ContactSheetOptions {
  frameCount: number;        // total frames to extract, e.g. 16
  thumbWidth: number;        // width of each tile, e.g. 320
  columns: number;           // grid columns, e.g. 4
  fontFile: string;          // absolute path to a .ttf font
  fontSize?: number;         // default 12
  margin?: number;           // tile margin in px, default 2
  padding?: number;          // tile padding in px, default 2
  showTimestamp?: boolean;   // overlay HH:MM:SS on each frame
  quality?: number;          // JPEG quality 1-100
}

/**
 * Generate a multi-frame contact sheet with per-frame timestamps.
 * Uses a single FFmpeg pass: fps→scale→drawtext→tile.
 *
 * Filter chain explanation:
 *   fps=1/N    — extract one frame every N seconds (N = duration / frameCount)
 *   scale      — resize each extracted frame
 *   drawtext   — burn timestamp on each frame BEFORE tiling
 *   tile       — assemble frames into grid; output a single image
 */
export function generateContactSheet(
  cmd: Ffmpeg.FfmpegCommand,
  durationSec: number,
  outputPath: string,
  options: ContactSheetOptions,
): Promise<void> {
  const {
    frameCount,
    thumbWidth,
    columns,
    fontFile,
    fontSize = 12,
    margin = 2,
    padding = 2,
    showTimestamp = true,
    quality = 85,
  } = options;

  const interval = durationSec / frameCount;
  const rows = Math.ceil(frameCount / columns);

  const filterParts: string[] = [];

  // 1. Extract frames at equal time intervals
  filterParts.push(`fps=1/${interval}`);

  // 2. Scale each thumbnail
  filterParts.push(`scale=${thumbWidth}:-1:flags=lanczos`);

  // 3. Burn timestamp on each frame BEFORE tiling
  // Using %{pts:hms} gives the actual PTS of each selected frame in HH:MM:SS.mmm
  if (showTimestamp) {
    filterParts.push(
      `drawtext=fontfile='${fontFile}':text='%{pts\\:hms}':` +
      `fontsize=${fontSize}:fontcolor=white@0.9:` +
      `x=w-tw-4:y=h-th-4:` +
      `box=1:boxcolor=black@0.5:boxborderw=2`,
    );
  }

  // 4. Tile into grid
  filterParts.push(
    `tile=${columns}x${rows}:margin=${margin}:padding=${padding}:color=#1a1a1a`,
  );

  const filterGraph = filterParts.join(",");

  return new Promise((resolve, reject) => {
    cmd
      .videoFilter(filterGraph)
      .outputOptions([
        "-frames:v", "1",
        "-q:v", String(Math.round(quality / 100 * 31)),
        "-update", "1",  // overwrite output if it exists
      ])
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", (err) => reject(err))
      .run();
  });
}
```

关键设计决定：

- **`drawtext` 在 `tile` 之前**：每个选中的帧先被缩放，再烧入其实际时间戳（`%{pts:hms}`），最后 tile 将所有已标记帧拼成网格。如果 drawtext 在 tile 之后，只能得到一个覆盖整张拼图的文字，而非每格独立时间戳。
- **使用 `%{pts:hms}` 而非 `timecode=`**：`timecode` 参数会按帧速率重新计数，不反映 `select`/`fps` 筛选后的实际时间。`%{pts:hms}` 输出选中帧的真实 PTS。[StackOverflow：正确时间码的 tile 生成](https://stackoverflow.com/questions/49259648/how-to-generate-tile-with-video-thumbnails-with-right-timecode)
- **字体文件**：`drawtext` 需要绝对路径指向 `.ttf` 字体。Serpent 应在 `resources/fonts/` 中随包携带一个开源字体（如 DejaVu Sans Mono），避免依赖系统字体。Windows 和 macOS 的默认字体路径不同，硬编码会导致跨平台失败。
- **单次 FFmpeg 调用**：整个 pipeline 在一个进程中完成，避免中间文件写入和多次编解码。

### 使用 fluent-ffmpeg 时，底层仍需 raw spawn 控制的场景

`fluent-ffmpeg` 的 `run()` 方法不直接暴露子进程对象，其取消机制（`.kill()`）依赖内部跟踪。对于需要更强控制的场景（精确超时、KILL 信号回退、输出大小限制），可以直接用 `fluent-ffmpeg` 构造参数，再通过 `spawn` 执行：

```typescript
import { spawn, type ChildProcess } from "node:child_process";
import Ffmpeg from "fluent-ffmpeg";

interface ManagedFfmpegTask {
  proc: ChildProcess;
  cancel(): void;
  promise: Promise<void>;
}

export function spawnFfmpeg(
  ffmpegPath: string,
  args: string[],
  options: {
    timeout: number;
    maxOutputBytes: number;
    signal: AbortSignal;
  },
): ManagedFfmpegTask {
  const proc = spawn(ffmpegPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  // ... setup timeout, output size limit, signal listener ...

  return {
    proc,
    cancel: () => {
      proc.kill("SIGTERM");
      setTimeout(() => {
        if (proc.exitCode === null) proc.kill("SIGKILL");
      }, 5_000);
    },
    promise: /* ... */,
  };
}
```

使用 `fluent-ffmpeg` 的 `._getArguments()` 方法（非公开 API，但稳定）可以获取它构造的参数数组，再交给自定义的 `spawn` wrapper 执行。这是一种务实的混合模式。

## 跨平台打包要点

### ASAR 解包

FFmpeg 二进制**不能**放在 ASAR 内部。Electron 官方说明 ASAR 是虚拟只读文件系统，`spawn`/`exec` 无法可靠执行 ASAR 内二进制。[Electron ASAR 文档](https://www.electronjs.org/docs/latest/tutorial/asar-archives#executing-binaries-inside-asar-archive)

Electron Forge 配置示例（`forge.config.ts` 或 `package.json`）：

```json
{
  "packagerConfig": {
    "asar": {
      "unpack": "**/resources/ffmpeg/**"
    }
  }
}
```

或将 FFmpeg 放在 `extraResource` 目录中，完全位于 ASAR 之外。

### 平台路径解析

```typescript
import { app } from "electron";
import path from "node:path";

export function getFfmpegBasePath(): string {
  const platform = process.platform === "win32" ? "win32-x64"
    : process.arch === "arm64" ? "darwin-arm64"
    : "darwin-x64";

  // In development
  if (!app.isPackaged) {
    return path.join(__dirname, "..", "resources", "ffmpeg", platform);
  }

  // In packaged app: extraResource or ASAR-unpacked
  return path.join(process.resourcesPath, "ffmpeg", platform);
}

export function getFfmpegPath(): string {
  const base = getFfmpegBasePath();
  return process.platform === "win32"
    ? path.join(base, "ffmpeg.exe")
    : path.join(base, "ffmpeg");
}
```

### macOS 代码签名

FFmpeg 二进制需要纳入 macOS 代码签名和公证流程。从 `resources/ffmpeg/` 下以独立可执行文件分布时，它们作为应用包的一部分会被 Electron Forge/Builder 的标准签名流程覆盖。但如果动态下载或后期替换二进制，需要单独的签名步骤。

### 二进制体积

LGPL-only 静态 FFmpeg 约 50-80 MB（取决于启用的 LGPL 兼容编码器/解复用器数量）。这对桌面应用是可接受的，但需要在安装包大小和下载体验中考虑。如果体积成为问题，可以裁剪不用的解复用器和解码器（如不需要的音频 codec、不相关的容器格式），但保留完整的探测能力。

## CI 自动化防线

CI 应对每个平台产物执行：

1. **构建合规检查**：`ffmpeg -buildconf` 输出中不得出现 `enable-gpl`、`enable-nonfree`、`libx264`、`libx265`、`libfdk_aac`；出现任一即构建失败。
2. **能力清单**：记录 `-version`、`-buildconf`、`-formats`、`-codecs` 的完整输出，随发布归档。
3. **二进制 SHA-256**：锁定每个发布的 FFmpeg 二进制哈希。
4. **格式 smoke test**：使用已知 MP4/MOV/AVI/WMV 样本逐一验证探针（ffprobe）、海报帧（thumbnail filter）、联系表（fps+tile+drawtext）、取消和坏文件超时。
5. **许可证目录生成**：自动收集 FFmpeg LICENSE 文件、configure 参数、构建源码引用，生成 `third-party/ffmpeg/` 目录内容。

## 实施顺序建议

1. 先建立 FFmpeg 二进制构建流水线（macOS arm64 + Windows x64 LGPL-only），产出验证脚本。
2. 在 Library Worker 中实现 `VideoProbe` 接口，先接入 `ffprobe` JSON 探测。
3. 实现海报帧提取（`thumbnail` filter），缓存为 WebP/JPEG 衍生物。
4. 实现联系表生成（`fps` + `scale` + `drawtext` + `tile` pipe），输出为 JPEG 衍生物，配合 AI 分析队列使用。
5. 实现取消、超时、输出限制和临时文件清理。
6. 添加 fluent-ffmpeg wrapper（可推迟到第 5 步之后，初期用裸 spawn 验证 filtergraph 稳定性）。

联系表的抽帧数量、网格尺寸和输出分辨率应作为可配置项，因为 AI 视觉模型对输入尺寸和帧数有具体要求——这部分配置不属于本调研范围，由 AI 集成阶段决定。

## 参考文献

- [FFmpeg 官方 LICENSE](https://ffmpeg.org/doxygen/7.0/md_LICENSE.html)
- [FFmpeg 法律合规清单](https://www.ffmpeg.org/legal.html)
- [FFmpeg Patent Mini-FAQ](https://www.ffmpeg.org/legal.html#Patent-Mini_002dFAQ)
- [FFmpeg `thumbnail` 过滤器](https://www.ffmpeg.org/ffmpeg-filters.html#thumbnail)
- [FFmpeg `tile` 过滤器](https://www.ffmpeg.org/ffmpeg-filters.html#tile)
- [FFmpeg `drawtext` 过滤器](https://ffmpeg.org/ffmpeg-filters.html#drawtext)
- [FFmpeg `fps` 过滤器](https://ffmpeg.org/ffmpeg-filters.html#fps)
- [ffmpeg.wasm 官方性能文档](https://ffmpegwasm.netlify.app/docs/performance/)
- [BtbN/FFmpeg-Builds releases（Windows LGPL）](https://github.com/BtbN/FFmpeg-Builds/releases)
- [evermeet.cx FFmpeg macOS 静态构建](https://evermeet.cx/ffmpeg/)
- [evermeet.cx Apple Silicon 声明](https://evermeet.cx/ffmpeg/apple-silicon-arm)
- [ffmpeg-static GitHub 仓库](https://github.com/eugeneware/ffmpeg-static)
- [fluent-ffmpeg npm](https://www.npmjs.com/package/fluent-ffmpeg)
- [Electron ASAR 文档](https://www.electronjs.org/docs/latest/tutorial/asar-archives)
- [Node.js Child Process](https://nodejs.org/api/child_process.html)
- [StackOverflow：FFmpeg tile 正确时间码](https://stackoverflow.com/questions/49259648/how-to-generate-tile-with-video-thumbnails-with-right-timecode)
- [gyan.dev FFmpeg Windows builds](https://www.gyan.dev/ffmpeg/builds/)
