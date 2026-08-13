import { availableParallelism, cpus } from "node:os";

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

export function workerMediaDecodeConcurrency(): number {
  return mediaDecodeConcurrency(detectLogicalCpuCount());
}

export function workerMediaDecodeWaveSize(): number {
  return mediaDecodeWaveSize(workerMediaDecodeConcurrency());
}
