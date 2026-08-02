import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  matchesAppLogAutomationCorrelation,
  parseAppLogEntry,
  type AppLogAutomationCorrelationId,
  type AppLogEntry,
  type SerializedLogError,
} from '../shared/app-log';

const MAX_LOG_READ_BYTES = 2_000_000;
const sensitiveContextKey = /^(?:api[_-]?key|access[_-]?token|token|secret|password|authorization|proxy-authorization|cookie|set-cookie|env|environment|process[_-]?env)$/iu;

function redactText(value: string): string {
  return value
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_API_KEY]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED_TOKEN]')
    .replace(/((?:proxy-)?authorization\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/([?&](?:api[_-]?key|access[_-]?token|token|secret|password)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|access[_-]?token|token|secret|password)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]');
}

function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[TRUNCATED]';
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        sensitiveContextKey.test(key) ? '[REDACTED]' : redactValue(item, depth + 1),
      ]),
    );
  }
  return value;
}

function redactPathText(value: string): string {
  return value
    .replace(/(?:\/private)?\/(?:Users|var|tmp|home|Volumes)\/[^\s"'`]+/g, '[PATH_REDACTED]')
    .replace(/[A-Za-z]:\\(?:[^\s"'`\\]+\\)*[^\s"'`]+/g, '[PATH_REDACTED]');
}

function redactPaths(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[TRUNCATED]';
  if (typeof value === 'string') return redactPathText(value);
  if (Array.isArray(value)) return value.map((item) => redactPaths(item, depth + 1));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactPaths(item, depth + 1)]),
    );
  }
  return value;
}

function serializeError(error: unknown, depth = 0): SerializedLogError | { value: string } | { truncated: true } {
  if (depth > 5) return { truncated: true };
  if (error instanceof Error) {
    const systemCode = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
    return {
      name: error.name,
      message: redactText(error.message),
      code: systemCode,
      stack: error.stack === undefined ? undefined : redactText(error.stack),
      cause: error.cause === undefined ? undefined : serializeError(error.cause, depth + 1),
    };
  }
  return { value: redactText(String(error)) };
}

export class AppLogger {
  constructor(readonly filePath: string) {
    mkdirSync(path.dirname(filePath), { recursive: true });
  }

  error(scope: string, error: unknown, context?: Record<string, unknown>): void {
    this.write({ level: 'error', scope, context: redactValue(context), error: serializeError(error) });
  }

  info(scope: string, message: string, context?: Record<string, unknown>): void {
    this.write({ level: 'info', scope, message: redactText(message), context: redactValue(context) });
  }

  worker(stream: 'stdout' | 'stderr', chunk: unknown): void {
    const level = stream === 'stderr' ? 'error' : 'info';
    const raw = String(chunk).trim();
    for (const line of raw.split(/\r?\n/).filter(Boolean)) {
      try {
        const parsed: unknown = JSON.parse(line);
        if (typeof parsed === 'object' && parsed !== null && 'scope' in parsed && typeof parsed.scope === 'string') {
          const record = parsed as Record<string, unknown>;
          const { scope, context, error, message, ...rest } = record;
          this.write({
            level,
            scope,
            ...(typeof message === 'string' ? { message } : {}),
            ...(context && typeof context === 'object' ? { context } : { context: rest }),
            ...(error === undefined ? {} : { error }),
          });
          continue;
        }
      } catch {
        // Worker stdout/stderr is allowed to contain non-JSON diagnostic text.
      }
      this.write({ level, scope: `worker.${stream}`, message: redactText(line) });
    }
  }

  readRecent(
    limit = 500,
    options: {
      redactPaths?: boolean;
      automationCorrelationId?: AppLogAutomationCorrelationId;
    } = {},
  ): AppLogEntry[] {
    let content: string;
    try {
      content = readFileSync(this.filePath, 'utf8');
    } catch {
      return [];
    }
    if (Buffer.byteLength(content, 'utf8') > MAX_LOG_READ_BYTES) {
      const bytes = Buffer.from(content, 'utf8');
      content = bytes.subarray(bytes.length - MAX_LOG_READ_BYTES).toString('utf8');
      content = content.slice(content.indexOf('\n') + 1);
    }
    const entries = content
      .split(/\r?\n/)
      .map((line) => {
        if (!line.trim()) return null;
        try {
          return parseAppLogEntry(JSON.parse(line));
        } catch {
          return null;
        }
      })
      .filter((entry): entry is AppLogEntry => entry !== null)
      .slice(-Math.max(1, Math.min(2_000, Math.floor(limit))));
    const correlationId = options.automationCorrelationId;
    const matchingEntries = correlationId === undefined
      ? entries
      : entries.filter((entry) => matchesAppLogAutomationCorrelation(entry, correlationId));
    return options.redactPaths
      ? matchingEntries.map((entry) => redactPaths(entry) as AppLogEntry)
      : matchingEntries;
  }

  private write(entry: Record<string, unknown>): void {
    try {
      appendFileSync(this.filePath, `${JSON.stringify(redactValue({ timestamp: new Date().toISOString(), ...entry }))}\n`);
    } catch (error) {
      // Logging must not replace the primary application failure.
      console.error('Serpent could not write its application log.', error);
    }
  }
}
