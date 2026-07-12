import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

function serializeError(error: unknown, depth = 0): unknown {
  if (depth > 5) return { truncated: true };
  if (error instanceof Error) {
    const systemCode = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
    return {
      name: error.name,
      message: error.message,
      code: systemCode,
      stack: error.stack,
      cause: error.cause === undefined ? undefined : serializeError(error.cause, depth + 1),
    };
  }
  return { value: String(error) };
}

export class AppLogger {
  constructor(readonly filePath: string) {
    mkdirSync(path.dirname(filePath), { recursive: true });
  }

  error(scope: string, error: unknown, context?: Record<string, unknown>): void {
    this.write({ level: 'error', scope, context, error: serializeError(error) });
  }

  info(scope: string, message: string, context?: Record<string, unknown>): void {
    this.write({ level: 'info', scope, message, context });
  }

  worker(stream: 'stdout' | 'stderr', chunk: unknown): void {
    this.write({ level: stream === 'stderr' ? 'error' : 'info', scope: `worker.${stream}`, message: String(chunk).trimEnd() });
  }

  private write(entry: Record<string, unknown>): void {
    try {
      appendFileSync(this.filePath, `${JSON.stringify({ timestamp: new Date().toISOString(), ...entry })}\n`);
    } catch (error) {
      // Logging must not replace the primary application failure.
      console.error('Serpent could not write its application log.', error);
    }
  }
}
