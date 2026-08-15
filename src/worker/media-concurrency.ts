import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { availableParallelism, cpus, platform } from "node:os";

import {
  mediaDecodeConcurrency,
  mediaDecodeWaveSize,
} from "../shared/media-concurrency";

export function detectLogicalCpuCount(): number {
  try {
    if (typeof availableParallelism === "function") {
      const counted = availableParallelism();
      if (Number.isFinite(counted) && counted > 0) return counted;
    }
  } catch {
    // availableParallelism() may throw when the OS reports no affinity.
  }
  const listed = cpus().length;
  return listed > 0 ? listed : 1;
}

function positiveInteger(value: string): number | undefined {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/** Parse Linux's processor blocks without depending on the host running tests. */
export function physicalCpuCountFromProcCpuInfo(contents: string): number | undefined {
  const physicalCores = new Set<string>();
  let physicalId: string | undefined;
  let coreId: string | undefined;
  let processorBlockStarted = false;
  const flushProcessorBlock = () => {
    if (physicalId !== undefined && coreId !== undefined) {
      physicalCores.add(`${physicalId}:${coreId}`);
    }
    physicalId = undefined;
    coreId = undefined;
  };
  for (const line of contents.split(/\r?\n/u)) {
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key === "processor") {
      if (processorBlockStarted) flushProcessorBlock();
      processorBlockStarted = true;
      continue;
    }
    if (key === "physical id") physicalId = value;
    if (key === "core id") coreId = value;
  }
  flushProcessorBlock();
  return physicalCores.size > 0 ? physicalCores.size : undefined;
}

function queryPhysicalCpuCount(): number | undefined {
  try {
    if (platform() === "win32") {
      // NumberOfCores is the physical-core count. Keep this query short and
      // cached: it runs once per Worker, never once per queue drain.
      return positiveInteger(execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "(Get-CimInstance Win32_Processor | Measure-Object -Property NumberOfCores -Sum).Sum",
        ],
        { encoding: "utf8", timeout: 1_500, windowsHide: true },
      ));
    }

    if (platform() === "darwin") {
      return positiveInteger(execFileSync(
        "sysctl",
        ["-n", "hw.physicalcpu"],
        { encoding: "utf8", timeout: 1_500 },
      ));
    }

    if (platform() === "linux") {
      return physicalCpuCountFromProcCpuInfo(readFileSync("/proc/cpuinfo", "utf8"));
    }
  } catch {
    // Fall through to the conservative SMT estimate below.
  }
  return undefined;
}

let cachedPhysicalCpuCount: number | undefined;

export function detectPhysicalCpuCount(): number {
  if (cachedPhysicalCpuCount !== undefined) return cachedPhysicalCpuCount;
  const detected = queryPhysicalCpuCount();
  if (detected !== undefined) {
    cachedPhysicalCpuCount = detected;
    return detected;
  }

  // If the platform does not expose topology, assume two logical threads per
  // physical core. This is intentionally conservative for media encoders.
  cachedPhysicalCpuCount = Math.max(1, Math.ceil(detectLogicalCpuCount() / 2));
  return cachedPhysicalCpuCount;
}

export function workerMediaDecodeConcurrency(): number {
  return mediaDecodeConcurrency(detectPhysicalCpuCount());
}

export function workerMediaDecodeWaveSize(): number {
  return mediaDecodeWaveSize(workerMediaDecodeConcurrency());
}
