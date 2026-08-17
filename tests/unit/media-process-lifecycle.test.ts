import { describe, expect, it } from "vitest";

import {
  defaultSpawnFn,
  shutdownActiveMediaProcesses,
  shutdownWorkerResources,
} from "../../src/worker/library-service";

describe("media subprocess lifecycle", () => {
  it("terminates an owned encoder child during Worker shutdown", async () => {
    const child = defaultSpawnFn(
      process.execPath,
      ["-e", "setTimeout(() => {}, 60000)"],
      { timeoutMs: 60_000 },
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    const startedAt = Date.now();
    await shutdownActiveMediaProcesses(250);
    const result = await child;

    expect(result.exitCode).not.toBe(0);
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });

  it("runs media cleanup before and after bounded library shutdown", async () => {
    const events: string[] = [];
    await shutdownWorkerResources(
      async (timeoutMs) => {
        events.push(`library:${timeoutMs}`);
      },
      async (timeoutMs) => {
        events.push(`media:${timeoutMs}`);
      },
      250,
    );

    expect(events).toEqual(["media:250", "library:250", "media:250"]);
  });
});
