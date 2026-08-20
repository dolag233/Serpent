import { z } from "zod";

export const APP_LOG_LEVELS = ["info", "error"] as const;
export type AppLogLevel = (typeof APP_LOG_LEVELS)[number];

export type SerializedLogError = {
  name?: string;
  message?: string;
  code?: string;
  stack?: string;
  cause?: SerializedLogError | { value: string } | { truncated: true };
};

export type AppLogEntry = {
  timestamp: string;
  level: AppLogLevel;
  scope: string;
  message?: string;
  context?: Record<string, unknown>;
  error?: SerializedLogError | { value: string } | { truncated: true };
};

/**
 * A short, opaque identifier shown by an Automation Execution.  Treating it
 * as an identifier instead of a free-text log query keeps the diagnostics
 * bridge from becoming a way to pass arbitrary log content through IPC.
 */
export const appLogAutomationCorrelationIdSchema = z.string()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9_-]+$/u);

export type AppLogAutomationCorrelationId = z.infer<typeof appLogAutomationCorrelationIdSchema>;

export type ReadAppLogRequest = {
  automationCorrelationId?: AppLogAutomationCorrelationId;
};

const readAppLogRequestSchema = z.strictObject({
  automationCorrelationId: appLogAutomationCorrelationIdSchema.optional(),
});

/**
 * `undefined` is the historical "show recent diagnostics" request.  A
 * malformed object is rejected by Main without recording its raw content.
 */
export function parseReadAppLogRequest(input: unknown): ReadAppLogRequest | null {
  if (input === undefined) return {};
  const parsed = readAppLogRequestSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

/** Matches one execution ID or one log ID; the UI intentionally needs only one field. */
export function matchesAppLogAutomationCorrelation(
  entry: AppLogEntry,
  correlationId: AppLogAutomationCorrelationId,
): boolean {
  const context = entry.context;
  return context?.executionId === correlationId || context?.logId === correlationId;
}

const serializedLogErrorSchema: z.ZodType<SerializedLogError> = z.lazy(() =>
  z.object({
    name: z.string().optional(),
    message: z.string().optional(),
    code: z.string().optional(),
    stack: z.string().optional(),
    cause: z.union([
      serializedLogErrorSchema,
      z.object({ value: z.string() }),
      z.object({ truncated: z.literal(true) }),
    ]).optional(),
  }),
);

export const appLogEntrySchema = z.object({
  timestamp: z.string().min(1),
  level: z.enum(APP_LOG_LEVELS),
  scope: z.string().min(1),
  message: z.string().optional(),
  context: z.record(z.string(), z.unknown()).optional(),
  error: z.union([
    serializedLogErrorSchema,
    z.object({ value: z.string() }),
    z.object({ truncated: z.literal(true) }),
  ]).optional(),
});

export function parseAppLogEntry(input: unknown): AppLogEntry | null {
  const parsed = appLogEntrySchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export type ReadAppLogResult =
  | { ok: true; entries: AppLogEntry[]; fileName: string }
  | { ok: false; code: "unauthorized_sender" | "malformed_request" | "log_missing" | "read_failure" };
