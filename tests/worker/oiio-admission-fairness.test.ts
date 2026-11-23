import { describe, expect, it } from "vitest";
import {
  estimateMediaNativeMemoryBytes,
  mediaNativeMemoryBudget,
} from "../../src/worker/media-memory-budget";
import { LibraryService, type SpawnFunction } from "../../src/worker/library-service";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}

type OiioRunner = {
  runOiio(
    command: string,
    args: string[],
    options?: {
      signal?: AbortSignal;
      memory?: { sourceByteSize?: number | null; width?: number | null; height?: number | null };
    },
  ): Promise<{ stdout: Buffer; stderr: string; exitCode: number }>;
};

describe("OIIO native admission fairness", () => {
  it("does not let queued OIIO slots reserve memory needed by a different decoder", async () => {
    expect(mediaNativeMemoryBudget.usedBytes).toBe(0);

    const firstSpawnStarted = deferred();
    const holdFirstSpawn = deferred();
    let spawnCount = 0;
    let activeOiio = 0;
    let peakOiio = 0;
    const service = new LibraryService({
      spawnFn: (async () => {
        spawnCount += 1;
        activeOiio += 1;
        peakOiio = Math.max(peakOiio, activeOiio);
        try {
          if (spawnCount === 1) {
            firstSpawnStarted.resolve();
            await holdFirstSpawn.promise;
          }
          return { stdout: Buffer.alloc(0), stderr: '', exitCode: 0 };
        } finally {
          activeOiio -= 1;
        }
      }) satisfies SpawnFunction,
    });
    const runOiio = (service as unknown as OiioRunner).runOiio.bind(service);
    const memory = {
      width: 6_144,
      height: 4_096,
    };
    const oiioReservation = estimateMediaNativeMemoryBytes({ decoder: "oiio", ...memory });
    const promises: Promise<unknown>[] = [];
    let shortTaskStarted = false;
    let shortTaskStartedBeforeOiioRelease: boolean;
    let settled: PromiseSettledResult<unknown>[];

    try {
      const first = runOiio("fake-oiio", [], { memory });
      promises.push(first);
      await Promise.race([
        firstSpawnStarted.promise,
        first.then(() => { throw new Error("The held OIIO spawn completed before its gate opened."); }),
      ]);

      promises.push(runOiio("fake-oiio", [], { memory }));
      promises.push(runOiio("fake-oiio", [], { memory }));
      await Promise.resolve();
      await Promise.resolve();

      promises.push(mediaNativeMemoryBudget.run(
        undefined,
        64 * 1024 * 1024,
        async () => { shortTaskStarted = true; },
      ));
      await new Promise<void>((resolve) => setImmediate(resolve));
      shortTaskStartedBeforeOiioRelease = shortTaskStarted;
    } finally {
      holdFirstSpawn.resolve();
      settled = await Promise.allSettled(promises);
      service.closeAll();
    }

    expect(settled.every((result) => result.status === "fulfilled")).toBe(true);
    expect(mediaNativeMemoryBudget.usedBytes).toBe(0);
    expect(mediaNativeMemoryBudget.activeForAdmission("oiio")).toBe(0);
    expect(oiioReservation).toBeGreaterThan(100 * 1024 * 1024);
    expect(peakOiio).toBe(1);
    expect(shortTaskStartedBeforeOiioRelease).toBe(true);
  });
});
