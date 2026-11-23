import { closeSync, openSync, readFileSync, writeFileSync } from "node:fs";
import type { ElectronApplication, Page } from "@playwright/test";
import { summarizeHeapSnapshot, type HeapSnapshot } from "./heap-snapshot-summary";
import { createHeapSnapshotWriter } from "./heap-snapshot-writer";

const mibFromBytes = (value: number | undefined): number | null =>
  value === undefined ? null : Number((value / 1024 ** 2).toFixed(2));

/** Bounded, opt-in CDP observations. No history of URLs, frames or DOM nodes is retained. */
export async function createThumbnailMemoryProbe(application: ElectronApplication, page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const target = await application.browserWindow(page);
  const rendererPid = await target.evaluate(window => window.webContents.getOSProcessId());
  await target.dispose();
  await cdp.send("Performance.enable");
  await page.evaluate(() => {
    type State = {
      frames: number; totalMs: number; maxMs: number; last: number | null;
      buckets: Uint32Array; tasks: number; taskMs: number; taskMaxMs: number;
      raf: number; observer: PerformanceObserver | null;
    };
    const state: State = {
      frames: 0, totalMs: 0, maxMs: 0, last: null, buckets: new Uint32Array(1002),
      tasks: 0, taskMs: 0, taskMaxMs: 0, raf: 0, observer: null,
    };
    const frame = (at: number) => {
      if (state.last !== null) {
        const delta = at - state.last;
        state.frames += 1;
        state.totalMs += delta;
        state.maxMs = Math.max(state.maxMs, delta);
        state.buckets[Math.min(1001, Math.max(0, Math.ceil(delta)))]! += 1;
      }
      state.last = at;
      state.raf = requestAnimationFrame(frame);
    };
    state.raf = requestAnimationFrame(frame);
    if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
      state.observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          state.tasks += 1;
          state.taskMs += entry.duration;
          state.taskMaxMs = Math.max(state.taskMaxMs, entry.duration);
        }
      });
      state.observer.observe({ entryTypes: ["longtask"] });
    }
    (globalThis as typeof globalThis & { __thumbnailMemoryProbe: State }).__thumbnailMemoryProbe = state;
  });
  return {
    async sample(label: string, completed: number) {
      const started = Date.now();
      const heap = await cdp.send("Runtime.getHeapUsage");
      const dom = await cdp.send("Memory.getDOMCounters");
      const performance = await cdp.send("Performance.getMetrics");
      const metrics = await application.evaluate(({ app }, pid) => {
        // Electron MemoryInfo is in KiB, including the Windows-only privateBytes.
        const convert = (value: number | undefined) => value === undefined ? null : Number((value / 1024).toFixed(2));
        return app.getAppMetrics().map(metric => ({
          role: metric.pid === pid ? "renderer"
            : metric.type === "Browser" ? "main"
              : metric.name === "Serpent Library Worker" ? "worker"
                : metric.type === "GPU" ? "gpu" : metric.type.toLowerCase(),
          privateMiB: convert(metric.memory.privateBytes),
          workingSetMiB: convert(metric.memory.workingSetSize),
          cpuPercent: metric.cpu.percentCPUUsage,
        }));
      }, rendererPid);
      const frame = await page.evaluate(() => {
        const state = (globalThis as typeof globalThis & {
          __thumbnailMemoryProbe: {
            frames: number; totalMs: number; maxMs: number; last: number | null;
            buckets: Uint32Array; tasks: number; taskMs: number; taskMaxMs: number;
          };
        }).__thumbnailMemoryProbe;
        let cumulative = 0;
        let p95: number | null = null;
        for (let index = 0; index < state.buckets.length; index += 1) {
          cumulative += state.buckets[index]!;
          if (state.frames > 0 && cumulative >= Math.ceil(state.frames * 0.95)) {
            p95 = index === 1001 ? null : index;
            break;
          }
        }
        const media = [...document.querySelectorAll<HTMLImageElement>("img")];
        const result = {
          frames: state.frames, frameP95UpperMs: p95, framesOverOneSecond: state.buckets[1001],
          frameMaxMs: state.frames ? state.maxMs : null,
          longTasks: state.tasks, longTaskTotalMs: state.taskMs, longTaskMaxMs: state.taskMaxMs,
          imageElements: media.length,
          decodedImageElements: media.filter(image => image.complete && image.naturalWidth > 0).length,
          currentImageUrls: new Set(media.map(image => image.currentSrc || image.src)).size,
        };
        state.frames = 0; state.totalMs = 0; state.maxMs = 0; state.buckets.fill(0);
        state.tasks = 0; state.taskMs = 0; state.taskMaxMs = 0; state.last = null;
        return result;
      });
      const taskDuration = performance.metrics.find(metric => metric.name === "TaskDuration")?.value ?? null;
      return {
        label, completed, epochMs: started, sampleMs: Date.now() - started,
        heap: { usedMiB: mibFromBytes(heap.usedSize), totalMiB: mibFromBytes(heap.totalSize),
          embedderMiB: mibFromBytes(heap.embedderHeapUsedSize), backingStorageMiB: mibFromBytes(heap.backingStorageSize) },
        dom, processes: metrics, frame, taskDurationSeconds: taskDuration,
      };
    },
    async collectGarbage() { await cdp.send("HeapProfiler.collectGarbage"); },
    /** Capturing forces GC and changes memory. Call only AFTER the normal idle samples. */
    async captureHeapSummary(filePath: string) {
      const fd = openSync(filePath, "wx");
      const writer = createHeapSnapshotWriter(chunk => writeFileSync(fd, chunk));
      const listener = ({ chunk }: { chunk: string }) => { writer.append(chunk); };
      cdp.on("HeapProfiler.addHeapSnapshotChunk", listener);
      try {
        await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
      } finally {
        cdp.off("HeapProfiler.addHeapSnapshotChunk", listener);
        closeSync(fd);
      }
      const { writtenBytes: bytes, receivedBytes, truncated } = writer.read();
      // The complete raw snapshot is private and lives only in the test's owned
      // temporary directory. A truncated file is never passed to JSON.parse.
      if (truncated) return { bytes, receivedBytes, truncated, skipped: "Snapshot exceeds temporary file budget." };
      return { bytes, receivedBytes, truncated,
        ...summarizeHeapSnapshot(JSON.parse(readFileSync(filePath, "utf8")) as HeapSnapshot) };
    },
    async dispose() {
      try {
        await page.evaluate(() => {
          const root = globalThis as typeof globalThis & {
            __thumbnailMemoryProbe?: { raf: number; observer: PerformanceObserver | null };
          };
          if (root.__thumbnailMemoryProbe) {
            cancelAnimationFrame(root.__thumbnailMemoryProbe.raf);
            root.__thumbnailMemoryProbe.observer?.disconnect();
            delete root.__thumbnailMemoryProbe;
          }
        });
      } finally {
        await cdp.detach();
      }
    },
  };
}
