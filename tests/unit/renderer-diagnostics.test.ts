import { describe, expect, it } from "vitest";

import {
  logRendererChildProcessGone,
  logRendererConsoleMessage,
  logRendererProcessGone,
  logRendererResponsive,
  logRendererUnresponsive,
  type RendererDiagnosticLogger,
} from "../../src/main/renderer-diagnostics";

function createLogger(): RendererDiagnosticLogger & {
  infos: Array<{ scope: string; message: string; context?: Record<string, unknown> }>;
  errors: Array<{ scope: string; error: unknown; context?: Record<string, unknown> }>;
} {
  const logger = {
    infos: [] as Array<{ scope: string; message: string; context?: Record<string, unknown> }>,
    errors: [] as Array<{ scope: string; error: unknown; context?: Record<string, unknown> }>,
    info(scope: string, message: string, context?: Record<string, unknown>) {
      this.infos.push({ scope, message, context });
    },
    error(scope: string, error: unknown, context?: Record<string, unknown>) {
      this.errors.push({ scope, error, context });
    },
  };
  return logger;
}

describe("renderer diagnostics", () => {
  it("forwards only renderer warnings and errors, while preserving console context", () => {
    const logger = createLogger();

    logRendererConsoleMessage(logger, 0, "verbose", 1, "source.ts");
    logRendererConsoleMessage(logger, 1, "info", 2, "source.ts");
    logRendererConsoleMessage(logger, 2, "warning", 3, "source.ts");
    logRendererConsoleMessage(logger, 3, "error", 4, "source.ts");

    expect(logger.infos).toEqual([{
      scope: "renderer.console.warning",
      message: "warning",
      context: { level: 2, line: 3, sourceId: "source.ts" },
    }]);
    expect(logger.errors).toHaveLength(1);
    expect(logger.errors[0]).toMatchObject({
      scope: "renderer.console.error",
      context: { level: 3, line: 4, sourceId: "source.ts" },
    });
    expect(logger.errors[0]?.error).toBeInstanceOf(Error);
    expect((logger.errors[0]?.error as Error).message).toBe("error");
  });

  it("records renderer lifecycle and child-process failures with window identity", () => {
    const logger = createLogger();

    logRendererProcessGone(logger, 12, { reason: "crashed", exitCode: 9 });
    logRendererUnresponsive(logger, 12);
    logRendererResponsive(logger, 12);
    logRendererChildProcessGone(logger, 12, {
      type: "GPU",
      reason: "crashed",
      exitCode: 11,
      serviceName: "GPU Process",
    });

    expect(logger.errors.map((entry) => entry.scope)).toEqual([
      "renderer.process-gone",
      "renderer.unresponsive",
      "renderer.child-process-gone",
    ]);
    expect(logger.errors[0]?.context).toEqual({
      windowId: 12,
      reason: "crashed",
      exitCode: 9,
    });
    expect(logger.errors[2]?.context).toEqual({
      windowId: 12,
      type: "GPU",
      reason: "crashed",
      exitCode: 11,
      serviceName: "GPU Process",
    });
    expect(logger.infos).toEqual([{
      scope: "renderer.responsive",
      message: "The renderer became responsive again.",
      context: { windowId: 12 },
    }]);
  });
});
